import { stripHistoryMeta } from "@/lib/task-history-shared";
import { stripContinuationMeta } from "@/lib/task-continuation";
import { stripFollowUpMeta } from "@/lib/task-follow-up";
import { stripRecurringTaskMeta } from "@/lib/recurring-task-templates";
import { formatMinutes, toDateOnly } from "@/lib/utils";

const AUTO_PREDICTION_TEXT = /^Predicted from your work pattern and completion history\.?\s*/i;

type TaskUpdateLike = {
  status?: string | null;
  note?: string | null;
  trackedMinutes?: number | null;
  actualStart?: Date | string | null;
  actualEnd?: Date | string | null;
  reportDate?: Date | string | null;
  updatedAt?: Date | string | null;
  completionPercent?: number | null;
};

export type TaskReportLike = {
  id: string;
  taskTitle: string;
  taskDescription?: string | null;
  planDate: Date | string;
  department?: {
    name?: string | null;
  } | null;
  updates?: TaskUpdateLike[];
};

export type ReportSummaryItem = {
  id: string;
  date: string;
  title: string;
  description: string;
  departmentName: string;
  status: "done" | "in_progress" | "pending";
  trackedMinutes: number;
  completionPercent: number;
  note: string;
  actualStart: Date | string | null;
  actualEnd: Date | string | null;
};

function getSortableTimestamp(value?: Date | string | null) {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

export function getReadableTaskDescription(description?: string | null) {
  return stripHistoryMeta(
    stripRecurringTaskMeta(
      stripFollowUpMeta(
        stripContinuationMeta(description),
      ),
    ),
  )
    .replace(AUTO_PREDICTION_TEXT, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getLatestTaskUpdate(task: TaskReportLike) {
  const updates = [...(task.updates ?? [])];
  updates.sort(
    (left, right) =>
      getSortableTimestamp(right.reportDate ?? right.updatedAt) -
      getSortableTimestamp(left.reportDate ?? left.updatedAt),
  );

  return updates[0] ?? null;
}

export function buildReportSummary(tasks: TaskReportLike[]) {
  const items: ReportSummaryItem[] = tasks.map((task) => {
    const latestUpdate = getLatestTaskUpdate(task);
    const status = latestUpdate?.status;

    return {
      id: task.id,
      date: toDateOnly(task.planDate),
      title: task.taskTitle,
      description: getReadableTaskDescription(task.taskDescription),
      departmentName: task.department?.name ?? "General",
      status:
        status === "done" || status === "in_progress" || status === "pending"
          ? status
          : "pending",
      trackedMinutes: Math.max(0, Number(latestUpdate?.trackedMinutes ?? 0)),
      completionPercent: Math.max(0, Number(latestUpdate?.completionPercent ?? 0)),
      note: latestUpdate?.note?.trim() ?? "",
      actualStart: latestUpdate?.actualStart ?? null,
      actualEnd: latestUpdate?.actualEnd ?? null,
    };
  });

  const totalTrackedMinutes = items.reduce((sum, item) => sum + item.trackedMinutes, 0);
  const completedTasks = items.filter((item) => item.status === "done").length;
  const inProgressTasks = items.filter((item) => item.status === "in_progress").length;
  const pendingTasks = items.filter((item) => item.status === "pending").length;

  return {
    items,
    totals: {
      totalTasks: items.length,
      completedTasks,
      inProgressTasks,
      pendingTasks,
      totalTrackedMinutes,
      totalTrackedLabel: formatMinutes(totalTrackedMinutes),
    },
  };
}
