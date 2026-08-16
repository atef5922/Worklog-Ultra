import { NextRequest } from "next/server";
import { UserRole } from "@prisma/client";
import { apiError, apiSuccess } from "@/lib/api";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { embedHistoryMeta, stripHistoryMeta } from "@/lib/task-history-shared";
import { buildContinuationDescription } from "@/lib/task-continuation";
import { buildFollowUpDescription } from "@/lib/task-follow-up";
import { addDays } from "date-fns";
import { parseDhakaDateTime, toDateOnly } from "@/lib/utils";

const TASK_ACTIONS = [
  "schedule_continuation",
  "clear_continuation",
  "restore_to_dashboard",
  "move_to_history",
  "complete_task",
] as const;

function buildTaskVisibilityWhere(actor: Awaited<ReturnType<typeof requireUser>>) {
  if (actor.role === UserRole.employee) {
    return { userId: actor.id };
  }

  if (actor.role === UserRole.manager) {
    return actor.departmentId
      ? {
          OR: [
            { userId: actor.id },
            { departmentId: actor.departmentId },
          ],
        }
      : { userId: actor.id };
  }

  return {};
}

async function clearAutoContinuationTask(task: {
  userId: string;
  planDate: Date;
  taskTitle: string;
}) {
  const nextPlanDate = addDays(new Date(task.planDate), 1);
  const existingCarryForward = await db.dailyTask.findFirst({
    where: {
      userId: task.userId,
      planDate: nextPlanDate,
      taskTitle: task.taskTitle,
    },
    select: { id: true, taskDescription: true },
  });

  if (!existingCarryForward?.taskDescription?.includes("[continued-task]")) {
    return;
  }

  await db.dailyTask.delete({
    where: { id: existingCarryForward.id },
  });
}

