"use client";

import { motion } from "framer-motion";
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
    <motion.div
      className="dashboard-accent accent-violet shrink-0 rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-2.5 shadow-[var(--shadow)]"
      data-dashboard-panel
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.38, ease: "easeOut" }}
      whileHover={{ y: -3, boxShadow: "0 24px 52px rgba(87, 113, 150, 0.18)" }}
    >
      <PanelHeader icon={PieChart} title="Today's Progress" tone="bg-violet-500/10 text-violet-500" />
      {/* Ring beside the legend keeps this card short enough for the
          single-screen dashboard without shrinking the numbers. */}
      <div className="mt-2 flex items-center gap-3">
        <motion.div
          className="dashboard-progress-ring flex h-[4rem] w-[4rem] shrink-0 items-center justify-center rounded-full"
          key={`${plannedTasks}-${completedTasks}-${inProgressTasks}-${pendingTasks}`}
          layout
          transition={{ duration: 0.42, ease: "easeOut" }}
          style={{ background: ringBackground }}
        >
          <div className="flex h-[2.875rem] w-[2.875rem] flex-col items-center justify-center rounded-full bg-[var(--panel)]">
            <motion.p
              className="text-[1.15rem] font-bold leading-none text-[var(--foreground)]"
              key={plannedTasks}
              initial={{ opacity: 0.45, scale: 0.88 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.26 }}
            >
              {plannedTasks}
            </motion.p>
            <p className="mt-0.5 text-[0.58rem] leading-none text-[var(--muted-foreground)]">Total</p>
          </div>
        </motion.div>
        <div className="min-w-0 flex-1 space-y-1">
          {items.map((item) => (
            <motion.div
              className="flex items-center justify-between gap-2 rounded-lg border border-[var(--panel-border)] bg-[var(--panel-muted)] px-2 py-1 text-[0.75rem]"
              key={`${item.label}-${item.value}`}
              layout
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.24 }}
            >
              <div className="flex min-w-0 items-center gap-1.5">
                <span className={`h-2 w-2 shrink-0 rounded-full ${item.color}`} />
                <span className="min-w-0 truncate font-medium text-[var(--muted-foreground)]">{item.label}</span>
              </div>
              <span className="shrink-0 font-semibold tabular-nums text-[var(--foreground)]">
                {item.value} ({plannedTasks ? Math.round((item.value / plannedTasks) * 100) : 0}%)
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
