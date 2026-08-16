"use client";

import { CheckCircle2, ClipboardCheck, CornerDownLeft, Paperclip, SendHorizonal, TimerReset, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useState } from "react";
import { toast } from "sonner";
import { AssignmentReviewControls } from "@/components/dashboard/assignment-review-controls";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { extractAssignmentAttachmentMeta } from "@/lib/assignment-attachments";
import { readTaskTimerSnapshot, writeTaskTimerSnapshot } from "@/lib/task-timer-storage";
import { formatDateTimeInDhaka, toDateOnly } from "@/lib/utils";

type Department = { id: string; name: string };
type AssignableUser = {
  id: string;
  name: string;
  role: string;
  designation: string | null;
  departmentId: string | null;
  departmentName: string;
};

type AssignmentTask = {
  id: string;
  planDate: Date;
  createdAt: Date;
  taskTitle: string;
  taskDescription: string | null;
  priority: string;
  department: { name: string };
  user: { name: string; department?: { name: string | null } | null };
  assigner?: { name: string | null; department?: { name: string | null } | null } | null;
  updates: Array<{
    status: "done" | "in_progress" | "pending";
    note: string | null;
    trackedMinutes: number;
    actualStart?: Date | null;
    actualEnd?: Date | null;
    updatedAt?: Date;
  }>;
  latestReview: {
    id: string;
    status: "pending" | "approved" | "rejected";
    submitNote: string;
    submitAttachments?: Array<{
      fileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
    }>;
    reviewNote: string | null;
    reviewAttachments?: Array<{
      fileName: string;
      fileUrl: string;
      fileType: string;
      fileSize: number;
    }>;
    createdAt: Date;
    reviewedAt: Date | null;
    requestedById: string;
    reviewerId: string | null;
  } | null;
};

type SelectedAssignment =
  | { task: AssignmentTask; list: "assignedByMe" }
  | { task: AssignmentTask; list: "assignedToMe" };

function assignmentStatus(task: AssignmentTask) {
  return task.updates[0]?.status ?? "pending";
}

function priorityVariant(priority: string) {
  if (priority === "critical") return "warning";
  if (priority === "high") return "purple";
  if (priority === "low") return "secondary";
  return "default";
}

function statusVariant(status: "done" | "in_progress" | "pending") {
  if (status === "done") return "success";
  if (status === "in_progress") return "purple";
  return "warning";
}

