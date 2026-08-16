"use client";

import { Clock3, LogIn, LogOut, TimerReset } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";
import { extractAttendanceOvertimeMeta } from "@/lib/attendance-overtime";
import { Button } from "@/components/ui/button";
import { clearStoredWorkdayTimer } from "@/components/dashboard/dashboard-workday-timer";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatMinutes, toDateOnly, toDateTimeInputValue } from "@/lib/utils";

type AttendanceItem = {
  userId: string;
  name: string;
  email: string;
  role: string;
  avatarUrl?: string | null;
  departmentName: string;
  attendance: {
    id: string;
    status: "present" | "late" | "half_day" | "absent" | "remote";
    checkInAt: Date | null;
    checkOutAt: Date | null;
    breakMinutes: number;
    workingMinutes: number;
    note: string | null;
  } | null;
};

type AttendanceStatusValue = "present" | "late" | "half_day" | "absent" | "remote";

function formatAttendanceDateTime(value: Date | string = new Date()) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}

function formatAttendanceDisplayParts(value?: Date | string | null) {
  if (!value) {
    return {
      date: "Not set",
      time: "--:--",
      meridiem: "",
    };
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return {
      date: "Not set",
      time: "--:--",
      meridiem: "",
    };
  }

  const dateLabel = new Intl.DateTimeFormat("en-BD", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);

  const timeParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Dhaka",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).formatToParts(date);

  const hour = timeParts.find((part) => part.type === "hour")?.value ?? "--";
  const minute = timeParts.find((part) => part.type === "minute")?.value ?? "--";
  const dayPeriod = timeParts.find((part) => part.type === "dayPeriod")?.value ?? "";

  return {
    date: dateLabel,
    time: `${hour}:${minute}`,
    meridiem: dayPeriod,
  };
}

