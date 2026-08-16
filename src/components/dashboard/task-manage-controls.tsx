"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Archive, CheckSquare, Pencil, Trash2, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { dispatchDashboardTasksRemoved } from "@/lib/dashboard-live-events";
import { embedHistoryMeta, isMovedToHistory, stripHistoryMeta } from "@/lib/task-history-shared";
import { embedRecurringTaskDescription, isRecurringTaskDescription, stripRecurringTaskMeta } from "@/lib/recurring-task-templates";
import { toDateOnly } from "@/lib/utils";

const AUTO_PREDICTION_TEXT = /^Predicted from your work pattern and completion history\.?\s*/i;

function parseResponse(raw: string) {
  try {
    return raw ? JSON.parse(raw) : { message: "Task update failed." };
  } catch {
    return { message: "The server returned an unexpected response." };
  }
}

export function TaskManageControls({
  task,
  compact = false,
  hideDoneAction = false,
  showInlineDelete = false,
  showArchiveAction = false,
  timerPanel,
  onMovedToHistory,
}: {
  task: {
    id: string;
    taskTitle: string;
    taskDescription?: string | null;
    priority: "low" | "normal" | "high" | "critical";
  };
  compact?: boolean;
  hideDoneAction?: boolean;
  showInlineDelete?: boolean;
  showArchiveAction?: boolean;
  timerPanel?: ReactNode;
  onMovedToHistory?: (taskId: string) => void;
}) {
  const router = useRouter();
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [doneOpen, setDoneOpen] = useState(false);
  const [title, setTitle] = useState(task.taskTitle);
  const [description, setDescription] = useState(task.taskDescription ?? "");
  const [priority, setPriority] = useState(task.priority);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [markingDone, setMarkingDone] = useState(false);
  const [movingToHistory, setMovingToHistory] = useState(false);
  const isRecurringTask = isRecurringTaskDescription(task.taskDescription);
  const isAlreadyMovedToHistory = isMovedToHistory(task.taskDescription);
  const editButtonClass =
    "button-force-white h-8 shrink-0 rounded-full border border-white/20 px-2.5 text-[0.625rem] font-semibold tracking-[0.01em] bg-gradient-to-r from-[#4f46e5] via-[#8b5cf6] to-[#ec4899] shadow-[0_10px_24px_rgba(99,102,241,0.32)] transition-all duration-200 hover:scale-[1.02] hover:from-[#4338ca] hover:via-[#7c3aed] hover:to-[#db2777] active:scale-95 min-[420px]:px-3 min-[420px]:text-xs";
  const markDoneButtonClass =
    "button-force-white h-8 shrink-0 rounded-full border border-white/20 px-2.5 text-[0.625rem] font-semibold tracking-[0.01em] bg-gradient-to-r from-[#06b6d4] via-[#3b82f6] to-[#8b5cf6] shadow-[0_10px_24px_rgba(59,130,246,0.3)] hover:scale-[1.02] hover:from-[#0891b2] hover:via-[#2563eb] hover:to-[#7c3aed] transition-all duration-200 disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none disabled:hover:scale-100 min-[420px]:px-3 min-[420px]:text-xs";
  const quickMoveButtonClass =
    "button-force-white h-8 w-8 rounded-full border border-white/20 bg-gradient-to-r from-[#0f766e] via-[#0f9f8a] to-[#14b8a6] p-0 text-white shadow-[0_10px_24px_rgba(20,184,166,0.28)] transition-all duration-200 hover:scale-[1.02] hover:from-[#115e59] hover:via-[#0f766e] hover:to-[#0d9488] active:scale-95 disabled:from-slate-300 disabled:to-slate-300 disabled:shadow-none disabled:hover:scale-100";

  function toEditableDescription(value?: string | null) {
    return stripHistoryMeta(stripRecurringTaskMeta(value)).replace(AUTO_PREDICTION_TEXT, "").trim();
  }

  async function saveTask() {
    if (!title.trim()) {
      toast.error("Task title is required.");
      return;
    }

    setSaving(true);
    const response = await fetch(`/api/dashboard/tasks/${task.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskTitle: title.trim(),
        taskDescription:
          isAlreadyMovedToHistory
            ? embedHistoryMeta(
                isRecurringTask ? embedRecurringTaskDescription(description.trim()) : description.trim(),
              )
            : isRecurringTask
              ? embedRecurringTaskDescription(description.trim())
              : description.trim(),
        priority,
      }),
    });
    const raw = await response.text();
    const result = parseResponse(raw);
    setSaving(false);

    if (!response.ok) {
      toast.error(result.message);
      return;
    }

    toast.success(result.message);
    setEditOpen(false);
    router.refresh();
  }

  async function moveTaskToHistory(options?: { skipDialogClose?: boolean; silent?: boolean }) {
    const setBusy = options?.skipDialogClose ? setMovingToHistory : setMarkingDone;
    setBusy(true);
    const response = await fetch(`/api/dashboard/tasks/${task.id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "move_to_history", reportDate: toDateOnly() }),
    });
    const raw = await response.text();
    const result = parseResponse(raw);
    setBusy(false);

    if (!response.ok) {
      toast.error(result.message);
      return;
    }

    if (!options?.silent) {
      toast.success(result.message);
    }

    dispatchDashboardTasksRemoved([{ id: task.id, taskTitle: task.taskTitle }]);

    if (!options?.skipDialogClose) {
      setDoneOpen(false);
    }

    onMovedToHistory?.(task.id);
    router.refresh();
  }

  async function markTaskDone() {
    await moveTaskToHistory();
  }

  async function deleteTask() {
    setDeleting(true);
    const response = await fetch(`/api/dashboard/tasks/${task.id}`, {
      method: "DELETE",
    });
    const raw = await response.text();
    const result = parseResponse(raw);
    setDeleting(false);

    if (!response.ok) {
      toast.error(result.message);
      return;
    }

    toast.success(result.message);
    dispatchDashboardTasksRemoved([{ id: task.id, taskTitle: task.taskTitle }]);
    setEditOpen(false);
    router.refresh();
  }

  return (
    <div className={`flex items-center gap-1 ${compact ? "shrink-0 flex-nowrap" : "mt-2 w-full flex-wrap gap-1.5"}`}>
      <Dialog.Root
        onOpenChange={(open) => {
          setEditOpen(open);
          if (open) {
            setTitle(task.taskTitle);
            setDescription(toEditableDescription(task.taskDescription));
            setPriority(task.priority);
          }
        }}
        open={editOpen}
      >
        <Dialog.Trigger asChild>
          <Button className={editButtonClass} size="sm" type="button" variant="default">
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Button>
        </Dialog.Trigger>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(560px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] border border-[var(--panel-border)] bg-[var(--panel)] shadow-2xl outline-none">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--panel-border)] px-6 py-5">
              <div>
                <Dialog.Title className="text-xl font-semibold text-[var(--foreground)]">Edit task</Dialog.Title>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">Update title, note, or priority anytime.</p>
              </div>
              <Dialog.Close asChild>
                <Button size="icon" type="button" variant="ghost">
                  <X className="h-4 w-4" />
                </Button>
              </Dialog.Close>
            </div>
            <div className="space-y-4 px-6 py-6">
              <div>
                <Label>Task Title</Label>
                <Input onChange={(event) => setTitle(event.target.value)} value={title} />
              </div>
              <div>
                <Label>Priority</Label>
                <Select onValueChange={(value) => setPriority(value as typeof priority)} value={priority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="critical">High Priority</SelectItem>
                    <SelectItem value="high">Important</SelectItem>
                    <SelectItem value="normal">Medium</SelectItem>
                    <SelectItem value="low">Low</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Task Note</Label>
                <Textarea onChange={(event) => setDescription(event.target.value)} rows={5} value={description} />
              </div>
              {timerPanel ? (
                <div className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-4">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Live Timer</p>
                  {timerPanel}
                </div>
              ) : null}
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--panel-border)] px-6 py-5">
              <Button
                className="text-rose-600 hover:bg-rose-50 hover:text-rose-700"
                disabled={deleting || saving}
                onClick={deleteTask}
                type="button"
                variant="outline"
              >
                {deleting ? "Deleting..." : "Delete Task"}
              </Button>
              <div className="flex items-center gap-3">
              <Dialog.Close asChild>
                <Button type="button" variant="outline">
                  Cancel
                </Button>
              </Dialog.Close>
              <Button className="button-force-white" disabled={saving} onClick={saveTask} type="button">
                {saving ? "Saving..." : "Save Changes"}
              </Button>
              </div>
            </div>
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      {showInlineDelete ? (
        <Dialog.Root onOpenChange={setDeleteOpen} open={deleteOpen}>
          <Dialog.Trigger asChild>
            <Button
              className="h-8 shrink-0 rounded-full px-2.5 text-[0.625rem] text-rose-600 hover:bg-rose-50 hover:text-rose-700 min-[420px]:px-3 min-[420px]:text-xs"
              size="sm"
              type="button"
              variant="outline"
            >
              <Trash2 className="h-3.5 w-3.5" />
              Delete
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] border border-[var(--panel-border)] bg-[var(--panel)] shadow-2xl outline-none">
              <div className="space-y-4 px-6 py-6">
                <Dialog.Title className="text-xl font-semibold text-[var(--foreground)]">Delete task</Dialog.Title>
                <p className="text-sm text-[var(--muted-foreground)]">
                  This will permanently remove this task from your records.
                </p>
              </div>
              <div className="flex justify-end gap-3 border-t border-[var(--panel-border)] px-6 py-5">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button
                  className="button-force-white bg-rose-600 hover:bg-rose-700"
                  disabled={deleting}
                  onClick={async () => {
                    await deleteTask();
                    setDeleteOpen(false);
                  }}
                  type="button"
                >
                  {deleting ? "Deleting..." : "Delete"}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}

      {showArchiveAction && compact && !isAlreadyMovedToHistory ? (
        <Button
          aria-label="Move task to history"
          className={quickMoveButtonClass}
          disabled={movingToHistory || saving || deleting}
          onClick={() => void moveTaskToHistory({ skipDialogClose: true })}
          size="icon"
          title="Move this task to history"
          type="button"
          variant="default"
        >
          <Archive className="h-3.5 w-3.5" />
        </Button>
      ) : null}

      {!hideDoneAction ? (
        <Dialog.Root onOpenChange={setDoneOpen} open={doneOpen}>
          <Dialog.Trigger asChild>
            <Button
              className={markDoneButtonClass}
              disabled={isAlreadyMovedToHistory}
              size="sm"
              variant="default"
              type="button"
            >
              <CheckSquare className="h-3.5 w-3.5" />
              {isAlreadyMovedToHistory ? "Done" : "Mark Done"}
            </Button>
          </Dialog.Trigger>
          <Dialog.Portal>
            <Dialog.Overlay className="fixed inset-0 z-40 bg-slate-950/70 backdrop-blur-sm" />
            <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(440px,92vw)] -translate-x-1/2 -translate-y-1/2 rounded-[1.75rem] border border-[var(--panel-border)] bg-[var(--panel)] shadow-2xl outline-none">
              <div className="space-y-4 px-6 py-6">
                <Dialog.Title className="text-xl font-semibold text-[var(--foreground)]">Move task to history</Dialog.Title>
                <p className="text-sm text-[var(--muted-foreground)]">
                  This will mark the task as finished and remove it from the dashboard. All records and tracked history will stay saved.
                </p>
              </div>
              <div className="flex justify-end gap-3 border-t border-[var(--panel-border)] px-6 py-5">
                <Dialog.Close asChild>
                  <Button type="button" variant="outline">
                    Cancel
                  </Button>
                </Dialog.Close>
                <Button className="button-force-white bg-emerald-600 hover:bg-emerald-700" disabled={markingDone} onClick={markTaskDone} type="button">
                  {markingDone ? "Saving..." : "Mark As Done"}
                </Button>
              </div>
            </Dialog.Content>
          </Dialog.Portal>
        </Dialog.Root>
      ) : null}
    </div>
  );
}
