"use client";

import Link from "next/link";
import { ListChecks } from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import { AssignmentReviewControls } from "@/components/dashboard/assignment-review-controls";
import { PanelHeader } from "@/components/dashboard/panel-header";
import { DashboardTaskTimerAction, type TaskTimerSnapshot } from "@/components/dashboard/dashboard-task-timer-action";
import { TaskAutoStopNoteModal } from "@/components/dashboard/task-auto-stop-note-modal";
import { TaskCompleteModal, type TaskCompletionPayload } from "@/components/dashboard/task-complete-modal";
import { TaskManageControls } from "@/components/dashboard/task-manage-controls";
import {
  DASHBOARD_TASKS_CREATED_EVENT,
  type DashboardLiveTask,
} from "@/lib/dashboard-live-events";
import {
  readPendingTaskAutoStopNotes,
  removePendingTaskAutoStopNote,
  TASK_AUTO_STOP_NOTE_EVENT,
  type TaskAutoStopNotePayload,
} from "@/lib/task-auto-stop-note";
import { countDashboardTaskStats, filterTodaysWorkPlanTasks } from "@/lib/dashboard-work-plan-filter";
import { extractContinuationMeta } from "@/lib/task-continuation";
import { extractFollowUpMeta } from "@/lib/task-follow-up";
import { getReadableTaskDescription } from "@/lib/report-summary";
import { toDateOnly } from "@/lib/utils";

export type DashboardWorkPlanTask = {
  id: string;
  taskTitle: string;
  taskDescription?: string | null;
  priority: string;
  planDate: string;
  assignedBy?: string | null;
  userId: string;
  departmentName: string;
  updates: Array<{
    status: "done" | "in_progress" | "pending";
    note?: string | null;
    trackedMinutes: number;
    actualStart?: string | null;
    actualEnd?: string | null;
    reportDate?: string | null;
  }>;
  latestReview?: {
    id: string;
    status: "pending" | "approved" | "rejected";
    submitNote: string;
    reviewNote: string | null;
    createdAt: string;
    reviewedAt: string | null;
    requestedById: string;
    reviewerId: string | null;
  } | null;
};

type DashboardWorkPlanSectionProps = {
  tasks: DashboardWorkPlanTask[];
  canEdit: boolean;
  currentUserId: string;
  formattedDate: string;
  onStatsChange?: (stats: {
    plannedTasks: number;
    completedTasks: number;
    inProgressTasks: number;
    pendingTasks: number;
    visibleTaskIds: string[];
  }) => void;
};

function getPriorityTone(priority: string) {
  if (priority === "high" || priority === "critical") {
    return "border border-rose-200 bg-gradient-to-r from-rose-500 via-pink-500 to-red-500 text-white shadow-[0_6px_14px_rgba(244,63,94,0.2)]";
  }

  if (priority === "normal") {
    return "border border-amber-200 bg-gradient-to-r from-amber-400 via-orange-400 to-yellow-500 text-slate-950 shadow-[0_6px_14px_rgba(245,158,11,0.18)]";
  }

  return "border border-emerald-200 bg-gradient-to-r from-emerald-500 via-teal-500 to-green-500 text-white shadow-[0_6px_14px_rgba(16,185,129,0.18)]";
}

function formatPriority(priority: string) {
  if (priority === "critical") return "High";
  if (priority === "normal") return "Medium";
  return priority.charAt(0).toUpperCase() + priority.slice(1);
}

function priorityRank(priority: string) {
  if (priority === "critical") return 0;
  if (priority === "high") return 1;
  if (priority === "normal") return 2;
  return 3;
}

function getStatusMeta(status: "done" | "in_progress" | "pending") {
  if (status === "done") {
    return { label: "Completed", chip: "border border-emerald-200 bg-emerald-50 text-emerald-700" };
  }

  if (status === "in_progress") {
    return { label: "In Progress", chip: "border border-blue-200 bg-blue-50 text-blue-700" };
  }

  return { label: "Pending", chip: "border border-amber-200 bg-amber-50 text-amber-700" };
}