function normalizeAttendanceDateTime(value: string) {
  const trimmed = value.trim();

  if (!trimmed) {
    return "";
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed}:00+06:00`;
  }

  if (/^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}$/.test(trimmed)) {
    return `${trimmed.replace(" ", "T")}:00+06:00`;
  }

  const match = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:,\s*|\s+)(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) {
    return null;
  }

  const [, monthText, dayText, yearText, hourText, minuteText, meridiem] = match;
  const month = Number(monthText);
  const day = Number(dayText);
  const year = Number(yearText);
  const minute = Number(minuteText);
  let hour = Number(hourText);

  if (
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(year) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 1 ||
    hour > 12 ||
    minute < 0 ||
    minute > 59
  ) {
    return null;
  }

  const upperMeridiem = meridiem.toUpperCase();
  if (upperMeridiem === "PM" && hour !== 12) {
    hour += 12;
  }
  if (upperMeridiem === "AM" && hour === 12) {
    hour = 0;
  }

  return `${yearText}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+06:00`;
}

export function AttendancePanel({
  userRole,
  currentUserId,
  items = [],
}: {
  userRole: "employee" | "hr" | "manager" | "admin";
  currentUserId: string;
  items: AttendanceItem[];
}) {
  const router = useRouter();
  const me = items.find((item) => item.userId === currentUserId);
  const attendanceMeta = extractAttendanceOvertimeMeta(me?.attendance?.note);
  const [status, setStatus] = useState<AttendanceStatusValue>(me?.attendance?.status ?? "present");
  const [checkInAt, setCheckInAt] = useState(me?.attendance?.checkInAt ? formatAttendanceDateTime(me.attendance.checkInAt) : "");
  const [checkOutAt, setCheckOutAt] = useState(me?.attendance?.checkOutAt ? formatAttendanceDateTime(me.attendance.checkOutAt) : "");
  const [breakMinutes, setBreakMinutes] = useState(String(me?.attendance?.breakMinutes ?? 0));
  const [note, setNote] = useState(attendanceMeta.text);
  const [saving, setSaving] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [overtimeMinutes, setOvertimeMinutes] = useState(attendanceMeta.overtimeMinutes);
  const [autoClosedAt, setAutoClosedAt] = useState(attendanceMeta.autoClosedAt);
  const alreadyCheckedIn = Boolean(me?.attendance?.checkInAt) && !me?.attendance?.checkOutAt;

  async function saveAttendance(next: {
    nextStatus?: AttendanceStatusValue;
    nextCheckIn?: string;
    nextCheckOut?: string;
  } = {}) {
    const normalizedCheckIn = normalizeAttendanceDateTime(next.nextCheckIn ?? checkInAt);
    const normalizedCheckOut = normalizeAttendanceDateTime(next.nextCheckOut ?? checkOutAt);

    if ((next.nextCheckIn ?? checkInAt) && normalizedCheckIn === null) {
      toast.error("Check In time format is invalid. Use MM/DD/YYYY HH:MM AM or choose Today.");
      return;
    }

    if ((next.nextCheckOut ?? checkOutAt) && normalizedCheckOut === null) {
      toast.error("Check Out time format is invalid. Use MM/DD/YYYY HH:MM AM or choose Today.");
      return;
    }

    setSaving(true);
    const response = await fetch("/api/dashboard/attendance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attendanceDate: toDateOnly(),
        status: next.nextStatus ?? status,
        note,
        checkInAt: normalizedCheckIn ?? "",
        checkOutAt: normalizedCheckOut ?? "",
        breakMinutes,
      }),
    });

    const raw = await response.text();
    const result = raw ? JSON.parse(raw) : { message: "Attendance update failed." };
    setSaving(false);

    if (!response.ok) {
      toast.error(result.message);
      return;
    }

    const savedRecord = result.record as
      | {
          status?: AttendanceStatusValue;
          note?: string | null;
          checkInAt?: string | null;
          checkOutAt?: string | null;
          breakMinutes?: number;
        }
      | undefined;
    const savedMeta = extractAttendanceOvertimeMeta(savedRecord?.note);

    setStatus(savedRecord?.status ?? next.nextStatus ?? status);
    setCheckInAt(savedRecord?.checkInAt ? formatAttendanceDateTime(savedRecord.checkInAt) : "");
    setCheckOutAt(savedRecord?.checkOutAt ? formatAttendanceDateTime(savedRecord.checkOutAt) : "");
    setBreakMinutes(String(savedRecord?.breakMinutes ?? breakMinutes));
    setNote(savedMeta.text);
    setOvertimeMinutes(savedMeta.overtimeMinutes);
    setAutoClosedAt(savedMeta.autoClosedAt);
    clearStoredWorkdayTimer(toDateOnly(), currentUserId);
    toast.success(result.message);
    router.refresh();
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle>Attendance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 xl:grid-cols-[1fr_auto]">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <Label>Status</Label>
                <Select value={status} onValueChange={(value) => setStatus(value as typeof status)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="present">Present</SelectItem>
                    <SelectItem value="late">Late</SelectItem>
                    <SelectItem value="half_day">Half Day</SelectItem>
                    <SelectItem value="absent">Absent</SelectItem>
                    <SelectItem value="remote">Remote</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Break Minutes</Label>
                <Input min="0" onChange={(event) => setBreakMinutes(event.target.value)} type="number" value={breakMinutes} />
              </div>
              <div>
                <Label>Check In</Label>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    onChange={(event) => setCheckInAt(event.target.value)}
                    placeholder="MM/DD/YYYY HH:MM AM"
                    type="text"
                    value={checkInAt}
                  />
                  <Button
                    className="button-force-white shrink-0 bg-[#4f5ef7] hover:bg-[#4453eb]"
                    onClick={() => setCheckInAt(formatAttendanceDateTime())}
                    type="button"
                  >
                    Today
                  </Button>
                </div>
              </div>
              <div>
                <Label>Check Out</Label>
                <div className="flex gap-2">
                  <Input
                    className="flex-1"
                    onChange={(event) => setCheckOutAt(event.target.value)}
                    placeholder="MM/DD/YYYY HH:MM AM"
                    type="text"
                    value={checkOutAt}
                  />
                  <Button
                    className="button-force-white shrink-0 bg-amber-500 hover:bg-amber-600"
                    onClick={() => setCheckOutAt(formatAttendanceDateTime())}
                    type="button"
                  >
                    Today
                  </Button>
                </div>
              </div>
            </div>
            <div className="flex flex-wrap gap-2 xl:flex-col">
              <Button
                className="button-force-white"
                disabled={saving || alreadyCheckedIn}
                onClick={() => saveAttendance({ nextStatus: "present", nextCheckIn: checkInAt.trim() || formatAttendanceDateTime() })}
                type="button"
              >
                <LogIn className="h-4 w-4" /> {alreadyCheckedIn ? "Checked In" : "Check In"}
              </Button>
              <Button
                className="button-force-white bg-slate-700 hover:bg-slate-800"
                disabled={saving}
                onClick={() => saveAttendance({ nextCheckOut: checkOutAt.trim() || formatAttendanceDateTime() })}
                type="button"
                variant="secondary"
              >
                <LogOut className="h-4 w-4" /> Check Out
              </Button>
              <Button
                className="button-force-white bg-slate-500 hover:bg-slate-600"
                disabled={saving}
                onClick={() => {
                  setCheckInAt("");
                  setCheckOutAt("");
                  setBreakMinutes("0");
                  setStatus("present");
                }}
                type="button"
                variant="ghost"
              >
                <TimerReset className="h-4 w-4" /> Reset Draft
              </Button>
            </div>
          </div>
          <div>
            <Label>Attendance Note</Label>
            <Textarea onChange={(event) => setNote(event.target.value)} placeholder="Optional attendance note for today." value={note} />
          </div>
          {overtimeMinutes > 0 || autoClosedAt ? (
            <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
              {overtimeMinutes > 0 ? <p>Overtime tracked: {overtimeMinutes} minute(s).</p> : null}
                        {autoClosedAt ? <p className="mt-1">Main attendance record auto-closed at 7:30 PM.</p> : null}
            </div>
          ) : null}
          <Button className="button-force-white w-full" disabled={saving} onClick={() => saveAttendance()} type="button">
            {saving ? "Saving attendance..." : "Save Attendance"}
          </Button>
        </CardContent>
      </Card>

      {userRole !== "employee" ? (
        <Card>
          <CardHeader>
            <CardTitle>Team Attendance Today</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 xl:grid-cols-2">
            {(items ?? []).map((item) => {
              const checkInDisplay = formatAttendanceDisplayParts(item.attendance?.checkInAt);
              const checkOutDisplay = formatAttendanceDisplayParts(item.attendance?.checkOutAt);
              const teamAttendanceMeta = extractAttendanceOvertimeMeta(item.attendance?.note);

              return (
              <div key={item.userId} className="rounded-[26px] border border-[var(--panel-border)] bg-[var(--panel-muted)] p-4 shadow-[0_14px_34px_rgba(15,23,42,0.06)]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xl font-semibold text-white">{item.name}</p>
                    <p className="text-sm text-[var(--muted-foreground)]">{item.departmentName}</p>
                  </div>
                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs font-medium uppercase tracking-[0.18em] text-amber-600">
                    {item.attendance?.status ?? "missing"}
                  </span>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">In</p>
                    <p className="mt-2 text-lg font-bold leading-none text-white">{checkInDisplay.time}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {checkInDisplay.meridiem ? (
                        <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-emerald-300">
                          {checkInDisplay.meridiem}
                        </span>
                      ) : null}
                      <span className="text-xs text-[var(--muted-foreground)]">{checkInDisplay.date}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">Out</p>
                    <p className="mt-2 text-lg font-bold leading-none text-white">{checkOutDisplay.time}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {checkOutDisplay.meridiem ? (
                        <span className="rounded-full bg-sky-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300">
                          {checkOutDisplay.meridiem}
                        </span>
                      ) : null}
                      <span className="text-xs text-[var(--muted-foreground)]">{checkOutDisplay.date}</span>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel)] px-4 py-3">
                    <p className="text-[11px] uppercase tracking-[0.22em] text-[var(--muted-foreground)]">Worked</p>
                    <p className="mt-2 text-lg font-bold leading-none text-white">{formatMinutes(item.attendance?.workingMinutes ?? 0)}</p>
                    <p className="mt-1 text-xs text-[var(--muted-foreground)]">worked today</p>
                  </div>
                </div>
                {teamAttendanceMeta.overtimeMinutes > 0 || teamAttendanceMeta.autoClosedAt ? (
                  <div className="mt-3 rounded-2xl border border-amber-200/60 bg-amber-50/80 px-4 py-3 text-sm text-amber-900">
                    {teamAttendanceMeta.overtimeMinutes > 0 ? <p>Overtime: {formatMinutes(teamAttendanceMeta.overtimeMinutes)}</p> : null}
                      {teamAttendanceMeta.autoClosedAt ? <p className="mt-1">Main record auto-closed at 7:30 PM.</p> : null}
                  </div>
                ) : null}
              </div>
            )})}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>Reminder Automation</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-[var(--muted-foreground)]">
          This reminder tool can send attendance and work follow-up emails automatically. Run it manually from here when needed, or connect it with your scheduler in the background.
          {userRole !== "employee" ? (
            <div>
              <Button
                className="button-force-white bg-[#4f5ef7] hover:bg-[#4453eb] disabled:bg-[#8fa2f7] disabled:opacity-100"
                disabled={triggering}
                onClick={async () => {
                  setTriggering(true);
                  const response = await fetch("/api/automation/reminders", { method: "POST" });
                  const raw = await response.text();
                  const result = raw ? JSON.parse(raw) : { message: "Reminder run failed." };
                  setTriggering(false);
                  if (!response.ok) {
                    toast.error(result.message);
                    return;
                  }
                  toast.success(result.message);
                }}
                type="button"
                variant="secondary"
              >
                <Clock3 className="h-4 w-4" /> {triggering ? "Sending reminders..." : "Run Reminder Emails"}
              </Button>
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
