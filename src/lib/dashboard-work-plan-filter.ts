import { isMovedToHistory } from "@/lib/task-history-shared";
import { extractFollowUpMeta } from "@/lib/task-follow-up";
import { isRecurringTaskDescription } from "@/lib/recurring-task-templates";
import { toDateOnly } from "@/lib/utils";

type WorkPlanTaskUpdate = {
  status: string;
  reportDate?: Date | string | null;
};

export type WorkPlanTaskLike = {
  id: string;
  taskTitle: string;
  taskDescription?: string | null;
  priority: string;
  planDate: Date | string;
  updates: WorkPlanTaskUpdate[];
};

export function getTaskUpdateForDate(task: WorkPlanTaskLike, date = toDateOnly()) {
  const matchingUpdate = task.updates.find((update) => {
    if (!update.reportDate) {
      return false;
    }

    return toDateOnly(update.reportDate) === date;
  });

  return matchingUpdate ?? task.updates[0] ?? null;
}

export function getTaskStatusForDashboard(task: WorkPlanTaskLike, date = toDateOnly()) {
  return getTaskUpdateForDate(task, date)?.status ?? "pending";
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

  return isRecurringTaskDescription(task.taskDescription);
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
