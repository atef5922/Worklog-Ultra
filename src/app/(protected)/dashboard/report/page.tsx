import Link from "next/link";
import { CheckCircle2, ClipboardList, Clock3, Download, FileClock, PlayCircle, Search } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { PanelHeader } from "@/components/dashboard/panel-header";
import { requireEmployee } from "@/lib/auth/server";
import { buildReportSummary } from "@/lib/report-summary";
import { getHistoryData } from "@/lib/worklog";
import { formatMinutes, toDateOnly } from "@/lib/utils";

export const dynamic = "force-dynamic";

function normalizeDateParam(value?: string | string[]) {
  if (Array.isArray(value)) {
    return normalizeDateParam(value[0]);
  }

  if (!value) {
    return null;
  }

  const normalized = toDateOnly(value);
  return /^\d{4}-\d{2}-\d{2}$/.test(normalized) ? normalized : null;
}

function formatRangeDate(value: string) {
  return new Intl.DateTimeFormat("en-BD", {
    timeZone: "Asia/Dhaka",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00+06:00`));
}

function formatRangeLabel(from: string, to: string) {
  if (from === to) {
    return formatRangeDate(from);
  }

  return `${formatRangeDate(from)} to ${formatRangeDate(to)}`;
}

function statusTone(status: "done" | "in_progress" | "pending") {
  if (status === "done") {
    return "bg-emerald-500/10 text-emerald-600";
  }

  if (status === "in_progress") {
    return "bg-blue-500/10 text-blue-600";
  }

  return "bg-amber-500/10 text-amber-600";
}

function statusLabel(status: "done" | "in_progress" | "pending") {
  if (status === "done") return "Completed";
  if (status === "in_progress") return "In Progress";
  return "Pending";
}

// Shared by the header row and the data rows so the columns can never drift.
const gridCols = "md:grid-cols-[2.75rem_7rem_minmax(0,1fr)_7.5rem_5.5rem]";
const dateFieldClass =
  "h-10 w-full rounded-xl border border-[var(--panel-border)] bg-[var(--panel-muted)] px-2.5 text-[0.82rem] text-[var(--foreground)] outline-none transition focus:border-[#4f5ef7]";
const fieldLabelClass =
  "mb-1 block text-[0.62rem] font-bold uppercase tracking-[0.16em] text-[var(--muted-foreground)]";

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{
    date?: string | string[];
    from?: string | string[];
    to?: string | string[];
    taskId?: string | string[];
  }>;
}) {
  const user = await requireEmployee();
  const { date, from, to, taskId } = await searchParams;

  const selectedDate = normalizeDateParam(date) ?? toDateOnly();
  const requestedFrom = normalizeDateParam(from) ?? selectedDate;
  const requestedTo = normalizeDateParam(to) ?? selectedDate;
  const exactDateView = Boolean(taskId) || (!from && !to);
  const focusedFrom = exactDateView ? selectedDate : requestedFrom;
  const focusedTo = exactDateView ? selectedDate : requestedTo;

  const rangeFrom = focusedFrom <= focusedTo ? focusedFrom : focusedTo;
  const rangeTo = focusedFrom <= focusedTo ? focusedTo : focusedFrom;
  const historyTasks = await getHistoryData(user.id, rangeFrom, rangeTo);
  const summary = buildReportSummary(historyTasks);
  const downloadHref = `/api/dashboard/report/export?from=${encodeURIComponent(rangeFrom)}&to=${encodeURIComponent(rangeTo)}`;

  const summaryTiles = [
    {
      accent: "accent-indigo",
      icon: ClipboardList,
      label: "Tasks",
      tone: "bg-[#4f5ef7]/10 text-[#4f5ef7]",
      value: String(summary.totals.totalTasks),
      valueTone: "text-[var(--foreground)]",
    },
    {
      accent: "accent-emerald",
      icon: CheckCircle2,
      label: "Completed",
      tone: "bg-emerald-500/10 text-emerald-500",
      value: String(summary.totals.completedTasks),
      valueTone: "text-emerald-600",
    },
    {
      accent: "accent-sky",
      icon: PlayCircle,
      label: "In Progress",
      tone: "bg-sky-500/10 text-sky-500",
      value: String(summary.totals.inProgressTasks),
      valueTone: "text-sky-600",
    },
    {
      accent: "accent-violet",
      icon: Clock3,
      label: "Tracked Time",
      tone: "bg-violet-500/10 text-violet-500",
      value: summary.totals.totalTrackedLabel,
      valueTone: "text-[var(--foreground)]",
    },
  ];

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader
        action={
          <form
            action="/dashboard/report"
            className="grid grid-cols-2 gap-2 sm:grid-cols-[9rem_9rem_auto_auto] sm:items-end"
            method="get"
          >
          <div>
            <label className={fieldLabelClass} htmlFor="report-from">
              From
            </label>
            <input className={dateFieldClass} defaultValue={rangeFrom} id="report-from" name="from" type="date" />
          </div>
          <div>
            <label className={fieldLabelClass} htmlFor="report-to">
              To
            </label>
            <input className={dateFieldClass} defaultValue={rangeTo} id="report-to" name="to" type="date" />
          </div>
          <button
            className="button-force-white inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-[#4f5ef7] px-3.5 text-[0.82rem] font-semibold text-white shadow-[0_10px_22px_rgba(79,94,247,0.24)] transition hover:bg-[#4453eb]"
            type="submit"
          >
            <Search className="h-3.5 w-3.5" />
            View
          </button>
          <Link
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-3.5 text-[0.82rem] font-semibold text-[var(--foreground)] transition hover:border-[#4f5ef7]/40 hover:bg-[var(--panel-alt)]"
            href={downloadHref}
          >
            <Download className="h-3.5 w-3.5" />
            Download
          </Link>
          </form>
        }
        icon={FileClock}
        subtitle={formatRangeLabel(rangeFrom, rangeTo)}
        title="Work Report"
      />

      <section className="grid gap-2.5 sm:grid-cols-2 2xl:grid-cols-4" data-page-section>
        {summaryTiles.map((tile) => {
          const Icon = tile.icon;

          return (
            <div
              className={`dashboard-accent ${tile.accent} flex items-center gap-3 rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-3 shadow-[var(--shadow)] sm:p-3.5`}
              data-dashboard-card
              key={tile.label}
            >
              <span className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.75rem] ${tile.tone}`}>
                <Icon className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)]">
                  {tile.label}
                </p>
                <p className={`mt-0.5 truncate text-[1.25rem] font-bold leading-none tabular-nums ${tile.valueTone}`}>
                  {tile.value}
                </p>
              </div>
            </div>
          );
        })}
      </section>

      <section
        className="dashboard-accent accent-sky rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-3 shadow-[var(--shadow)] sm:p-3.5"
        data-dashboard-panel
        data-page-section
      >
        <PanelHeader
          action={
            <span className="font-mono text-[0.68rem] font-semibold tabular-nums text-[var(--muted-foreground)]">
              {summary.items.length} {summary.items.length === 1 ? "entry" : "entries"}
            </span>
          }
          icon={FileClock}
          title="Report Entries"
          tone="bg-sky-500/10 text-sky-500"
        />

        <div className="mt-2.5 overflow-hidden rounded-xl border border-[var(--panel-border)]">
          <div
            className={`hidden border-b-2 border-[var(--panel-border)] bg-[var(--panel-muted)] text-[0.62rem] font-bold uppercase tracking-[0.14em] text-[var(--muted-foreground)] md:grid ${gridCols} md:divide-x md:divide-[var(--panel-border)]`}
          >
            <span className="px-2 py-2 text-right">#</span>
            <span className="px-3 py-2">Date</span>
            <span className="px-3 py-2">Task</span>
            <span className="px-3 py-2">Status</span>
            <span className="px-3 py-2 text-right">Time</span>
          </div>
          <div className="divide-y divide-[var(--panel-border)]">
            {summary.items.length ? (
              summary.items.map((item, index) => (
                <div
                  className={`px-3 py-2.5 transition-colors even:bg-[var(--panel-muted)]/60 hover:bg-[var(--panel-alt)] md:grid ${gridCols} md:items-center md:divide-x md:divide-[var(--panel-border)] md:px-0 md:py-0`}
                  key={item.id}
                >
                  <p className="hidden font-mono text-[0.7rem] font-semibold tabular-nums text-[var(--muted-foreground)] md:block md:px-2 md:py-2.5 md:text-right">
                    {String(index + 1).padStart(2, "0")}
                  </p>
                  <p className="font-mono text-[0.72rem] font-semibold tabular-nums text-[var(--muted-foreground)] md:px-3 md:py-2.5">
                    {item.date}
                  </p>
                  <div className="mt-1.5 min-w-0 md:mt-0 md:px-3 md:py-2.5">
                    <div className="flex flex-wrap items-center gap-2 md:block">
                      <p className="line-clamp-1 break-words text-[0.82rem] font-semibold text-[var(--foreground)]">
                        {item.title}
                      </p>
                      <span
                        className={`inline-flex shrink-0 rounded-full px-2 py-0.5 text-[0.65rem] font-bold md:hidden ${statusTone(item.status)}`}
                      >
                        {statusLabel(item.status)}
                      </span>
                    </div>
                    <p className="mt-0.5 line-clamp-1 break-words text-[0.72rem] text-[var(--muted-foreground)]">
                      {[item.departmentName, item.description || item.note || "No extra details"].join(" · ")}
                    </p>
                  </div>
                  <div className="mt-2 hidden md:mt-0 md:block md:px-3 md:py-2.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[0.65rem] font-bold ${statusTone(item.status)}`}>
                      {statusLabel(item.status)}
                    </span>
                  </div>
                  <p className="mt-2 font-mono text-[0.76rem] font-bold tabular-nums text-[var(--foreground)] md:mt-0 md:px-3 md:py-2.5 md:text-right">
                    {formatMinutes(item.trackedMinutes)}
                  </p>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center gap-1.5 bg-[var(--panel-muted)] px-4 py-8 text-center">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-sky-500/10 text-sky-500">
                  <FileClock className="h-4 w-4" />
                </span>
                <p className="text-[0.8rem] font-medium text-[var(--muted-foreground)]">
                  No report data for this date range.
                </p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
