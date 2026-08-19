import { isMovedToHistory } from "@/lib/task-history-shared";
import { extractFollowUpMeta } from "@/lib/task-follow-up";
import { isRecurringTaskDescription } from "@/lib/recurring-task-templates";
import { toDateOnly } from "@/lib/utils";

type WorkPlanTaskUpdate = {
  status: string;
  reportDate?: Date | string | null;
  updatedAt?: Date | string | null;
  actualStart?: Date | string | null;
  actualEnd?: Date | string | null;
};

export type WorkPlanTaskLike = {
  id: string;
  taskTitle: string;
  taskDescription?: string | null;
  priority: string;
  planDate: Date | string;
  createdAt?: Date | string | null;
  updates: WorkPlanTaskUpdate[];
};

/**
 * Generic over the update row, not the task: callers hand in richer rows than
 * WorkPlanTaskUpdate (tracked minutes, actual start/end) and need them back.
 */
export function getTaskUpdateForDate<U extends WorkPlanTaskUpdate>(
  task: { updates: U[] },
  date = toDateOnly(),
): U | null {
  const matchingUpdate = task.updates.find((update) => {
    if (!update.reportDate) {
      return false;
    }

    return toDateOnly(update.reportDate) === date;
  });

  return matchingUpdate ?? task.updates[0] ?? null;
}

function toTimestamp(value?: Date | string | null) {
  if (!value) {
    return 0;
  }

  const parsed = value instanceof Date ? value : new Date(value);
  const time = parsed.getTime();

  return Number.isNaN(time) ? 0 : time;
}

/**
 * When the task last moved, which is what the dashboard orders by.
 *
 * The work plan used to be sorted by priority, so a Critical task added first
 * thing in the morning stayed pinned above one started ten minutes ago and the
 * columns never reflected what the day actually looked like. Recency reads the
 * newest signal a task has: the stop, then the start, then whatever else last
 * touched the update row, and finally the task's own creation time for one that
 * has not been worked on yet. Priority still shows on the card, it just no
 * longer decides the order.
 */
export function getTaskActivityTimestamp(task: WorkPlanTaskLike, date = toDateOnly()) {
  const update = getTaskUpdateForDate(task, date);

  return Math.max(
    toTimestamp(update?.actualEnd),
    toTimestamp(update?.actualStart),
    toTimestamp(update?.updatedAt),
    toTimestamp(task.createdAt),
  );
}

/** Newest first; equal timestamps fall back to the title so the order stays stable. */
export function compareTasksByRecency(left: WorkPlanTaskLike, right: WorkPlanTaskLike, date = toDateOnly()) {
  return (
    getTaskActivityTimestamp(right, date) - getTaskActivityTimestamp(left, date) ||
    left.taskTitle.localeCompare(right.taskTitle)
  );
}

/** Copies before sorting: callers hand in server props and React state arrays. */
export function sortTasksByRecency<T extends WorkPlanTaskLike>(tasks: T[], date = toDateOnly()) {
  return [...tasks].sort((left, right) => compareTasksByRecency(left, right, date));
}

export function getTaskStatusLabel(status: string) {
  if (status === "done") return "Completed";
  if (status === "in_progress") return "In Progress";
  return "Pending";
}

export function getTaskStatusForDashboard(task: WorkPlanTaskLike, date = toDateOnly()) {
  return getTaskUpdateForDate(task, date)?.status ?? "pending";
}

/** True only when the task has an update row keyed to that exact date — no falling back to the latest one. */
function hasUpdateOnDate(task: WorkPlanTaskLike, date: string) {
  return task.updates.some((update) => update.reportDate && toDateOnly(update.reportDate) === date);
}

/**
 * True for a task whose own plan date is an earlier day — purely descriptive
 * (the "Carried Over" badge), independent of whether it is still open today.
 * A carried task marked done today is still worth labelling as carried, so
 * this does not check status.
 */
export function isCarriedOverTask(task: WorkPlanTaskLike, date = toDateOnly()) {
  return toDateOnly(task.planDate) < date;
}

export function isVisibleInTodaysWorkPlan(task: WorkPlanTaskLike, date = toDateOnly()) {
  if (isMovedToHistory(task.taskDescription)) {
    return false;
  }

  const followUp = extractFollowUpMeta(task.taskDescription);
  if (followUp) {
    return followUp.scheduledDate === date;
  }

  const isPlannedForToday = toDateOnly(task.planDate) === date;
  if (isPlannedForToday) {
    return true;
  }

  if (isRecurringTaskDescription(task.taskDescription)) {
    return true;
  }

  if (!isCarriedOverTask(task, date)) {
    return false;
  }

  // Whatever never got finished on its own day is still open work — carrying
  // it into today is what stops the dashboard from quietly losing it the
  // moment the calendar rolls over. Once it picks up an update row dated
  // today (started, paused, or finished today) it stays visible regardless
  // of status, so marking it done moves it into Complete Task instead of
  // making it vanish — only a task nobody touched today, and that was
  // already finished on some earlier day, drops back out.
  return hasUpdateOnDate(task, date) || getTaskStatusForDashboard(task, date) !== "done";
}

export function filterTodaysWorkPlanTasks<T extends WorkPlanTaskLike>(tasks: T[], date = toDateOnly()) {
  return tasks.filter((task) => isVisibleInTodaysWorkPlan(task, date));
}

export function countDashboardTaskStats(tasks: WorkPlanTaskLike[], date = toDateOnly()) {
  const visibleTasks = filterTodaysWorkPlanTasks(tasks, date);

  const completedTasks = visibleTasks.filter((task) => getTaskStatusForDashboard(task, date) === "done").length;
  const inProgressTasks = visibleTasks.filter((task) => getTaskStatusForDashboard(task, date) === "in_progress").length;
  const pendingTasks = visibleTasks.filter((task) => getTaskStatusForDashboard(task, date) === "pending").length;

  return {
    visibleTasks,
    plannedTasks: visibleTasks.length,
    completedTasks,
    inProgressTasks,
    pendingTasks,
  };
}
