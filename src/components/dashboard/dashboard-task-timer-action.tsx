"use client";

import type { ReactNode } from "react";
import { Pause, Play, Timer } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ATTENDANCE_STARTED_EVENT, ATTENDANCE_STOPPED_EVENT } from "@/lib/dashboard-live-events";
import { readTaskTimerSnapshot, type SharedTaskTimerSnapshot, writeTaskTimerSnapshot } from "@/lib/task-timer-storage";
import { formatTimeOnlyInDhaka, getDhakaCutoffIso, parseDhakaDateTime, toDateTimeInputValue } from "@/lib/utils";

type DashboardTaskTimerActionProps = {
  taskId: string;
  taskTitle?: string;
  reportDate: string;
  canEdit: boolean;
  initialStatus: "done" | "in_progress" | "pending";
  initialTrackedMinutes: number;
  initialActualStart?: Date | string | null;
  initialActualEnd?: Date | string | null;
  compact?: boolean;
  /**
   * Whether the workday is currently checked in. Leave undefined on surfaces that
   * should not be gated by attendance at all (the history page edits past days),
   * which is why this is a tri-state rather than a plain boolean.
   */
  initialAttendanceRunning?: boolean;
  onDoneClick?: () => void;
  onSnapshotChange?: (snapshot: TaskTimerSnapshot) => void;
  afterDoneSlot?: ReactNode;
};

export type TaskTimerSnapshot = {
  status: "done" | "in_progress" | "pending";
  trackedMinutes: string;
  trackedSeconds: string;
  actualStart: string;
  actualEnd: string;
  runningStartedAt: string;
};

/**
 * A stop timestamp that keeps its seconds.
 *
 * `toDhakaOffsetIso` writes ":00" for seconds, which is right for attendance but
 * wrong here: stopTimerAt measures the session as (stop - runningStartedAt), and
 * runningStartedAt is full precision. Truncating the stop to the top of the
 * minute makes that difference negative for any session started and ended inside
 * the same minute, so the elapsed time was floored to zero and silently thrown
 * away — the first pause on a fresh task banked nothing, which is why the button
 * came back as "Start" instead of "Resume".
 */
function nowIsoWithSeconds() {
  return new Date().toISOString();
}

function toInputDateTime(value?: Date | string | null) {
  if (!value) return "";
  return toDateTimeInputValue(value);
}