function toInputDateTime(value?: Date | string | null) {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const dhakaFormatter = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = dhakaFormatter.formatToParts(date);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}`;
}

function formatLiveDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

export function AssignmentsCenter({
  currentUserId,
  departments = [],
  assignableUsers = [],
  assignedByMe = [],
  assignedToMe = [],
}: {
  currentUserId: string;
  departments: Department[];
  assignableUsers: AssignableUser[];
  assignedByMe: AssignmentTask[];
  assignedToMe: AssignmentTask[];
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const assignmentFileInputId = useId();
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState("normal");
  const [departmentId, setDepartmentId] = useState(assignableUsers.find((item) => item.id === currentUserId)?.departmentId || departments[0]?.id || "");
  const [assigneeId, setAssigneeId] = useState(currentUserId);
  const [note, setNote] = useState("");
  const [assignmentFiles, setAssignmentFiles] = useState<File[]>([]);
  const [selectedAssignment, setSelectedAssignment] = useState<SelectedAssignment | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [reviewSaving, setReviewSaving] = useState(false);
  const [workStatus, setWorkStatus] = useState<"done" | "in_progress" | "pending">("pending");
  const [workNote, setWorkNote] = useState("");
  const [workTrackedMinutes, setWorkTrackedMinutes] = useState("0");
  const [workActualStart, setWorkActualStart] = useState("");
  const [workActualEnd, setWorkActualEnd] = useState("");
  const [workRunningStartedAt, setWorkRunningStartedAt] = useState("");
  const [workTrackedSeconds, setWorkTrackedSeconds] = useState(0);
  const [workFiles, setWorkFiles] = useState<File[]>([]);
  const [workSaving, setWorkSaving] = useState(false);
  const [submittingWork, setSubmittingWork] = useState(false);
  const [liveNow, setLiveNow] = useState(() => Date.now());

  const filteredUsers = useMemo(
    () => assignableUsers.filter((member) => !departmentId || member.departmentId === departmentId),
    [assignableUsers, departmentId],
  );

  function closeSelectedAssignment() {
    setSelectedAssignment(null);

    const taskId = searchParams.get("taskId");
    const from = searchParams.get("from");

    if (!taskId && !from) {
      return;
    }

    const params = new URLSearchParams(searchParams.toString());
    params.delete("taskId");
    params.delete("from");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `/dashboard/assignments?${nextQuery}` : "/dashboard/assignments", { scroll: false });
  }

  useEffect(() => {
    const interval = window.setInterval(() => setLiveNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const taskId = searchParams.get("taskId");
    const fromNotification = searchParams.get("from") === "notification";

    if (!taskId) {
      return;
    }

    const taskFromAssignedByMe = assignedByMe.find((item) => item.id === taskId);
    const taskFromAssignedToMe = assignedToMe.find((item) => item.id === taskId);
    const task = taskFromAssignedByMe ?? taskFromAssignedToMe;

    if (!task) {
      return;
    }

    setSelectedAssignment({ task, list: taskFromAssignedByMe ? "assignedByMe" : "assignedToMe" });

    if (fromNotification) {
      const updatedAt = task.updates[0]?.updatedAt ?? task.createdAt;
      window.localStorage.setItem(`assignment-notification-read:${task.id}:${new Date(updatedAt).toISOString()}`, "read");
      window.localStorage.setItem(`assignment-notification-seen:${task.id}:${new Date(updatedAt).toISOString()}`, "seen");
    }
  }, [assignedByMe, assignedToMe, searchParams]);

  useEffect(() => {
    if (!selectedAssignment || selectedAssignment.list !== "assignedToMe") {
      setWorkFiles([]);
      return;
    }

    const task = selectedAssignment.task;
    const reportDate = toDateOnly(task.planDate);
    const snapshot = readTaskTimerSnapshot(reportDate, task.id);
    const latest = task.updates[0];
    const trackedSecondsFromSnapshot = Number(snapshot?.trackedSeconds ?? String(Number(snapshot?.trackedMinutes ?? latest?.trackedMinutes ?? 0) * 60));

    setWorkStatus(snapshot?.status ?? latest?.status ?? "pending");
    setWorkNote(task.latestReview?.submitNote || latest?.note || "");
    setWorkTrackedMinutes(snapshot?.trackedMinutes ?? String(latest?.trackedMinutes ?? 0));
    setWorkTrackedSeconds(trackedSecondsFromSnapshot);
    setWorkActualStart(snapshot?.actualStart ?? toInputDateTime(latest?.actualStart));
    setWorkActualEnd(snapshot?.actualEnd ?? toInputDateTime(latest?.actualEnd));
    setWorkRunningStartedAt(snapshot?.runningStartedAt ?? "");
    setWorkFiles([]);
  }, [selectedAssignment]);

  async function assignTask() {
    if (!title.trim()) {
      toast.error("Task title is required.");
      return;
    }

    setSaving(true);
    const payload = new FormData();
    payload.append("taskTitle", title);
    payload.append("priority", priority);
    payload.append("departmentId", departmentId);
    payload.append("assigneeId", assigneeId);
    payload.append("note", note);
    assignmentFiles.forEach((file) => payload.append("attachments", file));
    const response = await fetch("/api/dashboard/assignments", {
      method: "POST",
      body: payload,
    });
    const raw = await response.text();
    const result = raw ? JSON.parse(raw) : { message: "Task assignment failed." };
    setSaving(false);

    if (!response.ok) {
      toast.error(result.message);
      return;
    }

    toast.success("Task assigned successfully.");
    setTitle("");
    setPriority("normal");
    setNote("");
    setAssignmentFiles([]);
    router.refresh();
  }

  const selectedTask = selectedAssignment?.task ?? null;
  const latestUpdate = selectedTask?.updates[0] ?? null;
  const selectedReview = selectedTask?.latestReview ?? null;
  const canDirectReview = selectedAssignment?.list === "assignedByMe" && selectedReview?.status === "pending";
  const assignmentBrief = extractAssignmentAttachmentMeta(selectedTask?.taskDescription);

  async function runSelectedAssignmentReview(action: "approve" | "reject") {
    if (!selectedTask) {
      return;
    }

    setReviewSaving(true);
    const response = await fetch(`/api/dashboard/assignments/${selectedTask.id}/review`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, note: reviewNote }),
    });
    const raw = await response.text();
    const result = raw ? JSON.parse(raw) : { message: "Assignment review action failed." };
    setReviewSaving(false);

    if (!response.ok) {
      toast.error(result.message);
      return;
    }

    toast.success(result.message);
    setReviewNote("");
    closeSelectedAssignment();
    router.refresh();
  }

  const liveWorkTrackedSeconds =
    workRunningStartedAt && !Number.isNaN(new Date(workRunningStartedAt).getTime())
      ? workTrackedSeconds + Math.max(0, Math.floor((liveNow - new Date(workRunningStartedAt).getTime()) / 1000))
      : workTrackedSeconds;

  function persistWorkSnapshot(next: {
    status: "done" | "in_progress" | "pending";
    trackedMinutes: string;
    trackedSeconds: number;
    actualStart: string;
    actualEnd: string;
    runningStartedAt: string;
  }) {
    if (!selectedTask || selectedAssignment?.list !== "assignedToMe") {
      return;
    }

    writeTaskTimerSnapshot(toDateOnly(selectedTask.planDate), selectedTask.id, {
      status: next.status,
      trackedMinutes: next.trackedMinutes,
      trackedSeconds: String(next.trackedSeconds),
      actualStart: next.actualStart,
      actualEnd: next.actualEnd,
      runningStartedAt: next.runningStartedAt,
    });
  }

  async function saveAssignmentWork(nextStatus?: "done" | "in_progress" | "pending") {
    if (!selectedTask || selectedAssignment?.list !== "assignedToMe") {
      return false;
    }

    const finalStatus = nextStatus ?? workStatus;
    const finalTrackedMinutes = String(Math.floor(liveWorkTrackedSeconds / 60));
    const finalActualEnd =
      nextStatus === "done" && !workActualEnd
        ? toInputDateTime(new Date())
        : workActualEnd;

    setWorkSaving(true);
    const response = await fetch("/api/dashboard/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        reportDate: toDateOnly(selectedTask.planDate),
        updates: [
          {
            dailyTaskId: selectedTask.id,
            status: finalStatus,
            note: workNote,
            completionPercent: finalStatus === "done" ? 100 : 0,
            trackedMinutes: Number(finalTrackedMinutes),
            actualStart: workActualStart,
            actualEnd: finalActualEnd,
            difficultyLevel: "",
          },
        ],
      }),
    });
    const raw = await response.text();
    const result = raw ? JSON.parse(raw) : { message: "Assignment work could not be saved." };
    setWorkSaving(false);

    if (!response.ok) {
      toast.error(result.message);
      return false;
    }

    setWorkStatus(finalStatus);
    setWorkTrackedMinutes(finalTrackedMinutes);
    setWorkTrackedSeconds(liveWorkTrackedSeconds);
    setWorkActualEnd(finalActualEnd);
    setWorkRunningStartedAt("");
    persistWorkSnapshot({
      status: finalStatus,
      trackedMinutes: finalTrackedMinutes,
      trackedSeconds: liveWorkTrackedSeconds,
      actualStart: workActualStart,
      actualEnd: finalActualEnd,
      runningStartedAt: "",
    });
    toast.success(nextStatus === "done" ? "Assignment marked complete." : "Assignment work saved.");
    if (nextStatus === "done") {
      closeSelectedAssignment();
    }
    router.refresh();
    return true;
  }

  function startAssignmentTimer() {
    if (!selectedTask || selectedAssignment?.list !== "assignedToMe" || workSaving) {
      return;
    }

    const now = new Date();
    const startValue = workActualStart || toInputDateTime(now);
    const nextRunningStartedAt = now.toISOString();
    setWorkStatus("in_progress");
    setWorkActualStart(startValue);
    setWorkActualEnd("");
    setWorkRunningStartedAt(nextRunningStartedAt);
    persistWorkSnapshot({
      status: "in_progress",
      trackedMinutes: String(Math.floor(workTrackedSeconds / 60)),
      trackedSeconds: workTrackedSeconds,
      actualStart: startValue,
      actualEnd: "",
      runningStartedAt: nextRunningStartedAt,
    });
  }

  function pauseAssignmentTimer() {
    if (!selectedTask || selectedAssignment?.list !== "assignedToMe" || !workRunningStartedAt) {
      return;
    }

    const pausedMinutes = String(Math.floor(liveWorkTrackedSeconds / 60));
    setWorkStatus("in_progress");
    setWorkTrackedMinutes(pausedMinutes);
    setWorkTrackedSeconds(liveWorkTrackedSeconds);
    setWorkRunningStartedAt("");
    persistWorkSnapshot({
      status: "in_progress",
      trackedMinutes: pausedMinutes,
      trackedSeconds: liveWorkTrackedSeconds,
      actualStart: workActualStart,
      actualEnd: "",
      runningStartedAt: "",
    });
  }

  function stopAssignmentTimer() {
    if (!selectedTask || selectedAssignment?.list !== "assignedToMe") {
      return;
    }

    const endValue = toInputDateTime(new Date());
    const stoppedMinutes = String(Math.floor(liveWorkTrackedSeconds / 60));
    setWorkStatus("in_progress");
    setWorkTrackedMinutes(stoppedMinutes);
    setWorkTrackedSeconds(liveWorkTrackedSeconds);
    setWorkActualEnd(endValue);
    setWorkRunningStartedAt("");
    persistWorkSnapshot({
      status: "in_progress",
      trackedMinutes: stoppedMinutes,
      trackedSeconds: liveWorkTrackedSeconds,
      actualStart: workActualStart,
      actualEnd: endValue,
      runningStartedAt: "",
    });
  }

  async function submitAssignmentWork() {
    if (!selectedTask || selectedAssignment?.list !== "assignedToMe") {
      return;
    }

    const saved = await saveAssignmentWork();
    if (!saved) {
      return;
    }

    setSubmittingWork(true);
    const payload = new FormData();
    payload.append("action", "submit");
    payload.append("note", workNote);
    workFiles.forEach((file) => payload.append("attachments", file));
    const response = await fetch(`/api/dashboard/assignments/${selectedTask.id}/review`, {
      method: "POST",
      body: payload,
    });
    const raw = await response.text();
    const result = raw ? JSON.parse(raw) : { message: "Assignment submit failed." };
    setSubmittingWork(false);

    if (!response.ok) {
      toast.error(result.message);
      return;
    }

    toast.success(result.message);
    setWorkFiles([]);
    closeSelectedAssignment();
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Assign Task</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_320px]">
          <div className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>From Department</Label>
                <Select value={departmentId} onValueChange={setDepartmentId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(departments ?? []).map((department) => (
                      <SelectItem key={department.id} value={department.id}>
                        {department.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Assign To</Label>
                <Select value={assigneeId} onValueChange={setAssigneeId}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(filteredUsers ?? []).map((member) => (
                      <SelectItem key={member.id} value={member.id}>
                        {member.name} - {member.departmentName}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
              <div>
                <Label>Task Title</Label>
                <Input onChange={(event) => setTitle(event.target.value)} placeholder="Cross-team task title" value={title} />
              </div>
              <div>
                <Label>Priority</Label>
                <Select value={priority} onValueChange={setPriority}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {["low", "normal", "high", "critical"].map((item) => (
                      <SelectItem key={item} value={item}>
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <Label>Assignment Note</Label>
              <Textarea onChange={(event) => setNote(event.target.value)} placeholder="Explain what support is needed, expected output, or deadline." value={note} />
            </div>
            <div>
              <Label>Attach Files</Label>
              <input
                className="hidden"
                id={assignmentFileInputId}
                multiple
                onChange={(event) => setAssignmentFiles(Array.from(event.target.files ?? []))}
                type="file"
              />
              <label
                className="mt-2 flex cursor-pointer items-center justify-between rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-muted)] px-4 py-3 text-sm text-[var(--foreground)]"
                htmlFor={assignmentFileInputId}
              >
                <span className="inline-flex items-center gap-2 rounded-xl bg-[#4f5ef7] px-3 py-2 text-xs font-semibold text-white">
                  <Paperclip className="h-3.5 w-3.5" />
                  Choose Files
                </span>
                <span className="ml-3 truncate text-right text-[var(--muted-foreground)]">
                  {assignmentFiles.length
                    ? assignmentFiles.length === 1
                      ? assignmentFiles[0]?.name
                      : `${assignmentFiles.length} files selected`
                    : "Optional files for assignee"}
                </span>
              </label>
              {assignmentFiles.length ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted-foreground)]">
                  {assignmentFiles.map((file) => (
                    <span
                      key={`${file.name}-${file.size}`}
                      className="rounded-full border border-[var(--panel-border)] bg-[var(--panel)] px-2.5 py-1"
                    >
                      {file.name}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
            <Button className="button-force-white bg-[#4f5ef7] hover:bg-[#4453eb]" disabled={saving} onClick={assignTask} type="button">
              <SendHorizonal className="h-4 w-4" />
              {saving ? "Assigning..." : "Assign Task"}
            </Button>
          </div>
          <div className="rounded-3xl border border-slate-200 bg-slate-50 p-4">
            <p className="text-sm font-semibold text-slate-900">How it works</p>
            <div className="mt-3 space-y-3 text-sm text-slate-600">
              <p>Use this page when your team needs help from another person or department.</p>
              <p>The assignment note becomes the original task brief.</p>
              <p>The assignee can work, track time, attach files, and submit directly from the assignment popup.</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-5 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Assigned By Me</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {assignedByMe.length ? (
              (assignedByMe ?? []).map((task) => (
                <div key={task.id} className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{task.taskTitle}</p>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        To: {task.user.name} - {task.user.department?.name ?? task.department.name}
                      </p>
                    </div>
                    <Badge variant={statusVariant(assignmentStatus(task))}>{assignmentStatus(task)}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted-foreground)]">{extractAssignmentAttachmentMeta(task.taskDescription).text || "No assignment note."}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] p-3">
                    <div className="text-sm text-[var(--muted-foreground)]">
                      Latest note:
                      <span className="ml-2 text-white">{task.updates[0]?.note || "No submission note yet."}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <AssignmentReviewControls latestReview={task.latestReview} mode="assigner" taskId={task.id} taskTitle={task.taskTitle} />
                      <Button
                        onClick={() => {
                          setSelectedAssignment({ task, list: "assignedByMe" });
                          setReviewNote(task.latestReview?.reviewNote ?? "");
                        }}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        View Details
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">No assignment created by you today.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Assigned To Me</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {assignedToMe.length ? (
              (assignedToMe ?? []).map((task) => (
                <div key={task.id} className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-semibold text-white">{task.taskTitle}</p>
                      <p className="text-sm text-[var(--muted-foreground)]">
                        From: {task.assigner?.name ?? "Workspace"} - {task.department.name}
                      </p>
                    </div>
                    <Badge variant={statusVariant(assignmentStatus(task))}>{assignmentStatus(task)}</Badge>
                  </div>
                  <p className="mt-3 text-sm text-[var(--muted-foreground)]">{extractAssignmentAttachmentMeta(task.taskDescription).text || "No assignment note."}</p>
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] p-3">
                    <div className="text-sm text-[var(--muted-foreground)]">
                      Submit note:
                      <span className="ml-2 text-white">{task.latestReview?.submitNote || task.updates[0]?.note || "Open submit popup and send your update from here."}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        onClick={() => {
                          setSelectedAssignment({ task, list: "assignedToMe" });
                          setReviewNote("");
                        }}
                        size="sm"
                        type="button"
                        variant="secondary"
                      >
                        Submit
                      </Button>
                    </div>
                  </div>
                </div>
              ))
            ) : (
              <p className="text-sm text-[var(--muted-foreground)]">No task has been assigned to you today.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {selectedTask ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-2xl overflow-y-auto rounded-3xl border border-[var(--panel-border)] bg-[var(--panel)] shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-[var(--panel-border)] px-6 py-5">
              <div>
                <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">
                  {selectedAssignment?.list === "assignedByMe" ? "Assigned By You" : "Assigned To You"}
                </p>
                <h3 className="mt-2 text-2xl font-semibold text-white">{selectedTask.taskTitle}</h3>
                <p className="mt-1 text-sm text-[var(--muted-foreground)]">
                  {selectedAssignment?.list === "assignedByMe"
                    ? `Assigned to ${selectedTask.user.name}`
                    : `Assigned by ${selectedTask.assigner?.name ?? "Workspace"}`}{" "}
                  - {selectedTask.department.name} - {toDateOnly(selectedTask.planDate)}
                </p>
              </div>
              <Button onClick={closeSelectedAssignment} size="icon" type="button" variant="ghost">
                <X className="h-5 w-5" />
              </Button>
            </div>

            <div className="space-y-5 px-6 py-6">
              <div className="flex flex-wrap gap-2">
                <Badge variant={priorityVariant(selectedTask.priority)}>{selectedTask.priority}</Badge>
                <Badge variant={statusVariant(assignmentStatus(selectedTask))}>{assignmentStatus(selectedTask)}</Badge>
              </div>

              <div className="space-y-3 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Assignment Brief</p>
                  <p className="mt-1 whitespace-pre-line leading-6 text-white/90">
                    {assignmentBrief.text || "No extra assignment brief was added."}
                  </p>
                  {assignmentBrief.attachments.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {assignmentBrief.attachments.map((attachment) => (
                        <a
                          key={attachment.fileUrl}
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--panel-muted)] px-3 py-1 text-xs text-[var(--foreground)]"
                          href={attachment.fileUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {attachment.fileName}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Tracked</p>
                    <p className="mt-1 text-white">{latestUpdate?.trackedMinutes ?? 0} min</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Last Update</p>
                    <p className="mt-1 text-white">{formatDateTimeInDhaka(latestUpdate?.updatedAt)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Started</p>
                    <p className="mt-1 text-white">{formatDateTimeInDhaka(latestUpdate?.actualStart)}</p>
                  </div>
                  <div>
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Ended</p>
                    <p className="mt-1 text-white">{formatDateTimeInDhaka(latestUpdate?.actualEnd)}</p>
                  </div>
                </div>
              </div>

              <div className="space-y-1 text-sm">
                <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Submission / Progress Note</p>
                <p className="whitespace-pre-line leading-6 text-white/90">{latestUpdate?.note || "No submission note yet."}</p>
              </div>

              {selectedTask.latestReview ? (
                <div className="space-y-1 text-sm">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Assignment Review</p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(selectedTask.latestReview.status === "rejected" ? "pending" : selectedTask.latestReview.status === "approved" ? "done" : "in_progress")}>
                      {selectedTask.latestReview.status}
                    </Badge>
                  </div>
                  <p className="whitespace-pre-line leading-6 text-white/90">{selectedTask.latestReview.submitNote || "No submit note yet."}</p>
                  {selectedTask.latestReview.submitAttachments?.length ? (
                    <div className="flex flex-wrap gap-2">
                      {selectedTask.latestReview.submitAttachments.map((attachment) => (
                        <a
                          key={attachment.fileUrl}
                          className="inline-flex items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--panel-muted)] px-3 py-1 text-xs text-[var(--foreground)]"
                          href={attachment.fileUrl}
                          rel="noreferrer"
                          target="_blank"
                        >
                          <Paperclip className="h-3.5 w-3.5" />
                          {attachment.fileName}
                        </a>
                      ))}
                    </div>
                  ) : null}
                  {selectedTask.latestReview.reviewNote || selectedTask.latestReview.reviewAttachments?.length ? (
                    <div className="space-y-2">
                      {selectedTask.latestReview.reviewNote ? (
                        <p className="whitespace-pre-line leading-6 text-white/70">Reviewer note: {selectedTask.latestReview.reviewNote}</p>
                      ) : null}
                      {selectedTask.latestReview.reviewAttachments?.length ? (
                        <div className="flex flex-wrap gap-2">
                          {selectedTask.latestReview.reviewAttachments.map((attachment) => (
                            <a
                              key={attachment.fileUrl}
                              className="inline-flex items-center gap-2 rounded-full border border-[var(--panel-border)] bg-[var(--panel-muted)] px-3 py-1 text-xs text-[var(--foreground)]"
                              href={attachment.fileUrl}
                              rel="noreferrer"
                              target="_blank"
                            >
                              <Paperclip className="h-3.5 w-3.5" />
                              {attachment.fileName}
                            </a>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              ) : null}

              {selectedAssignment?.list === "assignedToMe" ? (
                <div className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Work Submission</p>
                    <span className="rounded-full border border-[var(--panel-border)] bg-[var(--panel)] px-3 py-1 text-sm font-semibold text-white">
                      {formatLiveDuration(liveWorkTrackedSeconds)}
                    </span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      className="button-force-white bg-emerald-500 hover:bg-emerald-600"
                      disabled={Boolean(workRunningStartedAt) || workSaving}
                      onClick={startAssignmentTimer}
                      size="sm"
                      type="button"
                    >
                      {workTrackedSeconds > 0 || workActualStart ? "Resume" : "Start"}
                    </Button>
                    <Button
                      disabled={!workRunningStartedAt || workSaving}
                      onClick={pauseAssignmentTimer}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      Pause
                    </Button>
                    <Button
                      disabled={(!workRunningStartedAt && !workActualStart) || workSaving}
                      onClick={stopAssignmentTimer}
                      size="sm"
                      type="button"
                      variant="outline"
                    >
                      End
                    </Button>
                    <Button
                      className="button-force-white bg-slate-800 hover:bg-slate-900"
                      disabled={workSaving}
                      onClick={() => void saveAssignmentWork("done")}
                      size="sm"
                      type="button"
                    >
                      Complete
                    </Button>
                  </div>

                  <div className="mt-4 grid gap-4 md:grid-cols-2">
                    <div>
                      <Label>Status</Label>
                      <Select onValueChange={(value) => setWorkStatus(value as "done" | "in_progress" | "pending")} value={workStatus}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="pending">Pending</SelectItem>
                          <SelectItem value="in_progress">In Progress</SelectItem>
                          <SelectItem value="done">Done</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Tracked Minutes</Label>
                      <Input
                        onChange={(event) => {
                          const value = event.target.value.replace(/[^\d]/g, "");
                          setWorkTrackedMinutes(value || "0");
                          setWorkTrackedSeconds(Number(value || "0") * 60);
                        }}
                        type="number"
                        value={String(Math.floor(liveWorkTrackedSeconds / 60))}
                      />
                    </div>
                    <div>
                      <Label>Actual Start</Label>
                      <Input onChange={(event) => setWorkActualStart(event.target.value)} type="datetime-local" value={workActualStart} />
                    </div>
                    <div>
                      <Label>Actual End</Label>
                      <Input onChange={(event) => setWorkActualEnd(event.target.value)} type="datetime-local" value={workActualEnd} />
                    </div>
                  </div>

                  <div className="mt-4">
                    <Label>Submission Note</Label>
                    <Textarea
                      onChange={(event) => setWorkNote(event.target.value)}
                      placeholder="Write what you completed, current progress, blockers, or next step."
                      rows={5}
                      value={workNote}
                    />
                  </div>

                  <div className="mt-4">
                    <Label>Attach Files</Label>
                    <input
                      className="hidden"
                      id={`assignment-work-files-${selectedTask.id}`}
                      multiple
                      onChange={(event) => setWorkFiles(Array.from(event.target.files ?? []))}
                      type="file"
                    />
                    <label
                      className="mt-2 flex cursor-pointer items-center justify-between rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3 text-sm text-[var(--foreground)]"
                      htmlFor={`assignment-work-files-${selectedTask.id}`}
                    >
                      <span className="inline-flex items-center gap-2 rounded-xl bg-[#4f5ef7] px-3 py-2 text-xs font-semibold text-white">
                        <Paperclip className="h-3.5 w-3.5" />
                        Choose Files
                      </span>
                      <span className="ml-3 truncate text-right text-[var(--muted-foreground)]">
                        {workFiles.length
                          ? workFiles.length === 1
                            ? workFiles[0]?.name
                            : `${workFiles.length} files selected`
                          : "Optional supporting files"}
                      </span>
                    </label>
                    {workFiles.length ? (
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-[var(--muted-foreground)]">
                        {workFiles.map((file) => (
                          <span
                            key={`${file.name}-${file.size}`}
                            className="rounded-full border border-[var(--panel-border)] bg-[var(--panel)] px-2.5 py-1"
                          >
                            {file.name}
                          </span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </div>
              ) : null}

              {selectedAssignment?.list === "assignedByMe" ? (
                <div className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-4">
                  <p className="text-xs uppercase tracking-[0.18em] text-[var(--muted-foreground)]">Quick Review</p>
                  {canDirectReview ? (
                    <>
                      <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                        Approve or ask for update directly from this assignment window.
                      </p>
                      <Textarea
                        className="mt-3"
                        onChange={(event) => setReviewNote(event.target.value)}
                        placeholder="Write what was good, or what still needs to be fixed."
                        rows={4}
                        value={reviewNote}
                      />
                    </>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--muted-foreground)]">
                      Assignee has not submitted this assignment for approval yet. Once they submit from their task report, approve or ask update from here.
                    </p>
                  )}
                </div>
              ) : null}

              <div className="flex flex-wrap justify-end gap-3">
                {selectedAssignment?.list === "assignedToMe" ? (
                  <Button disabled={workSaving} onClick={() => void saveAssignmentWork()} size="sm" type="button" variant="outline">
                    {workSaving ? "Saving..." : "Save Work"}
                  </Button>
                ) : null}
                {selectedAssignment?.list === "assignedToMe" ? (
                  <Button className="button-force-white" disabled={submittingWork || workSaving} onClick={() => void submitAssignmentWork()} size="sm" type="button">
                    <ClipboardCheck className="h-4 w-4" />
                    {submittingWork ? "Submitting..." : "Submit"}
                  </Button>
                ) : null}
                {selectedAssignment?.list === "assignedByMe" ? (
                  <Link href={`/dashboard/report?date=${toDateOnly(selectedTask.planDate)}&taskId=${selectedTask.id}`}>
                    <Button size="sm" type="button" variant="secondary">
                      <TimerReset className="h-4 w-4" />
                      View Exact Report
                    </Button>
                  </Link>
                ) : null}
                {selectedAssignment?.list === "assignedByMe" ? (
                  <Button
                    className="button-force-white bg-amber-500 hover:bg-amber-600"
                    disabled={!canDirectReview || reviewSaving}
                    onClick={() => runSelectedAssignmentReview("reject")}
                    size="sm"
                    type="button"
                  >
                    <CornerDownLeft className="h-4 w-4" />
                    {reviewSaving ? "Saving..." : "Ask Update"}
                  </Button>
                ) : null}
                {selectedAssignment?.list === "assignedByMe" ? (
                  <Button
                    className="button-force-white bg-emerald-500 hover:bg-emerald-600"
                    disabled={!canDirectReview || reviewSaving}
                    onClick={() => runSelectedAssignmentReview("approve")}
                    size="sm"
                    type="button"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    {reviewSaving ? "Saving..." : "Approve"}
                  </Button>
                ) : null}
                {assignmentStatus(selectedTask) === "done" ? (
                  <div className="inline-flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-300">
                    <CheckCircle2 className="h-4 w-4" />
                    Submission complete
                  </div>
                ) : null}
                <Button onClick={closeSelectedAssignment} size="sm" type="button" variant="outline">
                  Close
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
