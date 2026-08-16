"use client";

import { Camera, Download, FolderOpen } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function TaskScreenshotMonitor({ currentUserId, initiallyWorking }: { currentUserId: string; initiallyWorking: boolean }) {
  const [status, setStatus] = useState<WorklogTrackerStatus | null>(null);
  const isDesktop = useSyncExternalStore(
    () => () => {},
    () => Boolean(window.worklogDesktop),
    () => false,
  );

  useEffect(() => {
    const bridge = window.worklogDesktop;
    if (!bridge) return;
    void bridge.getTrackerStatus().then(setStatus);
    const unsubscribe = bridge.onTrackerStatus(setStatus);

    if (initiallyWorking) {
      void bridge.startTracking({ source: "attendance", label: "Attendance", userId: currentUserId, taskId: "attendance" }).then(setStatus);
    }

    const onStart = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string; label?: string }>).detail;
      const source = detail?.source ?? "work";
      void bridge.startTracking({ source, label: detail?.label ?? "Work session", userId: currentUserId, taskId: source.replace(/^task:/, "") }).then(setStatus);
    };
    const onStop = (event: Event) => {
      const detail = (event as CustomEvent<{ source?: string }>).detail;
      void bridge.stopTracking({ source: detail?.source ?? "work" }).then(setStatus);
    };
    window.addEventListener("worklog:task-monitor-start", onStart);
    window.addEventListener("worklog:task-monitor-stop", onStop);
    return () => {
      unsubscribe();
      window.removeEventListener("worklog:task-monitor-start", onStart);
      window.removeEventListener("worklog:task-monitor-stop", onStop);
    };
  }, [currentUserId, initiallyWorking]);

  async function exportScreenshots() {
    const result = await window.worklogDesktop?.exportTrackerScreenshots({ userId: currentUserId });
    if (!result || result.canceled) return;
    if (!result.ok) toast.error(result.message ?? "Screenshots could not be exported.");
    else toast.success(`Screenshots exported to ${result.destination}`);
  }

  return (
    <section className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm" data-page-section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 font-semibold text-slate-900"><Camera className="h-4 w-4" /> My Task Monitor</h2>
          <p className="mt-1 text-xs text-slate-600">
            {!isDesktop
              ? "Open this project with the WorkLog Electron app to enable native screenshots."
              : status?.running
                ? `Running · ${status.active.length} active work source(s) · screenshot every 5 minutes · ${status.pending} pending`
                : "Ready. Attendance or task Start will begin native desktop capture."}
          </p>
          {status?.folder ? <p className="mt-1 break-all text-[11px] text-slate-500">Saved folder: {status.folder} · Retention: {status.retentionDays} days</p> : null}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={!isDesktop} onClick={() => void exportScreenshots()} size="sm" type="button" variant="secondary">
            <Download className="mr-2 h-4 w-4" /> Export
          </Button>
          <Button disabled={!isDesktop} onClick={() => void window.worklogDesktop?.openTrackerFolder({ userId: currentUserId })} size="sm" type="button" variant="secondary">
            <FolderOpen className="mr-2 h-4 w-4" /> Open screenshot folder
          </Button>
        </div>
      </div>
    </section>
  );
}