function getTaskSurfaceTone({
  priority,
  status,
  hasFollowUp,
  hasContinuation,
}: {
  priority: string;
  status: "done" | "in_progress" | "pending";
  hasFollowUp: boolean;
  hasContinuation: boolean;
}) {
  if (hasFollowUp) {
    return {
      article:
        "border-violet-300 bg-[linear-gradient(135deg,#f5eefe_0%,#ecdfff_52%,#f8f2ff_100%)] hover:border-violet-400 hover:bg-[linear-gradient(135deg,#f1e7ff_0%,#e7d7ff_52%,#f5edff_100%)] hover:shadow-[0_14px_30px_rgba(139,92,246,0.18)]",
      note: "border border-violet-200/90 bg-[linear-gradient(135deg,#efe3ff_0%,#e6d7ff_100%)]",
    };
  }

  if (hasContinuation) {
    return {
      article:
        "border-sky-300 bg-[linear-gradient(135deg,#eaf7ff_0%,#dff1ff_52%,#f1f9ff_100%)] hover:border-sky-400 hover:bg-[linear-gradient(135deg,#e2f3ff_0%,#d6edff_52%,#ebf7ff_100%)] hover:shadow-[0_14px_30px_rgba(56,189,248,0.18)]",
      note: "border border-sky-200/90 bg-[linear-gradient(135deg,#dff1ff_0%,#d3ebff_100%)]",
    };
  }

  if (priority === "critical" || priority === "high") {
    return {
      article:
        "border-rose-300 bg-[linear-gradient(135deg,#fff0f1_0%,#ffe3e8_48%,#fff2e8_100%)] hover:border-rose-400 hover:bg-[linear-gradient(135deg,#ffe9ec_0%,#ffd8e1_48%,#ffecdf_100%)] hover:shadow-[0_14px_30px_rgba(244,114,182,0.18)]",
      note: "border border-rose-200/90 bg-[linear-gradient(135deg,#ffe3e7_0%,#ffd7df_100%)]",
    };
  }

  if (status === "in_progress") {
    return {
      article:
        "border-blue-300 bg-[linear-gradient(135deg,#edf4ff_0%,#e1ebff_54%,#f3f7ff_100%)] hover:border-blue-400 hover:bg-[linear-gradient(135deg,#e5efff_0%,#d8e5ff_54%,#edf4ff_100%)] hover:shadow-[0_14px_30px_rgba(96,165,250,0.18)]",
      note: "border border-blue-200/90 bg-[linear-gradient(135deg,#dfebff_0%,#d3e2ff_100%)]",
    };
  }

  if (priority === "normal" || status === "pending") {
    return {
      article:
        "border-amber-300 bg-[linear-gradient(135deg,#fff6e6_0%,#ffefcf_52%,#fff7ea_100%)] hover:border-amber-400 hover:bg-[linear-gradient(135deg,#fff1da_0%,#ffe8bf_52%,#fff2df_100%)] hover:shadow-[0_14px_30px_rgba(245,158,11,0.18)]",
      note: "border border-amber-200/90 bg-[linear-gradient(135deg,#ffeecf_0%,#ffe5bc_100%)]",
    };
  }

  return {
    article:
      "border-emerald-300 bg-[linear-gradient(135deg,#ebfff4_0%,#dcf9e9_52%,#f2fff8_100%)] hover:border-emerald-400 hover:bg-[linear-gradient(135deg,#e3fcea_0%,#d2f4e0_52%,#ebfdf3_100%)] hover:shadow-[0_14px_30px_rgba(52,211,153,0.17)]",
    note: "border border-emerald-200/90 bg-[linear-gradient(135deg,#daf8e6_0%,#cef1dc_100%)]",
  };
}

function parseResponse(raw: string) {
  try {
    return raw ? JSON.parse(raw) : { message: "Task update failed." };
  } catch {
    return { message: "The server returned an unexpected response." };
  }
}

type TaskTimerActionWrapperProps = {
  task: DashboardWorkPlanTask;
  canEdit: boolean;
  onDoneClick: (taskId: string) => void;
  onSnapshotChange: (taskId: string, snapshot: TaskTimerSnapshot) => void;
  afterDoneSlot?: ReactNode;
};

const TaskTimerActionWrapper = ({
  task,
  canEdit,
  onDoneClick,
  onSnapshotChange,
  afterDoneSlot,
}: TaskTimerActionWrapperProps) => {
  const handleDone = useCallback(() => {
    onDoneClick(task.id);
  }, [task.id, onDoneClick]);

  const handleSnapshot = useCallback(
    (snapshot: TaskTimerSnapshot) => {
      onSnapshotChange(task.id, snapshot);
    },
    [task.id, onSnapshotChange]
  );

  const status = task.updates[0]?.status ?? "pending";

  return (
    <DashboardTaskTimerAction
      canEdit={canEdit}
      compact
      initialActualEnd={task.updates[0]?.actualEnd ?? null}
      initialActualStart={task.updates[0]?.actualStart ?? null}
      initialStatus={status}
      initialTrackedMinutes={task.updates[0]?.trackedMinutes ?? 0}
      afterDoneSlot={afterDoneSlot}
      onDoneClick={handleDone}
      onSnapshotChange={handleSnapshot}
      reportDate={toDateOnly()}
      taskId={task.id}
      taskTitle={task.taskTitle}
    />
  );
};

