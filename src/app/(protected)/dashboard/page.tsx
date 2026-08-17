import Image from "next/image";
import Link from "next/link";
import { BellRing, CalendarCheck2, Check, CheckCircle2, CircleAlert, ClipboardList, Clock3, PlayCircle, TimerReset } from "lucide-react";
import { PanelHeader } from "@/components/dashboard/panel-header";
import { DashboardProgressCard } from "@/components/dashboard/dashboard-progress-card";
import { DashboardRecurringQuickAdd } from "@/components/dashboard/dashboard-recurring-quick-add";
import { DashboardTaskNotifier } from "@/components/dashboard/dashboard-task-notifier";
import { DashboardTimeSummary } from "@/components/dashboard/dashboard-time-summary";
import { DashboardWorkdayTimer } from "@/components/dashboard/dashboard-workday-timer";
import { DashboardWorkPlanSection } from "@/components/dashboard/dashboard-work-plan-section";
import { DashboardWorkspaceModal } from "@/components/dashboard/dashboard-workspace-modal";
import { requireUser } from "@/lib/auth/server";
import { extractAssignmentReviewReason } from "@/lib/assignment-review";
import { countDashboardTaskStats, filterTodaysWorkPlanTasks } from "@/lib/dashboard-work-plan-filter";
import { canUserEditReportDate, getAssignableUsers, getCurrentUserAttendanceSnapshot, getDashboardData, getDepartments, getPlanSuggestions, getPlanWithReports } from "@/lib/worklog";
import { formatDateTimeInDhaka, isTenderDepartmentName, toDateOnly } from "@/lib/utils";

export const dynamic = "force-dynamic";

const statCardStyles = [
  {
    icon: ClipboardList,
    iconWrap: "bg-[#eef2ff] text-[#3148d8]",
    card: "bg-white",
    border: "border-[#d8e2ff]",
    shadow: "shadow-[0_22px_42px_rgba(79,94,247,0.14)]",
    accent: "bg-[#4f5ef7]",
    label: "Planned flow",
    art: "/vectors/Planned%20Tasks.png",
  },
  {
    icon: CheckCircle2,
    iconWrap: "bg-[#e8fbf4] text-[#0f8f68]",
    card: "bg-white",
    border: "border-[#d5f7e9]",
    shadow: "shadow-[0_22px_42px_rgba(16,185,129,0.14)]",
    accent: "bg-[#17b26a]",
    label: "Completed",
    art: "/vectors/Completed%20Tasks.png",
  },
  {
    icon: PlayCircle,
    iconWrap: "bg-[#fff5e6] text-[#dc7f07]",
    card: "bg-white",
    border: "border-[#ffe0ab]",
    shadow: "shadow-[0_22px_42px_rgba(245,158,11,0.14)]",
    accent: "bg-[#f59e0b]",
    label: "Running now",
    art: "/vectors/In%20Progress%20Tasks.png",
  },
  {
    icon: TimerReset,
    iconWrap: "bg-[#fff0f4] text-[#d91c4a]",
    card: "bg-white",
    border: "border-[#ffd0da]",
    shadow: "shadow-[0_22px_42px_rgba(244,63,94,0.14)]",
    accent: "bg-[#f43f5e]",
    label: "Need action",
    art: "/vectors/Pending%20Tasks.png",
  },
  {
    icon: Clock3,
    iconWrap: "bg-[#f3eeff] text-[#7041e6]",
    card: "bg-white",
    border: "border-[#e1d6ff]",
    shadow: "shadow-[0_22px_42px_rgba(139,92,246,0.14)]",
    accent: "bg-[#8b5cf6]",
    label: "Work time",
    art: "/vectors/Actual%20Work%20Time.png",
  },
];

const notices = [
  "Save today's tasks before the first work block starts.",
  "Complete your report before day close.",
  "Keep high-priority tasks updated so progress stays visible.",
];

function priorityRank(priority: string) {
  if (priority === "critical") return 0;
  if (priority === "high") return 1;
  if (priority === "normal") return 2;
  return 3;
}

function formatHoursAndMinutes(hoursLabel: string) {
  const numericHours = Number(hoursLabel.replace("h", ""));

  if (!Number.isFinite(numericHours) || numericHours <= 0) {
    return "0h 00m";
  }

  const hours = Math.floor(numericHours);
  const minutes = Math.round((numericHours - hours) * 60);
  return `${hours}h ${String(minutes).padStart(2, "0")}m`;
}

