"use client";

import * as Dialog from "@radix-ui/react-dialog";
import Image from "next/image";
import Link from "next/link";
import { X } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";
import {
  filterTodaysWorkPlanTasks,
  getTaskStatusForDashboard,
  isCarriedOverTask,
  sortTasksByRecency,
} from "@/lib/dashboard-work-plan-filter";
import { formatTaskPriority, normalizeTaskPriority } from "@/lib/task-priority";
import { isReopenedTask } from "@/lib/task-reopen";
import { formatMinutes } from "@/lib/utils";
import { buildTaskDetails, type DashboardWorkPlanTask } from "@/components/dashboard/dashboard-work-plan-section";
import { TaskDetailsModal, type TaskDetails } from "@/components/dashboard/task-details-modal";

export type DashboardKpiCardKey = "planned" | "completed" | "inProgress" | "pending" | "workTime";

export type DashboardKpiCard = {
  key: DashboardKpiCardKey;
  title: string;
  value: string | number;
  href: string;
  icon: ReactNode;
  art: string;
  iconWrap: string;
  card: string;
  border: string;
  accent: string;
};

const CHIP_CLASS = "task-chip inline-flex items-center rounded-full px-1.5 py-0.5 text-[0.5625rem] font-semibold";

function statusChipTone(status: "done" | "in_progress" | "pending") {
  if (status === "done") return "done";
  if (status === "in_progress") return "active";
  return "pending";
}

function statusChipLabel(status: "done" | "in_progress" | "pending") {
  if (status === "done") return "Completed";
  if (status === "in_progress") return "In Progress";
  return "Pending";
}

/**
 * Which of today's tasks belong under a given KPI tile.
 *
 * Mirrors the exact same counts the tiles themselves show (countDashboardTaskStats
 * in the filter lib), so the number on the card and the length of the list that
 * opens from it never disagree. Work Time is the one tile that isn't a status
 * bucket — it lists whatever tasks actually banked time today, longest first.
 */
function selectCategoryTasks(key: DashboardKpiCardKey, visibleTasks: DashboardWorkPlanTask[]) {
  if (key === "planned") {
    return sortTasksByRecency(visibleTasks);
  }

  if (key === "workTime") {
    return [...visibleTasks]
      .filter((task) => (task.updates[0]?.trackedMinutes ?? 0) > 0)
      .sort((left, right) => (right.updates[0]?.trackedMinutes ?? 0) - (left.updates[0]?.trackedMinutes ?? 0));
  }

  const targetStatus = key === "completed" ? "done" : key === "inProgress" ? "in_progress" : "pending";
  return sortTasksByRecency(visibleTasks.filter((task) => getTaskStatusForDashboard(task) === targetStatus));
}

