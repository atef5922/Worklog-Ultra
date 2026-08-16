import { BriefcaseBusiness, History } from "lucide-react";
import { HistoryTable } from "@/components/dashboard/history-table";
import { PageHeader } from "@/components/dashboard/page-header";
import { PanelHeader } from "@/components/dashboard/panel-header";
import { requireEmployee } from "@/lib/auth/server";
import { getHistoryData, getPendingReportEditRequests } from "@/lib/worklog";

export const dynamic = "force-dynamic";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const user = await requireEmployee();
  const { from, to } = await searchParams;
  const [history, pendingApprovals] = await Promise.all([
    getHistoryData(user.id, from, to),
    getPendingReportEditRequests(user),
  ]);

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader
        icon={BriefcaseBusiness}
        subtitle="Everything you have logged, newest first."
        title="History"
      />

      <section
        className="dashboard-accent accent-violet rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-3 shadow-[var(--shadow)] sm:p-3.5"
        data-dashboard-panel
        data-page-section
      >
        <PanelHeader
          action={
            <span className="font-mono text-[0.68rem] font-semibold tabular-nums text-[var(--muted-foreground)]">
              {(history ?? []).length} {(history ?? []).length === 1 ? "record" : "records"}
            </span>
          }
          icon={History}
          title="Work History"
          tone="bg-violet-500/10 text-violet-500"
        />
        <div className="mt-2.5">
          <HistoryTable
            history={history ?? []}
            pendingApprovals={pendingApprovals ?? []}
            role={user.role}
          />
        </div>
      </section>
    </div>
  );
}
