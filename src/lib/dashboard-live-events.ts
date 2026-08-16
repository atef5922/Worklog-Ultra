export type DashboardLiveTask = {
  id: string;
  taskTitle: string;
  taskDescription?: string | null;
  priority: string;
  planDate: string;
  userId: string;
  departmentName: string;
  assignedBy?: string | null;
};

export type DashboardRemovedTask = {
  id: string;
  taskTitle: string;
};

export const DASHBOARD_TASKS_CREATED_EVENT = "dashboard:tasks-created";
export const DASHBOARD_TASKS_REMOVED_EVENT = "dashboard:tasks-removed";
export const DASHBOARD_TASK_AUTOSTART_STORAGE_KEY = "dashboard-task-autostart";

export function dispatchDashboardTasksCreated(tasks: DashboardLiveTask[]) {
  if (typeof window === "undefined" || !tasks.length) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(DASHBOARD_TASKS_CREATED_EVENT, {
      detail: { tasks },
    }),
  );
}

export function dispatchDashboardTasksRemoved(tasks: DashboardRemovedTask[]) {
  if (typeof window === "undefined" || !tasks.length) {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(DASHBOARD_TASKS_REMOVED_EVENT, {
      detail: { tasks },
    }),
  );
}

export function scheduleDashboardTaskAutostart(taskId: string, reportDate: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    DASHBOARD_TASK_AUTOSTART_STORAGE_KEY,
    JSON.stringify({
      taskId,
      reportDate,
      timestamp: Date.now(),
    }),
  );
}