export function DashboardKpiCards({
  cards,
  tasks,
  currentUserId,
}: {
  cards: DashboardKpiCard[];
  tasks: DashboardWorkPlanTask[];
  currentUserId: string;
}) {
  const [openKey, setOpenKey] = useState<DashboardKpiCardKey | null>(null);
  const [detailsTask, setDetailsTask] = useState<TaskDetails | null>(null);

  const visibleTasks = useMemo(() => filterTodaysWorkPlanTasks(tasks), [tasks]);
  const openCard = cards.find((card) => card.key === openKey) ?? null;
  const categoryTasks = useMemo(
    () => (openKey ? selectCategoryTasks(openKey, visibleTasks) : []),
    [openKey, visibleTasks],
  );

  return (
    <>
      <section className="grid shrink-0 grid-cols-5 gap-1.5 sm:gap-2 xl:gap-2.5" data-page-section>
        {cards.map((item) => {
          const compactTitle = item.title.replace(" Tasks", "").replace("Actual Work Time", "Work Time");

          return (
            <button
              /* No drop shadow: the coloured 42px glow under each card read as a
                 smudge on the background. The tinted border and the accent bar
                 carry the separation on their own. */
              className={`group relative flex min-h-[4rem] min-w-0 items-center gap-1.5 overflow-hidden rounded-[0.875rem] border p-2 text-left transition hover:-translate-y-0.5 sm:rounded-[1rem] ${item.card} ${item.border}`}
              data-dashboard-card
              key={item.key}
              onClick={() => setOpenKey(item.key)}
              title={`${item.title} · View details`}
              type="button"
            >
              <div className={`absolute inset-x-0 top-0 h-1 ${item.accent}`} />
              {/* Inset on every side, and top-2.5 rather than top-1, because the
                  motion shell floats this up by 5px forever (see
                  dashboard-motion-shell.tsx). Four of the five artworks are
                  square, so at the old width they filled the card's whole height
                  and the lift carried their heads through the accent bar and out
                  of the overflow-hidden edge. At 14% the art measures 30px in a
                  57.5px card and clears the bar by 17.6px at the top of the
                  float. The old -right-1 also hung 3.6px outside the card, which
                  clipped the right of every illustration. */}
              <div className="pointer-events-none absolute bottom-1 right-1 top-2.5 w-[14%] opacity-90">
                <Image
                  alt=""
                  aria-hidden
                  className="object-contain object-right-bottom"
                  data-dashboard-float="soft"
                  fill
                  sizes="48px"
                  src={item.art}
                />
              </div>
              <div className={`relative flex h-7 w-7 shrink-0 items-center justify-center rounded-[0.625rem] ${item.iconWrap}`}>
                {item.icon}
              </div>
              {/* Measured in Manrope at the reference viewport: the tightest card
                  is "0h 06m" (55px at 1.05rem) beside "Actual Work Time" (81px),
                  and this pairing clears a 222px card with 15.5px to spare. At
                  1.25rem the value alone costs 65px and the title truncates. The
                  8% reserve keeps the longest title 4.9px clear of the artwork. */}
              <p className="relative shrink-0 text-[1.05rem] font-bold leading-none tabular-nums text-slate-900">{item.value}</p>
              <p className="relative min-w-0 flex-1 truncate pr-[8%] text-[0.68rem] font-semibold leading-tight text-slate-600">
                <span className="sm:hidden">{compactTitle}</span>
                <span className="hidden sm:inline">{item.title}</span>
              </p>
            </button>
          );
        })}
      </section>

      <Dialog.Root onOpenChange={(open) => (open ? undefined : setOpenKey(null))} open={Boolean(openCard)}>
        <Dialog.Portal>
          <Dialog.Overlay className="fixed inset-0 z-30 bg-slate-950/60 backdrop-blur-sm" />
          <Dialog.Content className="fixed left-1/2 top-1/2 z-[35] flex max-h-[85vh] w-[min(560px,94vw)] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[24px] border border-[var(--panel-border)] bg-[var(--panel)] shadow-[0_40px_90px_rgba(15,23,42,0.34)] outline-none">
            <div className="flex shrink-0 items-center justify-between border-b border-[var(--panel-border)] px-5 py-4">
              <div>
                <Dialog.Title className="text-base font-bold text-[var(--foreground)]">{openCard?.title ?? ""}</Dialog.Title>
                <Dialog.Description className="text-xs text-[var(--muted-foreground)]">
                  {categoryTasks.length} task{categoryTasks.length === 1 ? "" : "s"} today
                </Dialog.Description>
              </div>
              <Dialog.Close asChild>
                <button
                  aria-label="Close"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-[var(--panel-border)] text-[var(--muted-foreground)] transition hover:bg-[var(--panel-muted)]"
                  type="button"
                >
                  <X className="h-4 w-4" />
                </button>
              </Dialog.Close>
            </div>

            <div className="dashboard-scroll-area min-h-0 flex-1 space-y-1.5 p-3">
              {categoryTasks.length ? (
                categoryTasks.map((task) => {
                  const status = getTaskStatusForDashboard(task) as "done" | "in_progress" | "pending";
                  const trackedMinutes = task.updates[0]?.trackedMinutes ?? 0;

                  return (
                    <button
                      className="task-card flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-[0.75rem] p-2.5 pl-3 text-left transition"
                      data-tone={status === "done" ? "done" : normalizeTaskPriority(task.priority)}
                      key={task.id}
                      onClick={() => setDetailsTask(buildTaskDetails(task, currentUserId))}
                      type="button"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.8rem] font-semibold text-[var(--foreground)]">{task.taskTitle}</p>
                        <div className="mt-1 flex flex-wrap items-center gap-1">
                          {isReopenedTask(task.taskDescription) ? (
                            <span className={CHIP_CLASS} data-chip="reopened">
                              Reopened
                            </span>
                          ) : null}
                          {isCarriedOverTask(task) ? (
                            <span className={CHIP_CLASS} data-chip="pending" title={`Still open from ${task.planDate}`}>
                              Carried Over
                            </span>
                          ) : null}
                          <span className={CHIP_CLASS} data-chip={normalizeTaskPriority(task.priority)}>
                            {formatTaskPriority(task.priority)}
                          </span>
                          <span className={CHIP_CLASS} data-chip={statusChipTone(status)}>
                            {statusChipLabel(status)}
                          </span>
                          <span className={CHIP_CLASS} title={task.departmentName}>
                            {task.departmentName}
                          </span>
                        </div>
                      </div>
                      {trackedMinutes > 0 ? (
                        <span className="shrink-0 text-[0.7rem] font-bold tabular-nums text-[var(--muted-foreground)]">
                          {formatMinutes(trackedMinutes)}
                        </span>
                      ) : null}
                    </button>
                  );
                })
              ) : (
                <div className="rounded-2xl border border-dashed border-[var(--panel-border)] bg-[var(--panel-muted)] px-4 py-8 text-center text-sm text-[var(--muted-foreground)]">
                  Nothing here for today.
                </div>
              )}
            </div>

            {openCard ? (
              <div className="shrink-0 border-t border-[var(--panel-border)] px-5 py-3 text-center">
                <Link
                  className="text-xs font-semibold text-[#4f5ef7] hover:text-[#3f4ede]"
                  href={openCard.href}
                  onClick={() => setOpenKey(null)}
                >
                  Open full page
                </Link>
              </div>
            ) : null}
          </Dialog.Content>
        </Dialog.Portal>
      </Dialog.Root>

      <TaskDetailsModal onOpenChange={(open) => (open ? undefined : setDetailsTask(null))} task={detailsTask} />
    </>
  );
}
