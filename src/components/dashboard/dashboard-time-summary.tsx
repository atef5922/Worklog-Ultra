"use client";

import { Timer } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { PanelHeader } from "@/components/dashboard/panel-header";
import { readTaskTimerSnapshot } from "@/lib/task-timer-storage";
import { parseDhakaDateTime, toDateOnly } from "@/lib/utils";

type TimeSummaryTask = {
  id: string;
  trackedMinutes: number;
};

const OFFICE_START_HOUR = 10;
const OFFICE_END_HOUR = 19;
const OFFICE_END_MINUTE = 30;
const DEFAULT_BREAK_MINUTES = 30;

function formatDurationFromMinutes(totalMinutes: number) {
  const safeMinutes = Math.max(0, totalMinutes);
  const hours = Math.floor(safeMinutes / 60);
  const minutes = safeMinutes % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function calculateElapsedSecondsSince(value: string, now: number) {
  if (!value) {
    return null;
  }

  const parsedStart = parseDhakaDateTime(value);
  if (!parsedStart || parsedStart.getTime() > now) {
    return null;
  }

  return Math.floor((now - parsedStart.getTime()) / 1000);
}

function calculateOfficeTargetMinutes() {
  const officeWindowMinutes =
    (OFFICE_END_HOUR * 60 + OFFICE_END_MINUTE) - OFFICE_START_HOUR * 60;

  return Math.max(0, officeWindowMinutes - DEFAULT_BREAK_MINUTES);
}

export function DashboardTimeSummary({
  plannedTasks,
  tasks,
}: {
  plannedTasks: number;
  tasks: TimeSummaryTask[];
}) {
  const [now, setNow] = useState<number | null>(null);
  const [hydrated, setHydrated] = useState(false);
  const reportDate = useMemo(() => toDateOnly(), []);

  useEffect(() => {
    setHydrated(true);
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  const targetMinutes = calculateOfficeTargetMinutes();

  const actualWorkedMinutes = useMemo(() => {
    if (!hydrated || now === null) {
      return tasks.reduce((sum, task) => sum + task.trackedMinutes, 0);
    }

    return tasks.reduce((sum, task) => {
      const snapshot = readTaskTimerSnapshot(reportDate, task.id);

      if (!snapshot) {
        return sum + task.trackedMinutes;
      }

      const baseSeconds = Number(snapshot.trackedSeconds ?? String(Number(snapshot.trackedMinutes || 0) * 60));
      const runningExtraSeconds =
        snapshot.runningStartedAt && !Number.isNaN(new Date(snapshot.runningStartedAt).getTime())
          ? Math.max(0, Math.floor((now - new Date(snapshot.runningStartedAt).getTime()) / 1000))
          : 0;
      const sessionSeconds = baseSeconds + runningExtraSeconds;
      const manualElapsedSeconds =
        snapshot.runningStartedAt && snapshot.actualStart
          ? calculateElapsedSecondsSince(snapshot.actualStart, now)
          : null;

      return sum + Math.floor(Math.max(sessionSeconds, manualElapsedSeconds ?? 0) / 60);
    }, 0);
  }, [hydrated, now, reportDate, tasks]);

  const remainingMinutes = Math.max(targetMinutes - actualWorkedMinutes, 0);

  const items = [
    { label: "Planned Work Time", value: formatDurationFromMinutes(targetMinutes) },
    { label: "Actual Work Time", value: formatDurationFromMinutes(actualWorkedMinutes) },
    { label: "Break Time", value: formatDurationFromMinutes(DEFAULT_BREAK_MINUTES) },
    { label: "Remaining Time", value: formatDurationFromMinutes(remainingMinutes) },
  ];

  const completionPercent = targetMinutes ? Math.min(100, Math.round((actualWorkedMinutes / targetMinutes) * 100)) : 0;

  return (
    <div
      className="dashboard-accent accent-sky rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-3 shadow-[var(--shadow)] sm:p-3.5"
      data-dashboard-panel
    >
      <PanelHeader icon={Timer} title="Time Summary" tone="bg-sky-500/10 text-sky-500" />
      <div className="mt-2.5 flex items-center gap-2">
        <div className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--panel-muted)]">
          <div
            className="h-full rounded-full bg-gradient-to-r from-[#4f5ef7] to-[#22c55e] transition-[width] duration-500 ease-out"
            style={{ width: `${completionPercent}%` }}
          />
        </div>
        <span className="shrink-0 font-mono text-[0.6875rem] font-bold tabular-nums text-[var(--muted-foreground)]">{completionPercent}%</span>
      </div>
      <div className="mt-2.5 space-y-1.5">
        {items.map((item) => (
          <div className="flex items-center justify-between gap-3 border-b border-[var(--panel-border)] pb-1.5 last:border-b-0 last:pb-0" key={item.label}>
            <span className="min-w-0 text-[0.71875rem] font-medium text-[var(--muted-foreground)] sm:text-[0.75rem]">{item.label}</span>
            <span className={`text-[0.71875rem] font-bold whitespace-nowrap sm:text-[0.75rem] ${item.label === "Remaining Time" ? "text-rose-500" : "text-[var(--foreground)]"}`}>
              {item.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
