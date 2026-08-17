"use client";

import { PieChart } from "lucide-react";
import { useEffect, useState } from "react";
import { PanelHeader } from "@/components/dashboard/panel-header";

type DashboardStats = {
  plannedTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
};

export function DashboardProgressCard({
  plannedTasks: initialPlannedTasks,
  completedTasks: initialCompletedTasks,
  inProgressTasks: initialInProgressTasks,
  pendingTasks: initialPendingTasks,
}: {
  plannedTasks: number;
  completedTasks: number;
  inProgressTasks: number;
  pendingTasks: number;
}) {
  const [stats, setStats] = useState<DashboardStats>({
    plannedTasks: initialPlannedTasks,
    completedTasks: initialCompletedTasks,
    inProgressTasks: initialInProgressTasks,
    pendingTasks: initialPendingTasks,
  });

  useEffect(() => {
    setStats({
      plannedTasks: initialPlannedTasks,
      completedTasks: initialCompletedTasks,
      inProgressTasks: initialInProgressTasks,
      pendingTasks: initialPendingTasks,
    });
  }, [initialCompletedTasks, initialInProgressTasks, initialPendingTasks, initialPlannedTasks]);

  useEffect(() => {
    function handleStatsUpdated(event: Event) {
      const detail = (event as CustomEvent<DashboardStats>).detail;
      if (!detail) {
        return;
      }

      setStats(detail);
    }

    window.addEventListener("dashboard:stats-updated", handleStatsUpdated);
    return () => window.removeEventListener("dashboard:stats-updated", handleStatsUpdated);
  }, []);

  const { plannedTasks, completedTasks, inProgressTasks, pendingTasks } = stats;
  const items = [
    { label: "Completed", value: completedTasks, color: "bg-emerald-500" },
    { label: "In Progress", value: inProgressTasks, color: "bg-blue-500" },
    { label: "Pending", value: pendingTasks, color: "bg-amber-400" },
  ];
  const totalTasks = Math.max(plannedTasks, completedTasks + inProgressTasks + pendingTasks);
  const completedDegrees = totalTasks ? (completedTasks / totalTasks) * 360 : 0;
  const inProgressDegrees = totalTasks ? (inProgressTasks / totalTasks) * 360 : 0;
  const pendingDegrees = Math.max(0, 360 - completedDegrees - inProgressDegrees);
  const ringBackground =
    totalTasks > 0
      ? `conic-gradient(#34c38f 0deg ${completedDegrees}deg, #3b82f6 ${completedDegrees}deg ${completedDegrees + inProgressDegrees}deg, #fbbf24 ${completedDegrees + inProgressDegrees}deg ${completedDegrees + inProgressDegrees + pendingDegrees}deg, #e8eef8 ${completedDegrees + inProgressDegrees + pendingDegrees}deg 360deg)`
      : "conic-gradient(#e8eef8 0deg 360deg)";

  return (
    /*
     * No framer entrance here. This card was the last one still hiding its
     * server-rendered markup behind `initial={{ opacity: 0 }}`, which is why it
     * always arrived after the rest of the dashboard. The shared CSS entrance on
     * `[data-dashboard-panel]` covers it now, and so does the CSS hover lift.
     */
    <div
      className="dashboard-accent accent-violet shrink-0 rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-2.5"
      data-dashboard-panel
    >
      <PanelHeader icon={PieChart} title="Today's Progress" tone="bg-violet-500/10 text-violet-500" />
      {/* Ring beside the legend keeps this card short enough for the
          single-screen dashboard without shrinking the numbers. */}
      <div className="mt-2 flex items-center gap-3">
        <div
          className="dashboard-progress-ring flex h-[4rem] w-[4rem] shrink-0 items-center justify-center rounded-full"
          style={{ background: ringBackground }}
        >
          <div className="flex h-[2.875rem] w-[2.875rem] flex-col items-center justify-center rounded-full bg-[var(--panel)]">
            {/* Keyed so a changed total remounts the node and replays the CSS
                pop; on first paint it plays once with the page. */}
            <p className="dashboard-value-pop text-[1.15rem] font-bold leading-none text-[var(--foreground)]" key={plannedTasks}>
              {plannedTasks}
            </p>
            <p className="mt-0.5 text-[0.58rem] leading-none text-[var(--muted-foreground)]">Total</p>
          </div>
        </div>
        <div className="min-w-0 flex-1 space-y-1">
          {items.map((item) => (
            <div
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-muted)] px-2 py-1 text-[0.75rem]"
              key={item.label}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${item.color}`} />
                <span className="min-w-0 truncate font-medium text-[var(--muted-foreground)]">{item.label}</span>
              </div>
              <span className="shrink-0 font-semibold tabular-nums text-[var(--foreground)]">
                {item.value} ({plannedTasks ? Math.round((item.value / plannedTasks) * 100) : 0}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