function emitDashboardStats(
  allTasks: DashboardWorkPlanTask[],
  onStatsChange?: DashboardWorkPlanSectionProps["onStatsChange"],
) {
  const stats = countDashboardTaskStats(allTasks);
  onStatsChange?.({
    plannedTasks: stats.plannedTasks,
    completedTasks: stats.completedTasks,
    inProgressTasks: stats.inProgressTasks,
    pendingTasks: stats.pendingTasks,
    visibleTaskIds: stats.visibleTasks.map((task) => task.id),
  });

  if (typeof window !== "undefined") {
    // Defer event dispatch to after render completes to avoid "Cannot update a component while rendering" error
    queueMicrotask(() => {
      window.dispatchEvent(
        new CustomEvent("dashboard:stats-updated", {
          detail: {
            plannedTasks: stats.plannedTasks,
            completedTasks: stats.completedTasks,
            inProgressTasks: stats.inProgressTasks,
            pendingTasks: stats.pendingTasks,
            visibleTaskIds: stats.visibleTasks.map((task) => task.id),
          },
        }),
      );
    });
  }
}

export function DashboardWorkPlanSection({
  tasks: initialTasks,
  canEdit,
  currentUserId,
  formattedDate,
  onStatsChange,
}: DashboardWorkPlanSectionProps) {
  const router = useRouter();
  const [tasks, setTasks] = useState(initialTasks);
  const [completeTaskId, setCompleteTaskId] = useState<string | null>(null);
  const [savingCompletion, setSavingCompletion] = useState(false);
  const [autoStopQueue, setAutoStopQueue] = useState<TaskAutoStopNotePayload[]>(() =>
    typeof window === "undefined" ? [] : readPendingTaskAutoStopNotes(),
  );
  const [savingAutoStopNote, setSavingAutoStopNote] = useState(false);
  const timerSnapshotsRef = useRef<Record<string, TaskTimerSnapshot>>({});

  useEffect(() => {
    const syncHandle = window.setTimeout(() => {
      setTasks(initialTasks);
    }, 0);

    return () => window.clearTimeout(syncHandle);
  }, [initialTasks]);

  useEffect(() => {
    emitDashboardStats(tasks, onStatsChange);
  }, [onStatsChange, tasks]);

  useEffect(() => {
    function handleTasksCreated(event: Event) {
      const detail = (event as CustomEvent<{ tasks?: DashboardLiveTask[] }>).detail;
      const createdTasks = detail?.tasks ?? [];

      if (!createdTasks.length) {
        return;
      }

      setTasks((current) => {
        const currentIds = new Set(current.map((task) => task.id));
        const nextTasks = [
          ...createdTasks
            .filter((task) => !currentIds.has(task.id))
            .map((task) => ({
              ...task,
              updates: [],
              latestReview: null,
            })),
          ...current,
        ];

        return nextTasks;
      });
    }

    window.addEventListener(DASHBOARD_TASKS_CREATED_EVENT, handleTasksCreated);
    return () => window.removeEventListener(DASHBOARD_TASKS_CREATED_EVENT, handleTasksCreated);
  }, []);

  useEffect(() => {
    function handleAutoStopNoteNeeded(event: Event) {
      const detail = (event as CustomEvent<TaskAutoStopNotePayload>).detail;
      if (!detail?.taskId || !detail?.reportDate) {
        return;
      }

      setAutoStopQueue((current) => {
        const withoutDuplicate = current.filter(
          (entry) => !(entry.taskId === detail.taskId && entry.reportDate === detail.reportDate),
        );

        return [...withoutDuplicate, detail].sort((left, right) => left.timestamp - right.timestamp);
      });
    }

    window.addEventListener(TASK_AUTO_STOP_NOTE_EVENT, handleAutoStopNoteNeeded);
    return () => window.removeEventListener(TASK_AUTO_STOP_NOTE_EVENT, handleAutoStopNoteNeeded);
  }, []);

  const handleSnapshotChange = useCallback((taskId: string, snapshot: TaskTimerSnapshot) => {
    timerSnapshotsRef.current = {
      ...timerSnapshotsRef.current,
      [taskId]: snapshot,
    };
  }, []);

  const handleDoneClick = useCallback((taskId: string) => {
    setCompleteTaskId(taskId);
  }, []);

  const handleModalOpenChange = useCallback((open: boolean) => {
    if (!open) {
      setCompleteTaskId(null);
    }
  }, []);

  const visibleTasks = useMemo(
    () =>
      filterTodaysWorkPlanTasks(tasks)
        .sort(
          (left, right) =>
            priorityRank(left.priority) - priorityRank(right.priority) ||
            left.taskTitle.localeCompare(right.taskTitle),
        )
        .slice(0, 6),
    [tasks],
  );

  const completingTask = tasks.find((task) => task.id === completeTaskId) ?? null;
  const activeAutoStopPrompt = autoStopQueue[0] ?? null;
  const activeAutoStopTask = activeAutoStopPrompt
    ? tasks.find((task) => task.id === activeAutoStopPrompt.taskId) ?? null
    : null;

  function markTaskCompleted(taskId: string, snapshot?: TaskTimerSnapshot) {
    setTasks((current) => {
      return current.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        return {
          ...task,
          updates: [
            {
              ...(task.updates[0] ?? {
                trackedMinutes: Number(snapshot?.trackedMinutes ?? 0),
                actualStart: null,
                actualEnd: null,
                note: null,
                reportDate: toDateOnly(),
              }),
              status: "done" as const,
              // The server upserts today's row, so the local copy must carry
              // today's date too — otherwise the dashboard reads a stale day.
              reportDate: toDateOnly(),
              trackedMinutes: Number(snapshot?.trackedMinutes ?? task.updates[0]?.trackedMinutes ?? 0),
              actualStart: snapshot?.actualStart ?? task.updates[0]?.actualStart ?? null,
              actualEnd: snapshot?.actualEnd ?? task.updates[0]?.actualEnd ?? null,
            },
          ],
        };
      });
    });
  }

  const handleMovedToHistory = useCallback((taskId: string) => {
    setTasks((current) =>
      current.map((task) => {
        if (task.id !== taskId) {
          return task;
        }

        return {
          ...task,
          updates: [
            {
              ...(task.updates[0] ?? {
                trackedMinutes: 0,
                actualStart: null,
                actualEnd: null,
                note: null,
              }),
              status: "done" as const,
              reportDate: toDateOnly(),
            },
          ],
        };
      }),
    );
  }, []);

  function dismissAutoStopPrompt(taskId: string, reportDate: string) {
    removePendingTaskAutoStopNote(reportDate, taskId);
    setAutoStopQueue((current) =>
      current.filter((entry) => !(entry.taskId === taskId && entry.reportDate === reportDate)),
    );
  }

  async function handleCompleteSave(payload: TaskCompletionPayload) {
    if (!completingTask) {
      return;
    }

    const snapshot = timerSnapshotsRef.current[completingTask.id];
    setSavingCompletion(true);

    const response = await fetch(`/api/dashboard/tasks/${completingTask.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "complete_task",
        reportDate: toDateOnly(),
        completionStatus: payload.completionStatus,
        completionNote: payload.completionNote,
        needFollowUp: payload.needFollowUp,
        followUpDate: payload.followUpDate,
        followUpTime: payload.followUpTime,
        followUpNote: payload.followUpNote,
        trackedMinutes: Number(snapshot?.trackedMinutes ?? completingTask.updates[0]?.trackedMinutes ?? 0),
        actualStart: snapshot?.actualStart || completingTask.updates[0]?.actualStart || "",
        actualEnd: snapshot?.actualEnd || completingTask.updates[0]?.actualEnd || "",
      }),
    });

    const result = parseResponse(await response.text());
    setSavingCompletion(false);

    if (!response.ok) {
      toast.error(result.message ?? "Could not complete task.");
      return;
    }

    toast.success(result.message ?? "Task completed.");
    setCompleteTaskId(null);
    markTaskCompleted(completingTask.id, snapshot);
    // The stat cards and the work-time KPI are server-rendered, and a follow-up
    // task may have just been created server-side, so pull fresh server state.
    router.refresh();

    if (typeof window !== "undefined") {
      const todayKey = toDateOnly();
      window.sessionStorage.setItem(
        `task-popup-completed-event:${todayKey}`,
        JSON.stringify({
          taskId: completingTask.id,
          taskTitle: completingTask.taskTitle,
          timestamp: Date.now(),
          trackedMinutes: Number(result.trackedMinutes ?? snapshot?.trackedMinutes ?? 0),
        }),
      );
    }
  }

  async function handleAutoStopNoteSave(note: string) {
    if (!activeAutoStopPrompt) {
      return;
    }

    const currentTask = tasks.find((task) => task.id === activeAutoStopPrompt.taskId) ?? activeAutoStopTask;
    const snapshot = timerSnapshotsRef.current[activeAutoStopPrompt.taskId];
    const nextStatus = snapshot?.status || currentTask?.updates[0]?.status || "in_progress";
    const nextTrackedMinutes = Math.max(
      0,
      Number(
        snapshot?.trackedMinutes ??
          activeAutoStopPrompt.trackedMinutes ??
          currentTask?.updates[0]?.trackedMinutes ??
          0,
      ),
    );
    const nextActualStart =
      snapshot?.actualStart || activeAutoStopPrompt.actualStart || currentTask?.updates[0]?.actualStart || "";
    const nextActualEnd =
      snapshot?.actualEnd || activeAutoStopPrompt.actualEnd || currentTask?.updates[0]?.actualEnd || "";

    setSavingAutoStopNote(true);
    const response = await fetch("/api/dashboard/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportDate: activeAutoStopPrompt.reportDate,
        updates: [
          {
            dailyTaskId: activeAutoStopPrompt.taskId,
            status: nextStatus,
            note,
            completionPercent: nextStatus === "done" ? 100 : 0,
            trackedMinutes: nextTrackedMinutes,
            actualStart: nextActualStart,
            actualEnd: nextActualEnd,
            difficultyLevel: "",
          },
        ],
      }),
    });

    const result = parseResponse(await response.text());
    setSavingAutoStopNote(false);

    if (!response.ok) {
      toast.error(result.message ?? "Could not save auto-stop note.");
      return;
    }

    setTasks((current) =>
      current.map((task) =>
        task.id === activeAutoStopPrompt.taskId
          ? {
              ...task,
              updates: [
                {
                  ...(task.updates[0] ?? {
                    status: nextStatus,
                    trackedMinutes: nextTrackedMinutes,
                    actualStart: nextActualStart || null,
                    actualEnd: nextActualEnd || null,
                    reportDate: activeAutoStopPrompt.reportDate,
                  }),
                  status: nextStatus,
                  trackedMinutes: nextTrackedMinutes,
                  actualStart: nextActualStart || null,
                  actualEnd: nextActualEnd || null,
                  note,
                },
              ],
            }
          : task,
      ),
    );

    toast.success("Auto-stop note saved.");
    dismissAutoStopPrompt(activeAutoStopPrompt.taskId, activeAutoStopPrompt.reportDate);
  }

  return (
    <>
      <div
        // Height is pinned to exactly one task card so a half-cut card never
        // shows; the rest scroll, snapping to each card's top edge.
        className="dashboard-accent accent-indigo flex min-h-0 flex-col overflow-hidden rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] shadow-[var(--shadow)] min-[900px]:h-[16.35rem]"
        data-dashboard-panel
      >
        <div className="shrink-0 border-b border-[var(--panel-border)] px-2.5 py-1.5">
          <PanelHeader
            action={<p className="text-[0.6875rem] font-medium text-[var(--muted-foreground)] sm:text-xs">{formattedDate}</p>}
            icon={ListChecks}
            title="Today's Work Plan"
          />
        </div>

        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2 min-[900px]:snap-y min-[900px]:snap-mandatory">
          {visibleTasks.length ? (
            visibleTasks.map((task) => {
              const status = task.updates[0]?.status ?? "pending";
              const statusMeta = getStatusMeta(status);
              const continuationMeta = extractContinuationMeta(task.taskDescription);
              const followUpMeta = extractFollowUpMeta(task.taskDescription);
              const taskDescription = getReadableTaskDescription(task.taskDescription);
              const surfaceTone = getTaskSurfaceTone({
                priority: task.priority,
                status,
                hasFollowUp: Boolean(followUpMeta),
                hasContinuation: Boolean(continuationMeta),
              });

              return (
                <article
                  className={`group overflow-hidden rounded-[1rem] border p-2.5 transition min-[900px]:h-[11rem] min-[900px]:snap-start ${surfaceTone.article}`}
                  data-dashboard-row
                  key={task.id}
                >
                  <div className="flex flex-col gap-2.5 sm:gap-3">
                    <div className="flex min-w-0 flex-col gap-3 xl:grid xl:grid-cols-[minmax(0,1fr)_minmax(18.75rem,24rem)] xl:items-start xl:gap-4">
                      <div className="min-w-0 flex-1 space-y-1.5 sm:space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="break-words text-[0.92rem] font-semibold leading-5 text-[var(--foreground)] sm:text-sm sm:leading-6">{task.taskTitle}</h3>
                          {followUpMeta ? (
                            <span className="rounded-full border border-violet-200 bg-violet-50 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-violet-700">
                              Follow-up
                            </span>
                          ) : null}
                          {continuationMeta ? (
                            <span className="rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[0.625rem] font-bold uppercase tracking-[0.14em] text-sky-700">
                              Continued
                            </span>
                          ) : null}
                        </div>
                        <p className="text-[0.6875rem] text-[var(--muted-foreground)] sm:text-xs">{task.departmentName}</p>

                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex min-w-[4.5rem] items-center justify-center rounded-full px-2 py-1 text-[0.5625rem] font-bold uppercase tracking-[0.12em] ${getPriorityTone(task.priority)}`}
                          >
                            {formatPriority(task.priority)}
                          </span>
                          <span className={`inline-flex rounded-full px-2 py-1 text-[0.625rem] font-semibold ${statusMeta.chip}`}>
                            {statusMeta.label}
                          </span>
                        </div>
                      </div>

                      <div className="w-full max-w-full xl:max-w-[24rem] xl:justify-self-end">
                        <TaskTimerActionWrapper
                          task={task}
                          canEdit={canEdit}
                          afterDoneSlot={
                            <TaskManageControls
                              compact
                              hideDoneAction
                              showArchiveAction
                              showInlineDelete
                              onMovedToHistory={handleMovedToHistory}
                              task={{
                                id: task.id,
                                taskTitle: task.taskTitle,
                                taskDescription: task.taskDescription,
                                priority: task.priority as "low" | "normal" | "high" | "critical",
                              }}
                            />
                          }
                          onDoneClick={handleDoneClick}
                          onSnapshotChange={handleSnapshotChange}
                        />
                        <div className="mt-1 flex flex-wrap items-center gap-1.5">
                          {task.assignedBy && task.userId === currentUserId ? (
                            <AssignmentReviewControls
                              latestReview={task.latestReview ?? null}
                              mode="assignee"
                              taskId={task.id}
                              taskTitle={task.taskTitle}
                            />
                          ) : null}
                        </div>
                      </div>
                    </div>

                    {taskDescription ? (
                      <div className={`rounded-xl px-2.5 py-1.5 ${surfaceTone.note}`}>
                        <p className="line-clamp-2 text-[0.68rem] leading-4 text-slate-600 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {taskDescription}
                        </p>
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })
          ) : (
            <div className="rounded-2xl border border-dashed border-[var(--panel-border)] bg-[var(--panel-muted)] px-4 py-6 text-center text-[0.92rem] text-[var(--muted-foreground)] sm:px-5 sm:py-8 sm:text-sm">
              No tasks added yet for today. Start by creating today&apos;s work plan.
            </div>
          )}
        </div>

        <div className="shrink-0 border-t border-[var(--panel-border)] px-3 py-1 text-center">
          <Link className="text-xs font-semibold text-[#4f5ef7] hover:text-[#3f4ede] sm:text-sm" href="/dashboard/plan">
            View All Tasks
          </Link>
        </div>
      </div>

      <TaskCompleteModal
        onOpenChange={handleModalOpenChange}
        onSave={handleCompleteSave}
        open={Boolean(completeTaskId)}
        saving={savingCompletion}
        taskTitle={completingTask?.taskTitle ?? ""}
      />

      <TaskAutoStopNoteModal
        initialNote={activeAutoStopTask?.updates[0]?.note ?? ""}
        onOpenChange={(open) => {
          if (!open && activeAutoStopPrompt) {
            dismissAutoStopPrompt(activeAutoStopPrompt.taskId, activeAutoStopPrompt.reportDate);
          }
        }}
        onSave={handleAutoStopNoteSave}
        open={Boolean(activeAutoStopPrompt)}
        saving={savingAutoStopNote}
        stoppedAt={activeAutoStopPrompt?.actualEnd ?? ""}
        taskTitle={activeAutoStopTask?.taskTitle ?? "Stopped task"}
      />
    </>
  );
}