function parseResponsePayload(raw: string) {
  if (!raw) {
    return { message: "Task timer update failed." };
  }

  try {
    return JSON.parse(raw) as { message?: string };
  } catch {
    return { message: "The server returned an unexpected page instead of JSON." };
  }
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function calculateManualTrackedSeconds(actualStart: string, actualEnd: string) {
  if (!actualStart || !actualEnd) {
    return null;
  }

  const start = parseDhakaDateTime(actualStart);
  const end = parseDhakaDateTime(actualEnd);

  if (!start || !end || end <= start) {
    return null;
  }

  return Math.floor((end.getTime() - start.getTime()) / 1000);
}

function calculateElapsedSecondsSince(value: string, fallback: Date) {
  if (!value) {
    return null;
  }

  const parsedStart = parseDhakaDateTime(value);
  if (!parsedStart || parsedStart > fallback) {
    return null;
  }

  return Math.floor((fallback.getTime() - parsedStart.getTime()) / 1000);
}

function toClockValue(value: string) {
  if (!value) {
    return "";
  }

  return toDateTimeInputValue(value).slice(11, 16);
}

export function DashboardTaskTimerAction({
  taskId,
  taskTitle,
  reportDate,
  canEdit,
  initialStatus,
  initialTrackedMinutes,
  initialActualStart,
  initialActualEnd,
  compact = false,
  initialAttendanceRunning,
  onDoneClick,
  onSnapshotChange,
  afterDoneSlot,
}: DashboardTaskTimerActionProps) {
  const router = useRouter();
  const storageKey = useMemo(() => `dashboard-task-timer:${reportDate}:${taskId}`, [reportDate, taskId]);
  const storageLoadedRef = useRef(false);
  const autoStoppingRef = useRef(false);
  const isHydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const [now, setNow] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"done" | "in_progress" | "pending">(initialStatus);
  const [trackedMinutes, setTrackedMinutes] = useState(String(initialTrackedMinutes));
  const [trackedSeconds, setTrackedSeconds] = useState(initialTrackedMinutes * 60);
  const [actualStart, setActualStart] = useState(toInputDateTime(initialActualStart));
  const [actualEnd, setActualEnd] = useState(toInputDateTime(initialActualEnd));
  const [runningStartedAt, setRunningStartedAt] = useState("");
  /*
   * Check in/out is echoed straight to the timers so the Start button locks the
   * instant the user checks out, instead of staying live until router.refresh()
   * brings the new server prop back. null means "no event seen yet, trust the
   * prop"; the prop being undefined means this surface is not gated at all.
   */
  const [liveAttendanceRunning, setLiveAttendanceRunning] = useState<boolean | null>(null);
  const attendanceRunning = liveAttendanceRunning ?? initialAttendanceRunning;
  const attendanceBlocksStart = attendanceRunning === false;
  const isCompleted = status === "done";
  // A finished task can be picked up again; starting it reopens the day's entry
  // (status back to in_progress, completion reset), which the toast announces.
  // A task cannot be started or resumed once the workday is closed, or its
  // minutes would accrue against a day the user has already checked out of.
  const canStart = canEdit && !saving && !runningStartedAt && !attendanceBlocksStart;
  // Deliberately not gated on attendance: stopping the clock must always be
  // possible, even once the workday is closed.
  const canPause = canEdit && !saving && Boolean(runningStartedAt);
  const canDone = canEdit && !saving && !isCompleted && Boolean(onDoneClick);

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined") {
      return;
    }

    const parsed = readTaskTimerSnapshot(reportDate, taskId);
    if (!parsed) {
      storageLoadedRef.current = true;
      return;
    }

    if (initialStatus === "done" && parsed.status !== "done") {
      const completedSnapshot: SharedTaskTimerSnapshot = {
        status: "done",
        trackedMinutes: String(initialTrackedMinutes),
        trackedSeconds: String(initialTrackedMinutes * 60),
        actualStart: toInputDateTime(initialActualStart),
        actualEnd: toInputDateTime(initialActualEnd),
        runningStartedAt: "",
      };

      writeTaskTimerSnapshot(reportDate, taskId, completedSnapshot);
      queueMicrotask(() => {
        setStatus("done");
        setTrackedMinutes(String(initialTrackedMinutes));
        setTrackedSeconds(initialTrackedMinutes * 60);
        setActualStart(toInputDateTime(initialActualStart));
        setActualEnd(toInputDateTime(initialActualEnd));
        setRunningStartedAt("");
        storageLoadedRef.current = true;
      });
      return;
    }

    queueMicrotask(() => {
      setStatus(parsed.status);
      setTrackedMinutes(parsed.trackedMinutes);
      setTrackedSeconds(Number(parsed.trackedSeconds ?? String(Number(parsed.trackedMinutes || 0) * 60)));
      setActualStart(parsed.actualStart);
      setActualEnd(parsed.actualEnd);
      setRunningStartedAt(parsed.runningStartedAt);
      storageLoadedRef.current = true;
    });
  }, [initialActualEnd, initialActualStart, initialStatus, initialTrackedMinutes, isHydrated, reportDate, storageKey, taskId]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined" || !canEdit || runningStartedAt || status === "done") {
      return;
    }

    const raw = window.sessionStorage.getItem("dashboard-task-autostart");
    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw) as { taskId?: string; reportDate?: string; timestamp?: number };
      const isFresh = typeof parsed.timestamp === "number" && Date.now() - parsed.timestamp < 15000;

      if (parsed.taskId === taskId && parsed.reportDate === reportDate && isFresh) {
        window.sessionStorage.removeItem("dashboard-task-autostart");
        void startTimer();
        return;
      }
    } catch {
      window.sessionStorage.removeItem("dashboard-task-autostart");
      return;
    }
  }, [canEdit, isHydrated, reportDate, runningStartedAt, status, taskId]);

  useEffect(() => {
    if (!isHydrated || typeof window === "undefined" || !storageLoadedRef.current) {
      return;
    }

    const snapshot: SharedTaskTimerSnapshot = {
      status,
      trackedMinutes,
      trackedSeconds: String(trackedSeconds),
      actualStart,
      actualEnd,
      runningStartedAt,
    };

    writeTaskTimerSnapshot(reportDate, taskId, snapshot);
  }, [actualEnd, actualStart, isHydrated, reportDate, runningStartedAt, status, storageKey, taskId, trackedMinutes, trackedSeconds]);


  useEffect(() => {
    autoStoppingRef.current = false;
  }, [reportDate, runningStartedAt]);

  useEffect(() => {
    // Undefined prop = this surface opted out of attendance gating entirely, so
    // don't let the events pull it into a gated state.
    if (initialAttendanceRunning === undefined) {
      return;
    }

    const handleStarted = () => setLiveAttendanceRunning(true);
    const handleStopped = () => setLiveAttendanceRunning(false);

    window.addEventListener(ATTENDANCE_STARTED_EVENT, handleStarted);
    window.addEventListener(ATTENDANCE_STOPPED_EVENT, handleStopped);
    return () => {
      window.removeEventListener(ATTENDANCE_STARTED_EVENT, handleStarted);
      window.removeEventListener(ATTENDANCE_STOPPED_EVENT, handleStopped);
    };
  }, [initialAttendanceRunning]);

  const trackedSecondsBase = trackedSeconds;
  const liveSessionSeconds =
    now !== null && runningStartedAt && !Number.isNaN(new Date(runningStartedAt).getTime())
      ? trackedSecondsBase + Math.max(0, Math.floor((now - new Date(runningStartedAt).getTime()) / 1000))
      : trackedSecondsBase;
  const liveManualSeconds =
    now !== null && runningStartedAt && actualStart
      ? calculateElapsedSecondsSince(actualStart, new Date(now))
      : null;
  const liveTrackedSeconds = Math.max(liveSessionSeconds, liveManualSeconds ?? 0);
  const liveMinutes = String(Math.floor(liveTrackedSeconds / 60));
  const snapshotSignature = `${status}|${actualStart}|${actualEnd}|${runningStartedAt}|${liveMinutes}|${liveTrackedSeconds}`;
  const lastSentSignatureRef = useRef<string>("");

  useEffect(() => {
    if (!onSnapshotChange) {
      return;
    }

    if (lastSentSignatureRef.current === snapshotSignature) {
      return;
    }

    lastSentSignatureRef.current = snapshotSignature;

    onSnapshotChange({
      status,
      trackedMinutes: liveMinutes,
      trackedSeconds: String(liveTrackedSeconds),
      actualStart,
      actualEnd,
      runningStartedAt,
    });
  }, [actualEnd, actualStart, liveMinutes, liveTrackedSeconds, onSnapshotChange, runningStartedAt, snapshotSignature, status]);
  const shouldShowResumeLabel = !runningStartedAt && trackedSecondsBase > 0;
  const startClockValue = toClockValue(actualStart);
  const endClockValue = toClockValue(actualEnd);

  function patchClockTime(key: "actualStart" | "actualEnd", value: string) {
    const resolvedValue = value ? `${reportDate}T${value}` : "";

    if (key === "actualStart") {
      setActualStart(resolvedValue);
      if (!resolvedValue) {
        setActualEnd("");
      }
      return;
    }

    setActualEnd(resolvedValue);
  }

  async function persistUpdate(next: SharedTaskTimerSnapshot, options?: { refresh?: boolean; successMessage?: string }) {
    setSaving(true);

    const response = await fetch("/api/dashboard/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportDate,
        updates: [
          {
            dailyTaskId: taskId,
            status: next.status,
            completionPercent: next.status === "done" ? 100 : 0,
            trackedMinutes: Number(next.trackedMinutes || 0),
            actualStart: next.actualStart,
            actualEnd: next.actualEnd,
            // note and difficultyLevel are deliberately omitted: the timer does
            // not own them, and sending "" would wipe what the user wrote.
          },
        ],
      }),
    });

    const raw = await response.text();
    const result = parseResponsePayload(raw);
    setSaving(false);

    if (!response.ok) {
      toast.error(result.message ?? "Task timer update failed.");
      return false;
    }

    if (options?.successMessage) {
      toast.success(options.successMessage);
    }

    if (options?.refresh) {
      router.refresh();
    }

    return true;
  }


  async function startTimer() {
    if (!canStart) {
      return;
    }

    window.dispatchEvent(new CustomEvent("worklog:task-monitor-start", { detail: { source: `task:${taskId}`, label: taskTitle || `Task ${taskId.slice(0, 8)}` } }));

    const savedSnapshot = readTaskTimerSnapshot(reportDate, taskId);
    const resumedTrackedSeconds = Math.max(
      trackedSeconds,
      Number(savedSnapshot?.trackedSeconds ?? String(Number(savedSnapshot?.trackedMinutes || 0) * 60)),
    );
    const timestamp = new Date();
    const timestampInput = toDateTimeInputValue(timestamp);
    const nextActualStart = actualStart || savedSnapshot?.actualStart || timestampInput;
    const hasManualStart = Boolean(actualStart || savedSnapshot?.actualStart);
    const manualElapsedSeconds = hasManualStart ? calculateElapsedSecondsSince(nextActualStart, timestamp) : null;

    if (hasManualStart && manualElapsedSeconds === null) {
      toast.error("Start time cannot be in the future.");
      return;
    }

    const nextTrackedSeconds = Math.max(resumedTrackedSeconds, manualElapsedSeconds ?? 0);
    const timestampIso = timestamp.toISOString();
    const nextSnapshot: SharedTaskTimerSnapshot = {
      status: "in_progress",
      trackedMinutes: String(Math.floor(nextTrackedSeconds / 60)),
      trackedSeconds: String(nextTrackedSeconds),
      actualStart: nextActualStart,
      actualEnd: "",
      runningStartedAt: timestampIso,
    };

    setStatus(nextSnapshot.status);
    setTrackedMinutes(nextSnapshot.trackedMinutes);
    setTrackedSeconds(nextTrackedSeconds);
    setActualStart(nextSnapshot.actualStart);
    setActualEnd("");
    setRunningStartedAt(timestampIso);

    writeTaskTimerSnapshot(reportDate, taskId, nextSnapshot);
    // Refresh like stop does: the task just moved to "in progress", and the
    // dashboard counters that show it are rendered on the server.
    await persistUpdate(nextSnapshot, {
      refresh: true,
      successMessage: isCompleted ? "Task reopened and timer resumed." : "Task timer started.",
    });
  }

  async function stopTimerAt(timestampIso: string, successMessage: string) {
    window.dispatchEvent(new CustomEvent("worklog:task-monitor-stop", { detail: { source: `task:${taskId}` } }));
    const timestamp = parseDhakaDateTime(timestampIso);
    const timestampInput = toDateTimeInputValue(timestampIso);
    const runningStart = runningStartedAt ? new Date(runningStartedAt).getTime() : Number.NaN;
    const stopAt = timestamp?.getTime() ?? Number.NaN;
    const liveSecondsAtCutoff =
      Number.isFinite(runningStart) && Number.isFinite(stopAt)
        ? trackedSecondsBase + Math.max(0, Math.floor((stopAt - runningStart) / 1000))
        : liveTrackedSeconds;
    const nextTrackedMinutes = String(Math.floor(liveSecondsAtCutoff / 60));
    const nextSnapshot: SharedTaskTimerSnapshot = {
      status: "in_progress",
      trackedMinutes: nextTrackedMinutes,
      trackedSeconds: String(liveSecondsAtCutoff),
      actualStart: actualStart || timestampInput,
      actualEnd: timestampInput,
      runningStartedAt: "",
    };

    setStatus("in_progress");
    setTrackedMinutes(nextTrackedMinutes);
    setTrackedSeconds(liveSecondsAtCutoff);
    setActualStart(nextSnapshot.actualStart);
    setActualEnd(timestampInput);
    setRunningStartedAt("");

    writeTaskTimerSnapshot(reportDate, taskId, nextSnapshot);
    await persistUpdate(nextSnapshot, { refresh: true, successMessage });
  }

  async function pauseTimer() {
    if (!canPause) {
      return;
    }

    // Same path as the day-end auto-stop: the session is banked into
    // trackedSeconds and status stays in_progress, so Start comes back as
    // "Resume" and picks up from the accumulated total.
    await stopTimerAt(nowIsoWithSeconds(), "Task timer paused.");
  }

  async function handleDoneClick() {
    if (!canDone || !onDoneClick) {
      return;
    }

    if (runningStartedAt) {
      const nextTrackedMinutes = String(Math.floor(liveTrackedSeconds / 60));
      const timestampInput = toDateTimeInputValue(new Date());
      const nextSnapshot: SharedTaskTimerSnapshot = {
        status: "in_progress",
        trackedMinutes: nextTrackedMinutes,
        trackedSeconds: String(liveTrackedSeconds),
        actualStart,
        actualEnd: timestampInput,
        runningStartedAt: "",
      };

      setTrackedMinutes(nextTrackedMinutes);
      setTrackedSeconds(liveTrackedSeconds);
      setActualEnd(timestampInput);
      setRunningStartedAt("");
      writeTaskTimerSnapshot(reportDate, taskId, nextSnapshot);
      await persistUpdate(nextSnapshot, { refresh: false });
    }

    onDoneClick();
  }

  useEffect(() => {
    if (!runningStartedAt || now === null || saving || autoStoppingRef.current) {
      return;
    }

    const sessionStartedAt = new Date(runningStartedAt).getTime();
    if (Number.isNaN(sessionStartedAt)) {
      return;
    }

    const regularCutoffIso = getDhakaCutoffIso(reportDate, 19, 30);
    const overtimeCutoffIso = getDhakaCutoffIso(reportDate, 22, 0);
    const regularCutoffAt = new Date(regularCutoffIso).getTime();
    const overtimeCutoffAt = new Date(overtimeCutoffIso).getTime();
    const isOvertimeSession = sessionStartedAt >= regularCutoffAt;

    if (!isOvertimeSession && now >= regularCutoffAt) {
      autoStoppingRef.current = true;
      void stopTimerAt(regularCutoffIso, "Task session auto-stopped at 7:30 PM.");
      return;
    }

    if (isOvertimeSession && now >= overtimeCutoffAt) {
      autoStoppingRef.current = true;
      void stopTimerAt(overtimeCutoffIso, "Overtime session auto-stopped at 10:00 PM.");
    }
  }, [actualStart, liveTrackedSeconds, now, reportDate, runningStartedAt, saving, trackedSecondsBase]);

  useEffect(() => {
    // Nothing to stop, and no listener to leak, when this task is not counting.
    if (!runningStartedAt || saving) {
      return;
    }

    function handleAttendanceStopped() {
      if (autoStoppingRef.current) {
        return;
      }

      autoStoppingRef.current = true;
      void stopTimerAt(nowIsoWithSeconds(), "Task timer stopped with attendance.");
    }

    window.addEventListener(ATTENDANCE_STOPPED_EVENT, handleAttendanceStopped);
    return () => window.removeEventListener(ATTENDANCE_STOPPED_EVENT, handleAttendanceStopped);
    // Deliberately not depending on the per-second timer values: stopTimerAt
    // derives the session from runningStartedAt and the stop timestamp, and the
    // base it adds to (trackedSecondsBase, actualStart) is frozen for as long as
    // the timer runs. Including them would tear this listener down and rebuild it
    // on every tick for no gain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runningStartedAt, saving]);

  const buttonClass = compact
    ? "button-force-white !text-white [&_svg]:!text-white h-8 min-w-[3.875rem] shrink-0 justify-center rounded-full px-2 text-[0.625rem] font-semibold tracking-[0.01em] transition-all duration-200 hover:scale-[1.02] active:scale-95 disabled:scale-100 min-[420px]:min-w-[4.5rem] min-[420px]:px-2.5 min-[420px]:text-[0.6875rem] min-[560px]:min-w-[5.25rem] min-[560px]:px-3 min-[560px]:text-xs"
    : "button-force-white !text-white [&_svg]:!text-white h-9 min-w-[5.75rem] justify-center rounded-full px-3.5 text-sm font-semibold tracking-[0.01em] transition-all duration-200 hover:scale-[1.02] active:scale-95 disabled:scale-100";
  const startButtonClass = `${buttonClass} border border-white/20 bg-gradient-to-r from-[#06b6d4] via-[#14b8a6] to-[#22c55e] shadow-[0_12px_30px_rgba(6,182,212,0.34)] hover:from-[#0ea5e9] hover:via-[#06b6d4] hover:to-[#10b981] hover:shadow-[0_16px_34px_rgba(8,145,178,0.42)]`;
  const pauseButtonClass = `${buttonClass} border border-white/20 bg-gradient-to-r from-[#f59e0b] via-[#f97316] to-[#fb7185] shadow-[0_12px_30px_rgba(249,115,22,0.32)] hover:from-[#d97706] hover:via-[#ea580c] hover:to-[#f43f5e] hover:shadow-[0_16px_34px_rgba(234,88,12,0.42)]`;
  const doneButtonClass = `${buttonClass} border border-white/20 bg-gradient-to-r from-[#7c3aed] via-[#8b5cf6] to-[#ec4899] shadow-[0_12px_30px_rgba(168,85,247,0.3)] hover:from-[#6d28d9] hover:via-[#7c3aed] hover:to-[#db2777] hover:shadow-[0_16px_34px_rgba(168,85,247,0.42)] disabled:from-[#94a3b8] disabled:to-[#94a3b8] disabled:shadow-none`;

  return (
    <div className={compact ? "flex w-full min-w-0 max-w-full flex-col gap-1.5" : "flex min-w-[10.625rem] flex-col gap-2"}>
      <div className={compact ? "flex min-w-0 flex-wrap items-center gap-1" : "flex flex-wrap items-center gap-1.5"}>
        {/* Pause takes Start's place while running rather than sitting beside it:
            the two are never usable at the same time, and the row has no width to
            spare on the single-screen dashboard. */}
        {runningStartedAt ? (
          <Button
            className={pauseButtonClass}
            disabled={!canPause}
            onClick={pauseTimer}
            type="button"
            variant="default"
          >
            <Pause className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            Pause
          </Button>
        ) : (
          <Button
            className={startButtonClass}
            disabled={!canStart}
            onClick={startTimer}
            // A disabled button with no reason is a dead end; say why on hover.
            title={attendanceBlocksStart ? "Check in first — the workday timer is stopped." : undefined}
            type="button"
            variant="default"
          >
            <Play className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            {shouldShowResumeLabel ? "Resume" : "Start"}
          </Button>
        )}
        {isCompleted ? null : (
          <Button
            className={doneButtonClass}
            disabled={!canDone}
            onClick={handleDoneClick}
            type="button"
            variant="default"
          >
            Done
          </Button>
        )}
        {afterDoneSlot ? afterDoneSlot : null}
      </div>
      {compact ? (
        /* Elapsed, start and end on one line. The elapsed chip sizes to its own
           text (auto) and the two fields split what is left, so the row holds
           together without the chip stealing a line of its own. */
        <div className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)] items-center gap-1.5">
          <span className="inline-flex shrink-0 items-center justify-center gap-1 rounded-full border border-slate-200 bg-white/80 px-2 py-1 text-[0.625rem] font-semibold tabular-nums text-slate-600">
            <Timer className="h-3 w-3 text-[#4f5ef7]" />
            {formatDuration(liveTrackedSeconds)}
          </span>
          <Input
            className="h-7 min-w-0 px-2 text-[0.6875rem]"
            disabled={!canEdit || saving || Boolean(runningStartedAt)}
            onChange={(event) => patchClockTime("actualStart", event.target.value)}
            type="time"
            value={startClockValue}
          />
          <Input
            className="h-7 min-w-0 px-2 text-[0.6875rem]"
            disabled={!canEdit || saving || Boolean(runningStartedAt) || !actualStart}
            onChange={(event) => patchClockTime("actualEnd", event.target.value)}
            type="time"
            value={endClockValue}
          />
        </div>
      ) : (
        <>
          <span className="inline-flex items-center justify-center gap-1 rounded-full border border-slate-200 bg-white/80 px-3 py-1.5 text-xs font-semibold tabular-nums text-slate-600">
            <Timer className="h-3.5 w-3.5 text-[#4f5ef7]" />
            {formatDuration(liveTrackedSeconds)}
          </span>
          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
            <Input
              disabled={!canEdit || saving || Boolean(runningStartedAt)}
              onChange={(event) => patchClockTime("actualStart", event.target.value)}
              type="time"
              value={startClockValue}
            />
            <span className="hidden sm:inline" />
            <Input
              disabled={!canEdit || saving || Boolean(runningStartedAt) || !actualStart}
              onChange={(event) => patchClockTime("actualEnd", event.target.value)}
              type="time"
              value={endClockValue}
            />
          </div>
        </>
      )}
      {!compact ? (
        <p className="text-[0.6875rem] font-medium text-slate-500">
          {runningStartedAt
            ? `Started ${formatTimeOnlyInDhaka(actualStart || runningStartedAt)}`
            : actualStart
              ? actualEnd
                ? `Saved ${formatTimeOnlyInDhaka(actualStart)} - ${formatTimeOnlyInDhaka(actualEnd)}`
                : `Manual time ${formatTimeOnlyInDhaka(actualStart)}`
              : "Not started yet"}
        </p>
      ) : null}
    </div>
  );
}
