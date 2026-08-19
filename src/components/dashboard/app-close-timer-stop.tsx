"use client";

import { useEffect } from "react";

/**
 * Stops any running task or attendance timer when the user closes the app/tab.
 * Browser: uses beforeunload + sendBeacon to notify server.
 * Electron: listens for app quit event via IPC.
 */
export function AppCloseTimerStop() {
  useEffect(() => {
    // Browser tab close detection
    function handleBeforeUnload() {
      // Send beacon to stop any running timers on the server
      navigator.sendBeacon("/api/dashboard/report", JSON.stringify({
        reportDate: new Date().toISOString().split("T")[0],
        updates: [], // Empty updates — server stops any running timers for this user
      }));
    }

    window.addEventListener("beforeunload", handleBeforeUnload);

    // Electron app quit detection (if running in desktop)
    let unsubscribeElectronQuit: (() => void) | null = null;
    if (typeof window !== "undefined" && (window as any).worklogDesktop?.isDesktop) {
      const worklogDesktop = (window as any).worklogDesktop;
      if (worklogDesktop.onAppQuit) {
        unsubscribeElectronQuit = worklogDesktop.onAppQuit(() => {
          // App is quitting; stop any running timers
          navigator.sendBeacon("/api/dashboard/report", JSON.stringify({
            reportDate: new Date().toISOString().split("T")[0],
            updates: [],
          }));
        });
      }
    }

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      if (unsubscribeElectronQuit) unsubscribeElectronQuit();
    };
  }, []);

  return null;
}
