"use client";

import { Camera, Download, FolderOpen } from "lucide-react";
import { useEffect, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export function TaskScreenshotMonitor({ currentUserId, initiallyWorking }: { currentUserId: string; initiallyWorking: boolean }) {
  const [status, setStatus] = useState<WorklogTrackerStatus | null>(null);
  /*
   * The desktop preload can attach `window.worklogDesktop` after React hydrates.
   * With an empty subscribe this was read exactly once, so any reload that beat
   * the bridge left this panel stuck on "open the desktop app" forever. Polling
   * briefly and then notifying React fixes that without a render loop.
   */
  const isDesktop = useSyncExternalStore(
    (onStoreChange) => {
      if (window.worklogDesktop) {
        return () => {};
      }

      let attempts = 0;
      const intervalId = window.setInterval(() => {
        if (window.worklogDesktop) {
          window.clearInterval(intervalId);
          onStoreChange();
          return;
        }

        if (++attempts >= 24) {
          window.clearInterval(intervalId);
        }
      }, 250);

      return () => window.clearInterval(intervalId);
    },
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
    // isDesktop is a dependency so this wires up the moment the bridge appears,
    // not only when the component happened to mount after it.
  }, [currentUserId, initiallyWorking, isDesktop]);

  async function exportScreenshots() {
    const result = await window.worklogDesktop?.exportTrackerScreenshots({ userId: currentUserId });
    if (!result || result.canceled) return;
    if (!result.ok) toast.error(result.message ?? "Screenshots could not be exported.");
    else toast.success(`Screenshots exported to ${result.destination}`);
  }

  return (
    <section
      className="mt-2.5 shrink-0 rounded-xl border border-[var(--panel-border)] bg-[var(--panel)] px-2.5 py-1.5 shadow-sm"
      data-page-section
    >
      {/* One compact line: this is a utility strip, not a panel — every pixel
          it gives back goes to the work plan above it. */}
      <div className="flex items-center gap-2.5">
        <span
          className={`inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
            status?.running ? "bg-emerald-500/12 text-emerald-500" : "bg-slate-500/10 text-slate-500"
          }`}
        >
          <Camera className="h-3.5 w-3.5" />
        </span>
        <p className="shrink-0 text-[0.78rem] font-bold text-[var(--foreground)]">Task Monitor</p>
        <p
          className="min-w-0 flex-1 truncate text-[0.72rem] text-[var(--muted-foreground)]"
          title={status?.folder ? `Saved to ${status.folder} · kept ${status.retentionDays} days` : undefined}
        >
          {!isDesktop
            ? "Open the WorkLog desktop app to enable native screenshots."
            : status?.running
              ? `Running · ${status.active.length} source(s) · every 5 min · ${status.pending} pending`
              : "Ready — Attendance or task Start begins capture."}
        </p>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            className="h-7 rounded-lg px-2.5 text-[0.7rem]"
            disabled={!isDesktop}
            onClick={() => void exportScreenshots()}
            type="button"
            variant="secondary"
          >
            <Download className="h-3.5 w-3.5" /> Export
          </Button>
          <Button
            className="h-7 rounded-lg px-2.5 text-[0.7rem]"
            disabled={!isDesktop}
            onClick={() => void window.worklogDesktop?.openTrackerFolder({ userId: currentUserId })}
            type="button"
            variant="secondary"
          >
            <FolderOpen className="h-3.5 w-3.5" /> Folder
          </Button>
        </div>
      </div>
    </section>
  );
}