async function findVisibleTask(id: string, actor: Awaited<ReturnType<typeof requireUser>>) {
  return db.dailyTask.findFirst({
    where: {
      id,
      ...buildTaskVisibilityWhere(actor),
    },
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;
  const body = await request.json();

  const task = await findVisibleTask(id, user);

  if (!task) {
    return apiError("Task not found.", 404);
  }

  const taskTitle = typeof body.taskTitle === "string" ? body.taskTitle.trim() : "";
  const taskDescription = typeof body.taskDescription === "string" ? body.taskDescription.trim() : "";
  const priority =
    body.priority === "low" || body.priority === "normal" || body.priority === "high" || body.priority === "critical"
      ? body.priority
      : "normal";

  if (taskTitle.length < 3) {
    return apiError("Task title must be at least 3 characters.");
  }

  await db.dailyTask.update({
    where: { id },
    data: {
      taskTitle,
      taskDescription: taskDescription || null,
      priority,
    },
  });

  return apiSuccess({ message: "Task updated successfully." });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;
  const body = await request.json().catch(() => ({}));
  const action = typeof body?.action === "string" ? body.action : "";
  const actionReportDate =
    typeof body?.reportDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.reportDate)
      ? new Date(body.reportDate)
      : new Date(toDateOnly());

  if (!TASK_ACTIONS.includes(action as (typeof TASK_ACTIONS)[number])) {
    return apiError("Invalid task action.", 400);
  }

  const task = await db.dailyTask.findFirst({
    where: {
      id,
      ...buildTaskVisibilityWhere(user),
    },
    select: {
      id: true,
      userId: true,
      departmentId: true,
      planDate: true,
      taskTitle: true,
      taskDescription: true,
      priority: true,
      assignedBy: true,
      updates: {
        orderBy: { reportDate: "desc" },
        take: 1,
        select: {
          status: true,
          note: true,
          trackedMinutes: true,
          completionPercent: true,
          actualStart: true,
          actualEnd: true,
          difficultyLevel: true,
        },
      },
    },
  });

  if (!task) {
    return apiError("Task not found.", 404);
  }

  const latestUpdate = task.updates[0];
  if (
    !["restore_to_dashboard", "move_to_history", "complete_task"].includes(action) &&
    (latestUpdate?.status === "done" || latestUpdate?.completionPercent === 100)
  ) {
    return apiError("This task is already completed.", 400);
  }

  const today = toDateOnly();
  const isTodaysTask = toDateOnly(task.planDate) === today;

  if (action === "complete_task") {
    const completionStatus = body.completionStatus === "partial" ? "partial" : "done";
    const completionNote = typeof body.completionNote === "string" ? body.completionNote.trim() : "";
    const needFollowUp = Boolean(body.needFollowUp);
    const followUpDate = typeof body.followUpDate === "string" ? body.followUpDate.trim() : "";
    const followUpTime = typeof body.followUpTime === "string" ? body.followUpTime.trim() : "";
    const followUpNote = typeof body.followUpNote === "string" ? body.followUpNote.trim() : "";
    const trackedMinutes = Math.max(
      0,
      Number(body.trackedMinutes ?? latestUpdate?.trackedMinutes ?? 0),
    );
    const actualStart = body.actualStart
      ? parseDhakaDateTime(String(body.actualStart))
      : latestUpdate?.actualStart ?? null;
    const actualEnd = body.actualEnd
      ? parseDhakaDateTime(String(body.actualEnd))
      : latestUpdate?.actualEnd ?? new Date();
    const wantsFollowUp = needFollowUp || completionStatus === "partial";

    if (wantsFollowUp && (!followUpDate || !followUpTime)) {
      return apiError("Follow-up date and time are required.");
    }

    const completionPercent = completionStatus === "partial" ? 50 : 100;
    const reportDate = actionReportDate;

    await db.dailyTaskUpdate.upsert({
      where: {
        dailyTaskId_reportDate: {
          dailyTaskId: task.id,
          reportDate,
        },
      },
      update: {
        status: "done",
        note: completionNote || null,
        completionPercent,
        trackedMinutes,
        actualStart,
        actualEnd,
      },
      create: {
        dailyTaskId: task.id,
        reportDate,
        status: "done",
        note: completionNote || null,
        completionPercent,
        trackedMinutes,
        actualStart,
        actualEnd,
        difficultyLevel: null,
      },
    });

    await clearAutoContinuationTask(task);

    let followUpTaskId: string | null = null;

    if (wantsFollowUp) {
      const continuationDescription = buildContinuationDescription({
        originalDescription: stripHistoryMeta(task.taskDescription),
        sourceDate: toDateOnly(reportDate),
        completionPercent,
        trackedMinutes,
        note: completionNote,
      });

      const followUpDescription = buildFollowUpDescription({
        originalDescription: continuationDescription,
        sourceTaskId: task.id,
        scheduledDate: followUpDate,
        scheduledTime: followUpTime,
        reminderNote: followUpNote || completionNote,
        completionStatus,
      });

      const existingFollowUp = await db.dailyTask.findFirst({
        where: {
          userId: task.userId,
          planDate: new Date(followUpDate),
          taskTitle: task.taskTitle,
        },
        select: { id: true },
      });

      if (existingFollowUp) {
        await db.dailyTask.update({
          where: { id: existingFollowUp.id },
          data: {
            taskDescription: followUpDescription,
            priority: task.priority,
            assignedBy: task.assignedBy,
          },
        });
        followUpTaskId = existingFollowUp.id;
      } else {
        const created = await db.dailyTask.create({
          data: {
            userId: task.userId,
            departmentId: task.departmentId,
            planDate: new Date(followUpDate),
            taskTitle: task.taskTitle,
            taskDescription: followUpDescription,
            priority: task.priority,
            assignedBy: task.assignedBy,
          },
          select: { id: true },
        });
        followUpTaskId = created.id;
      }
    }

    return apiSuccess({
      message: wantsFollowUp
        ? "Task completed and follow-up reminder scheduled."
        : "Task completed successfully.",
      followUpCreated: wantsFollowUp,
      followUpTaskId,
      followUpDate: wantsFollowUp ? followUpDate : null,
      followUpTime: wantsFollowUp ? followUpTime : null,
      trackedMinutes,
      completionStatus,
    });
  }

  if (action === "move_to_history") {
    const reportDate = actionReportDate;
    const resolvedActualEnd = latestUpdate?.actualEnd ?? new Date();
    await db.dailyTaskUpdate.upsert({
      where: {
        dailyTaskId_reportDate: {
          dailyTaskId: task.id,
          reportDate,
        },
      },
      update: {
        status: "done",
        note: latestUpdate?.note ?? null,
        completionPercent: latestUpdate?.completionPercent && latestUpdate.completionPercent > 0 ? latestUpdate.completionPercent : 100,
        trackedMinutes: latestUpdate?.trackedMinutes ?? 0,
        actualStart: latestUpdate?.actualStart ?? null,
        actualEnd: resolvedActualEnd,
      },
      create: {
        dailyTaskId: task.id,
        reportDate,
        status: "done",
        note: latestUpdate?.note ?? null,
        completionPercent: latestUpdate?.completionPercent && latestUpdate.completionPercent > 0 ? latestUpdate.completionPercent : 100,
        trackedMinutes: latestUpdate?.trackedMinutes ?? 0,
        actualStart: latestUpdate?.actualStart ?? null,
        actualEnd: resolvedActualEnd,
        difficultyLevel: latestUpdate?.difficultyLevel ?? null,
      },
    });

    await db.dailyTask.update({
      where: { id: task.id },
      data: {
        taskDescription: embedHistoryMeta(task.taskDescription),
      },
    });

    return apiSuccess({ message: "Task moved to history successfully." });
  }

  if (action === "restore_to_dashboard") {
    if (isTodaysTask) {
      const resumedStatus =
        latestUpdate && (latestUpdate.trackedMinutes > 0 || latestUpdate.actualStart) ? "in_progress" : "pending";

      await db.dailyTask.update({
        where: { id: task.id },
        data: {
          taskDescription: stripHistoryMeta(task.taskDescription) || null,
        },
      });

      if (latestUpdate) {
        await db.dailyTaskUpdate.update({
          where: {
            dailyTaskId_reportDate: {
              dailyTaskId: task.id,
              reportDate: new Date(today),
            },
          },
          data: {
            status: resumedStatus,
            actualEnd: null,
          },
        });
      }

      return apiSuccess({
        message: "Task returned to today's dashboard.",
        taskId: task.id,
        reportDate: today,
      });
    }

    const continuationNote = buildContinuationDescription({
      originalDescription: stripHistoryMeta(task.taskDescription),
      sourceDate: toDateOnly(task.planDate),
      completionPercent: latestUpdate?.completionPercent ?? 0,
      trackedMinutes: latestUpdate?.trackedMinutes ?? 0,
      note: latestUpdate?.note ?? "",
    });

    const existingTodayTask = await db.dailyTask.findFirst({
      where: {
        userId: task.userId,
        planDate: new Date(today),
        taskTitle: task.taskTitle,
      },
      select: {
        id: true,
        updates: {
          orderBy: { reportDate: "desc" },
          take: 1,
          select: {
            trackedMinutes: true,
            actualStart: true,
            status: true,
          },
        },
      },
    });

    let targetTaskId = existingTodayTask?.id;

    if (existingTodayTask) {
      await db.dailyTask.update({
        where: { id: existingTodayTask.id },
        data: {
          taskDescription: continuationNote || null,
          priority: task.priority,
          assignedBy: task.assignedBy,
        },
      });

      const todayUpdate = existingTodayTask.updates[0];
      if (todayUpdate?.status === "done") {
        await db.dailyTaskUpdate.update({
          where: {
            dailyTaskId_reportDate: {
              dailyTaskId: existingTodayTask.id,
              reportDate: new Date(today),
            },
          },
          data: {
            status: todayUpdate.trackedMinutes > 0 || todayUpdate.actualStart ? "in_progress" : "pending",
            actualEnd: null,
          },
        });
      }
    } else {
      const created = await db.dailyTask.create({
        data: {
          userId: task.userId,
          departmentId: task.departmentId,
          planDate: new Date(today),
          taskTitle: task.taskTitle,
          taskDescription: continuationNote || null,
          priority: task.priority,
          assignedBy: task.assignedBy,
        },
        select: { id: true },
      });

      targetTaskId = created.id;
    }

    return apiSuccess({
      message: "Task moved back to today's dashboard.",
      taskId: targetTaskId,
      reportDate: today,
    });
  }

  const nextPlanDate = addDays(new Date(task.planDate), 1);
  const sourceDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date(task.planDate));

  const continuationNote = buildContinuationDescription({
    originalDescription: task.taskDescription,
    sourceDate,
    completionPercent: latestUpdate?.completionPercent ?? 0,
    trackedMinutes: latestUpdate?.trackedMinutes ?? 0,
    note: latestUpdate?.note ?? "",
  });

  const existingCarryForward = await db.dailyTask.findFirst({
    where: {
      userId: task.userId,
      planDate: nextPlanDate,
      taskTitle: task.taskTitle,
    },
    select: { id: true },
  });

  if (action === "clear_continuation") {
    if (existingCarryForward) {
      await db.dailyTask.delete({
        where: { id: existingCarryForward.id },
      });
    }

    return apiSuccess({ message: "Continuation cleared." });
  }

  if (existingCarryForward) {
    await db.dailyTask.update({
      where: { id: existingCarryForward.id },
      data: {
        taskDescription: continuationNote || null,
        priority: task.priority,
        assignedBy: task.assignedBy,
      },
    });

    return apiSuccess({ message: "Tomorrow's continuation task is already ready." });
  }

  await db.dailyTask.create({
    data: {
      userId: task.userId,
      departmentId: task.departmentId,
      planDate: nextPlanDate,
      taskTitle: task.taskTitle,
      taskDescription: continuationNote || null,
      priority: task.priority,
      assignedBy: task.assignedBy,
    },
  });

  return apiSuccess({ message: "Task scheduled for tomorrow successfully." });
}

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await requireUser();
  const { id } = await params;

  const task = await findVisibleTask(id, user);

  if (!task) {
    return apiError("Task not found.", 404);
  }

  await db.$transaction([
    db.dailyTaskUpdate.deleteMany({ where: { dailyTaskId: id } }),
    db.reportEditRequest.deleteMany({ where: { dailyTaskId: id } }),
    db.dailyTask.delete({ where: { id } }),
  ]);

  return apiSuccess({ message: "Task deleted successfully." });
}
