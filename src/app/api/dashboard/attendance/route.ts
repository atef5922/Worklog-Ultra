import { NextRequest } from "next/server";
import { UserRole } from "@prisma/client";
import { apiError, apiSuccess } from "@/lib/api";
import { embedAttendanceOvertimeMeta } from "@/lib/attendance-overtime";
import { requireUser } from "@/lib/auth/server";
import { db } from "@/lib/db";
import { attendanceUpdateSchema } from "@/lib/validators/worklog";
import { calculateMinutesBetween, getDhakaCutoffIso, toDateOnly } from "@/lib/utils";

export async function POST(request: NextRequest) {
  const user = await requireUser();
  const attendanceModel = (db as unknown as {
    attendanceRecord?: {
      findUnique?: (args: Record<string, unknown>) => Promise<{
        id: string;
        userId: string;
        attendanceDate: Date;
        status: "present" | "late" | "half_day" | "absent" | "remote";
        note: string | null;
        checkInAt: Date | null;
        checkOutAt: Date | null;
        breakMinutes: number;
        workingMinutes: number;
      } | null>;
      upsert: (args: Record<string, unknown>) => Promise<unknown>;
    };
  }).attendanceRecord;
  const body = await request.json();
  const parsed = attendanceUpdateSchema.safeParse(body);

  if (!parsed.success) {
    return apiError(parsed.error.issues[0]?.message ?? "Invalid attendance payload.");
  }

  if (!attendanceModel) {
    return apiError("Attendance module is not ready yet. Restart the server once to load the latest attendance client.");
  }

  const targetDate = toDateOnly(parsed.data.attendanceDate);
  if (user.role === UserRole.employee && targetDate !== toDateOnly()) {
    return apiError("Employees can only update today's attendance.");
  }

  const checkInAt = parsed.data.checkInAt ? new Date(parsed.data.checkInAt) : null;
  const checkOutAt = parsed.data.checkOutAt ? new Date(parsed.data.checkOutAt) : null;
  const existingRecord = attendanceModel.findUnique
    ? await attendanceModel.findUnique({
        where: {
          userId_attendanceDate: {
            userId: user.id,
            attendanceDate: new Date(targetDate),
          },
        },
      })
    : null;

  const finalCheckInAt = checkInAt ?? existingRecord?.checkInAt ?? null;
  const finalActualCheckOutAt = checkOutAt ?? existingRecord?.checkOutAt ?? null;

  if (finalCheckInAt && finalActualCheckOutAt && finalActualCheckOutAt.getTime() < finalCheckInAt.getTime()) {
    return apiError("Check Out time cannot be earlier than Check In time.");
  }

  const cutoffAt = new Date(getDhakaCutoffIso(targetDate, 19, 30));
  const now = new Date();
  const autoClosedAt =
    finalCheckInAt && !finalActualCheckOutAt && toDateOnly(now) === targetDate && now.getTime() >= cutoffAt.getTime()
      ? cutoffAt
      : null;
  const actualCheckOutForOvertime = finalActualCheckOutAt ?? autoClosedAt;
  const effectiveCheckOutAt =
    actualCheckOutForOvertime && actualCheckOutForOvertime.getTime() > cutoffAt.getTime()
      ? cutoffAt
      : actualCheckOutForOvertime;
  const workingMinutes = Math.max(0, calculateMinutesBetween(finalCheckInAt, effectiveCheckOutAt) - parsed.data.breakMinutes);
  const overtimeMinutes =
    finalCheckInAt && finalActualCheckOutAt && finalActualCheckOutAt.getTime() > cutoffAt.getTime()
      ? Math.max(
          0,
          calculateMinutesBetween(
            finalCheckInAt.getTime() > cutoffAt.getTime() ? finalCheckInAt : cutoffAt,
            finalActualCheckOutAt,
          ),
        )
      : 0;
  const finalNote = embedAttendanceOvertimeMeta(parsed.data.note || "", {
    overtimeMinutes,
    actualCheckOutAt:
      finalActualCheckOutAt && finalActualCheckOutAt.getTime() > cutoffAt.getTime()
        ? finalActualCheckOutAt.toISOString()
        : null,
    autoClosedAt: autoClosedAt?.toISOString() ?? null,
  });

  const record = await attendanceModel.upsert({
    where: {
      userId_attendanceDate: {
        userId: user.id,
        attendanceDate: new Date(targetDate),
      },
    },
    update: {
      status: parsed.data.status,
      note: finalNote || null,
      checkInAt: finalCheckInAt,
      checkOutAt: effectiveCheckOutAt,
      breakMinutes: parsed.data.breakMinutes,
      workingMinutes,
    },
    create: {
      userId: user.id,
      attendanceDate: new Date(targetDate),
      status: parsed.data.status,
      note: finalNote || null,
      checkInAt: finalCheckInAt,
      checkOutAt: effectiveCheckOutAt,
      breakMinutes: parsed.data.breakMinutes,
      workingMinutes,
    },
  });

  return apiSuccess({
    message: "Attendance updated successfully.",
    record,
  });
}