function formatDashboardDate(value: Date) {
  return new Intl.DateTimeFormat("en-BD", {
    timeZone: "Asia/Dhaka",
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(value);
}

function formatTimeOnly(value?: Date | null) {
  if (!value) return "--:-- --";
  return formatDateTimeInDhaka(value).split(", ").pop() ?? "--:-- --";
}


function getMotivationalMessage(input: {
  name: string;
  role: "employee" | "hr" | "manager" | "admin";
  plannedTasks: number;
  completedTasks: number;
  pendingTasks: number;
  trackedMinutes: number;
}) {
  function buildHash(value: string) {
    return value.split("").reduce((sum, char, index) => sum + char.charCodeAt(0) * (index + 17), 0);
  }

  const dayKey = toDateOnly();
  const seed = `${input.name}-${input.role}-${dayKey}-${input.plannedTasks}-${input.completedTasks}-${input.pendingTasks}-${input.trackedMinutes}`;

  if (input.role === "manager" || input.role === "admin") {
    return {
      message: `Hello ${input.name}, hope your day goes well today.`,
    };
  }

  if (input.role === "hr") {
    const hrPool = [
      `Hello ${input.name}, hope your day goes smoothly today.`,
      `Hello ${input.name}, wishing you a calm and productive day.`,
      `Hello ${input.name}, hope today moves well for you.`,
      `Hello ${input.name}, wishing you a good day ahead.`,
    ];

    return {
      message: hrPool[buildHash(seed) % hrPool.length],
    };
  }

  const employeePool = [
    `Hello ${input.name}, your next good step can make today count.`,
    `Hello ${input.name}, stay steady today and your work will speak for you.`,
    `Hello ${input.name}, one focused effort today can change the whole day.`,
    `Hello ${input.name}, keep moving today, your progress is building.`,
    `Hello ${input.name}, today is a good day to finish something meaningful.`,
    `Hello ${input.name}, your consistency today can put you ahead.`,
    `Hello ${input.name}, keep your pace today and good results will follow.`,
    `Hello ${input.name}, one smart move today can set the tone for everything else.`,
    `Hello ${input.name}, keep your head clear today and the work will flow better.`,
    `Hello ${input.name}, your effort today can become tomorrow's advantage.`,
    `Hello ${input.name}, small wins today can build a very strong day.`,
    `Hello ${input.name}, stay locked in today, you are capable of more than enough.`,
  ];

  return {
    message: employeePool[buildHash(seed) % employeePool.length],
  };
}

export default async function DashboardPage() {
  const user = await requireUser();
  const reportDate = toDateOnly();

  const [data, attendance, departments, reportTasks, suggestions, assignableUsers] = await Promise.all([
    getDashboardData(user.id, user.role, user.departmentId),
    getCurrentUserAttendanceSnapshot(user.id),
    getDepartments(),
    getPlanWithReports(user.id),
    getPlanSuggestions(user.id, user.departmentId),
    getAssignableUsers(),
  ]);

  const editAccess = await canUserEditReportDate(
    { id: user.id, role: user.role },
    new Date(reportDate),
    (reportTasks ?? []).map((task) => task.id),
  );

  const today = new Date();
  const activeTasks = filterTodaysWorkPlanTasks(data.tasks).sort(
    (left, right) => priorityRank(left.priority) - priorityRank(right.priority) || left.taskTitle.localeCompare(right.taskTitle),
  );
  const dashboardStats = countDashboardTaskStats(data.tasks);
  const completedTasks = dashboardStats.completedTasks;
  const inProgressTasks = dashboardStats.inProgressTasks;
  const pendingTasks = dashboardStats.pendingTasks;
  const plannedTasks = dashboardStats.plannedTasks;
  const workedMinutes = activeTasks.reduce((sum, task) => sum + (task.updates[0]?.trackedMinutes ?? 0), 0);
  const urgentTasks = activeTasks.filter((task) => ["high", "critical"].includes(task.priority)).slice(0, 3);
  const attendanceStatusLabel =
    attendance?.checkInAt && !attendance?.checkOutAt
      ? "You are checked in"
      : attendance?.checkInAt && attendance?.checkOutAt
        ? "Attendance completed"
        : "No attendance logged yet";
  const motivation = getMotivationalMessage({
    name: user.name,
    role: user.role,
    plannedTasks,
    completedTasks,
    pendingTasks,
    trackedMinutes: workedMinutes,
  });
  const isTenderDepartment = isTenderDepartmentName(user.department?.name);

  const statCards = [
    {
      title: "Planned Tasks",
      value: plannedTasks,
      linkLabel: "View all",
      href: "/dashboard/plan",
    },
    {
      title: "Completed Tasks",
      value: completedTasks,
      linkLabel: "View all",
      href: "/dashboard/report",
    },
    {
      title: "In Progress Tasks",
      value: inProgressTasks,
      linkLabel: "View all",
      href: "/dashboard/report",
    },
    {
      title: "Pending Tasks",
      value: pendingTasks,
      linkLabel: "View all",
      href: "/dashboard/report",
    },
    {
      title: "Actual Work Time",
      value: formatHoursAndMinutes(data.kpis.worklogHours),
      linkLabel: "View details",
      href: "/dashboard/history",
    },
  ];

  return (
    <div
      className="flex flex-col gap-2 min-[900px]:min-h-0 min-[900px]:flex-1 min-[900px]:overflow-hidden"
      data-fit-viewport
    >
      <DashboardTaskNotifier
        tasks={(data.tasks ?? []).map((task) => ({
          id: task.id,
          title: task.taskTitle,
          status: task.updates[0]?.status ?? "pending",
          trackedMinutes: task.updates[0]?.trackedMinutes ?? 0,
          actualEnd: task.updates[0]?.actualEnd?.toISOString() ?? null,
          taskDescription: task.taskDescription,
        }))}
      />
      <section className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4" data-page-section>
        <div className="flex min-w-0 items-center gap-2.5 sm:flex-1">
          {/* Colour emoji rather than a line icon: it reads instantly at this
              size and carries the greeting's tone on its own. */}
          <span aria-hidden className="dashboard-greeting-wave shrink-0 text-[1.15rem] leading-none">
            👋
          </span>
          <h1
            className="min-w-0 text-[0.95rem] font-semibold leading-tight text-[var(--foreground)] max-sm:line-clamp-2 sm:truncate sm:text-[1.02rem]"
            title={motivation.message}
          >
            {motivation.message}
          </h1>
        </div>
        <div className="flex w-full shrink-0 flex-nowrap items-center gap-2 sm:w-auto sm:justify-end sm:gap-3">
          <DashboardWorkspaceModal
            canEditReport={editAccess.allowed}
            currentUserId={user.id}
            departments={departments}
            initialTasks={[]}
            isTenderDepartment={isTenderDepartment}
            assignableUsers={assignableUsers}
            reportDate={reportDate}
            reportTasks={(reportTasks ?? []).map((task) => ({
              id: task.id,
              taskTitle: task.taskTitle,
              updates: (task.updates ?? []).map((update) => ({
                status: update.status,
                note: update.note,
                completionPercent: update.completionPercent,
                trackedMinutes: update.trackedMinutes,
                actualStart: update.actualStart,
                actualEnd: update.actualEnd,
                difficultyLevel: update.difficultyLevel,
              })),
            }))}
            role={user.role}
            suggestions={suggestions ?? []}
            userDepartmentId={user.departmentId}
          />
          <div className="shrink-0">
            <DashboardWorkdayTimer
              currentUserId={user.id}
              initialAttendance={
                attendance
                  ? {
                      status: attendance.status,
                      note: attendance.note ?? "",
                      breakMinutes: attendance.breakMinutes ?? 0,
                      checkInAt: attendance.checkInAt?.toISOString() ?? null,
                      checkOutAt: attendance.checkOutAt?.toISOString() ?? null,
                    }
                  : null
              }
              mode="button"
            />
          </div>
        </div>
      </section>

      <section className="grid shrink-0 grid-cols-5 gap-1.5 sm:gap-2 xl:gap-2.5" data-page-section>
        {statCards.map((item, index) => {
          const style = statCardStyles[index % statCardStyles.length];
          const Icon = style.icon;
          const compactTitle = item.title
            .replace(" Tasks", "")
            .replace("Actual Work Time", "Work Time");
          const compactLinkLabel = item.linkLabel === "View details" ? "Details" : "View";

          return (
            <Link
              className={`group relative flex min-w-0 items-center gap-2 overflow-hidden rounded-[0.875rem] border p-2 transition hover:-translate-y-0.5 sm:rounded-[1rem] sm:p-2.5 ${style.card} ${style.border} ${style.shadow}`}
              data-dashboard-card
              href={item.href}
              key={item.title}
              title={`${item.title} · ${item.linkLabel}`}
            >
              <div className={`absolute inset-x-0 top-0 h-1 ${style.accent}`} />
              <div className="pointer-events-none absolute -right-1 bottom-0 top-1 w-[26%] opacity-90">
                <Image
                  alt=""
                  aria-hidden
                  className="object-contain object-right-bottom"
                  data-dashboard-float="soft"
                  fill
                  sizes="120px"
                  src={style.art}
                />
              </div>
              <div className={`relative flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.625rem] shadow-sm ${style.iconWrap}`}>
                <Icon className="h-4 w-4" />
              </div>
              <div className="relative min-w-0 flex-1 pr-[22%]">
                <p className="truncate text-[1.25rem] font-bold leading-none tabular-nums text-slate-900">{item.value}</p>
                <p className="mt-0.5 truncate text-[0.68rem] font-semibold leading-tight text-slate-600">
                  <span className="sm:hidden">{compactTitle}</span>
                  <span className="hidden sm:inline">{item.title}</span>
                </p>
                <p className="mt-0.5 truncate text-[0.6rem] font-bold uppercase tracking-[0.1em] text-slate-500 transition group-hover:text-[#4f5ef7]">
                  <span className="sm:hidden">{compactLinkLabel}</span>
                  <span className="hidden sm:inline">{item.linkLabel}</span>
                </p>
              </div>
            </Link>
          );
        })}
      </section>

      <section
        className="grid min-h-0 gap-2 min-[900px]:flex-1 min-[900px]:grid-cols-[minmax(0,1fr)_15.5rem] lg:grid-cols-[minmax(0,1fr)_18.125rem]"
        data-page-section
      >
        {/* Left column: the work plan owns the leftover height and scrolls
            inside itself, so the page never grows past one screen. */}
        <div className="flex min-h-0 min-w-0 flex-col gap-2">
          <DashboardWorkPlanSection
            canEdit={editAccess.allowed}
            currentUserId={user.id}
            formattedDate={formatDashboardDate(today)}
            tasks={(data.tasks ?? []).map((task) => ({
              id: task.id,
              taskTitle: task.taskTitle,
              taskDescription: task.taskDescription,
              priority: task.priority,
              planDate: toDateOnly(task.planDate),
              assignedBy: task.assignedBy,
              userId: task.userId,
              departmentName: task.user.department?.name ?? "General",
              updates: (task.updates ?? []).map((update) => ({
                status: update.status,
                note: update.note,
                trackedMinutes: update.trackedMinutes,
                actualStart: update.actualStart?.toISOString() ?? null,
                actualEnd: update.actualEnd?.toISOString() ?? null,
                reportDate: toDateOnly(update.reportDate),
              })),
              latestReview: task.editRequests[0]
                ? {
                    id: task.editRequests[0].id,
                    status: task.editRequests[0].status as "pending" | "approved" | "rejected",
                    submitNote: extractAssignmentReviewReason(task.editRequests[0].reason) ?? "",
                    reviewNote: task.editRequests[0].reviewNote ?? null,
                    createdAt: task.editRequests[0].createdAt.toISOString(),
                    reviewedAt: task.editRequests[0].reviewedAt?.toISOString() ?? null,
                    requestedById: task.editRequests[0].requestedById,
                    reviewerId: task.editRequests[0].reviewerId ?? null,
                  }
                : null,
            }))}
          />

          {/* Support strip: fixed height, each panel scrolls inside itself so
              the row never pushes the page past one screen. */}
          {/* Takes whatever the fixed-height work plan leaves, so these three
              breathe instead of scrolling inside a cramped strip. */}
          <div className="grid min-h-0 min-w-0 gap-2 min-[900px]:flex-1 min-[900px]:grid-cols-3">
            <DashboardRecurringQuickAdd
              allowOtherDepartment={user.role === "admin"}
              currentUserDepartmentId={user.departmentId || departments[0]?.id || ""}
              isTenderDepartment={isTenderDepartment}
              currentUserId={user.id}
              departments={departments ?? []}
              existingTaskTitles={(activeTasks ?? []).map((task) => task.taskTitle)}
            />

            <div
              className="dashboard-accent accent-rose flex h-full min-h-0 min-w-0 flex-col rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-2.5 shadow-[var(--shadow)]"
              data-dashboard-panel
            >
              <PanelHeader icon={CircleAlert} title="High Priority" tone="bg-rose-500/10 text-rose-500" />
              <div className="mt-2 flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto pr-0.5">
                {urgentTasks.length ? (
                  urgentTasks.map((task) => (
                    <div
                      className="flex items-center gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-muted)] px-2 py-1 transition hover:border-rose-500/40 hover:bg-rose-500/5"
                      key={task.id}
                      title={`${task.taskTitle} · ${task.user.department?.name ?? "General"}`}
                    >
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                      <p className="min-w-0 flex-1 truncate text-[0.76rem] font-semibold text-[var(--foreground)]">{task.taskTitle}</p>
                      <span className="shrink-0 rounded-full bg-rose-500/10 px-1.5 py-px text-[0.55rem] font-bold uppercase tracking-[0.1em] text-rose-500">
                        High
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-1 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--panel-border)] bg-[var(--panel-muted)] px-3 py-4 text-center">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-500">
                      <CheckCircle2 className="h-4 w-4" />
                    </span>
                    <p className="text-[0.8rem] font-medium text-[var(--muted-foreground)]">No high-priority tasks right now.</p>
                  </div>
                )}
              </div>
            </div>

            <div
              className="dashboard-accent accent-amber flex h-full min-h-0 min-w-0 flex-col rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-2.5 shadow-[var(--shadow)]"
              data-dashboard-panel
            >
              <PanelHeader
                action={
                  <Link className="text-[0.7rem] font-semibold text-[#4f5ef7] transition hover:text-[#3f4ede]" href="/dashboard/help">
                    View all
                  </Link>
                }
                icon={BellRing}
                title="Notices"
                tone="bg-amber-500/10 text-amber-500"
              />
              <div className="mt-2 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto pr-0.5">
                {notices.map((notice, index) => (
                  <div
                    className="flex items-center gap-2 rounded-lg px-1.5 py-1 transition hover:bg-[var(--panel-muted)]"
                    key={notice}
                    title={notice}
                  >
                    <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded bg-amber-500/12 font-mono text-[0.55rem] font-bold tabular-nums text-amber-600">
                      {index + 1}
                    </span>
                    <p className="min-w-0 flex-1 truncate text-[0.76rem] font-medium text-[var(--foreground)]">{notice}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        {/* Right column: fixed-size widgets; if a short screen cannot hold all
            three, the column scrolls on its own rather than the page. */}
        <div className="flex min-h-0 min-w-0 flex-col gap-2 min-[900px]:overflow-y-auto">
          <DashboardProgressCard
            completedTasks={completedTasks}
            inProgressTasks={inProgressTasks}
            pendingTasks={pendingTasks}
            plannedTasks={plannedTasks}
          />

          <DashboardTimeSummary
            plannedTasks={plannedTasks}
            tasks={(data.tasks ?? []).map((task) => ({
              id: task.id,
              trackedMinutes: task.updates[0]?.trackedMinutes ?? 0,
            }))}
          />

          <div
            className="dashboard-accent accent-emerald flex shrink-0 flex-col rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-2.5 shadow-[var(--shadow)]"
            data-dashboard-panel
          >
            <PanelHeader icon={CalendarCheck2} title="Attendance" tone="bg-emerald-500/10 text-emerald-500" />
            {/* In and Out side by side: two stacked rows cost ~30px that the
                single-screen layout cannot spare. */}
            <div className="mt-2 overflow-hidden rounded-[0.875rem] border border-[var(--panel-border)]">
              <div className="grid grid-cols-2 divide-x divide-[var(--panel-border)]">
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-500 text-white">
                    <Check className="h-3 w-3" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[0.56rem] font-bold uppercase leading-none tracking-[0.12em] text-[var(--muted-foreground)]">
                      In
                    </p>
                    <p className="mt-0.5 truncate text-[0.78rem] font-bold leading-none tabular-nums text-[var(--foreground)]">
                      {formatTimeOnly(attendance?.checkInAt)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 px-2 py-1.5">
                  <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-[var(--panel-border)] bg-[var(--panel-alt)] text-[var(--muted-foreground)]">
                    <Clock3 className="h-3 w-3" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-[0.56rem] font-bold uppercase leading-none tracking-[0.12em] text-[var(--muted-foreground)]">
                      Out
                    </p>
                    <p className="mt-0.5 truncate text-[0.78rem] font-bold leading-none tabular-nums text-[var(--foreground)]">
                      {formatTimeOnly(attendance?.checkOutAt)}
                    </p>
                  </div>
                </div>
              </div>
              <div className="border-t border-[var(--panel-border)] bg-emerald-500/10 px-2 py-0.5 text-center text-[0.62rem] font-semibold text-emerald-600">
                {attendanceStatusLabel}
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
