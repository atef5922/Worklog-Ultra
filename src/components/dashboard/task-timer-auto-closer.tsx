"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import {
  TASK_AUTO_STOP_NOTE_EVENT,
  writePendingTaskAutoStopNote,
  type TaskAutoStopNotePayload,
} from "@/lib/task-auto-stop-note";
import { getDhakaCutoffIso, parseDhakaDateTime, toDateTimeInputValue } from "@/lib/utils";

const TIMER_STORAGE_PREFIX = "task-timer:";

type StoredTimerSnapshot = {
  status: "done" | "in_progress" | "pending";
  trackedMinutes: string;
  trackedSeconds?: string;
  actualStart: string;
  actualEnd: string;
  runningStartedAt: string;
};

function parseTimerStorageKey(key: string) {
  if (!key.startsWith(TIMER_STORAGE_PREFIX)) {
    return null;
  }

  const [, reportDate, ...taskIdParts] = key.split(":");
  const taskId = taskIdParts.join(":");

  if (!reportDate || !taskId) {
    return null;
  }

  return { reportDate, taskId };
}

export function TaskTimerAutoCloser() {
  const router = useRouter();
  const pendingKeysRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    async function flushAutoStops() {
      if (typeof window === "undefined") {
        return;
      }

      const now = Date.now();
      const saveJobs: Array<Promise<boolean>> = [];

      for (let index = 0; index < window.localStorage.length; index += 1) {
        const storageKey = window.localStorage.key(index);

        if (!storageKey || pendingKeysRef.current.has(storageKey)) {
          continue;
        }

        const parsedKey = parseTimerStorageKey(storageKey);
        if (!parsedKey) {
          continue;
        }

        const raw = window.localStorage.getItem(storageKey);
        if (!raw) {
          continue;
        }

        let snapshot: StoredTimerSnapshot;

        try {
          snapshot = JSON.parse(raw) as StoredTimerSnapshot;
        } catch {
          continue;
        }

        if (!snapshot.runningStartedAt) {
          continue;
        }

        const runningStartedAt = new Date(snapshot.runningStartedAt).getTime();
        if (!Number.isFinite(runningStartedAt)) {
          continue;
        }

        const regularCutoffIso = getDhakaCutoffIso(parsedKey.reportDate, 19, 30);
        const overtimeCutoffIso = getDhakaCutoffIso(parsedKey.reportDate, 22, 0);
        const regularCutoffAt = new Date(regularCutoffIso).getTime();
        const overtimeCutoffAt = new Date(overtimeCutoffIso).getTime();
        const isOvertimeSession = runningStartedAt >= regularCutoffAt;
        const shouldStop =
          (!isOvertimeSession && now >= regularCutoffAt) ||
          (isOvertimeSession && now >= overtimeCutoffAt);

        if (!shouldStop) {
          continue;
        }

        const stopIso = isOvertimeSession ? overtimeCutoffIso : regularCutoffIso;
        const stopAt = new Date(stopIso).getTime();
        const trackedSecondsBase = Number(
          snapshot.trackedSeconds ?? String(Number(snapshot.trackedMinutes || 0) * 60),
        );
        const trackedSecondsAtStop = trackedSecondsBase + Math.max(0, Math.floor((stopAt - runningStartedAt) / 1000));
        const nextSnapshot: StoredTimerSnapshot = {
          status: "in_progress",
          trackedMinutes: String(Math.floor(trackedSecondsAtStop / 60)),
          trackedSeconds: String(trackedSecondsAtStop),
          actualStart: snapshot.actualStart || toDateTimeInputValue(stopIso),
          actualEnd: toDateTimeInputValue(stopIso),
          runningStartedAt: "",
        };

        window.localStorage.setItem(storageKey, JSON.stringify(nextSnapshot));
        pendingKeysRef.current.add(storageKey);

        saveJobs.push(
          fetch("/api/dashboard/report", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              reportDate: parsedKey.reportDate,
              updates: [
                {
                  dailyTaskId: parsedKey.taskId,
                  status: nextSnapshot.status,
                  note: "",
                  completionPercent: 0,
                  trackedMinutes: Number(nextSnapshot.trackedMinutes || 0),
                  actualStart: nextSnapshot.actualStart,
                  actualEnd: nextSnapshot.actualEnd,
                  difficultyLevel: "",
                },
              ],
            }),
          })
            .then(async (response) => {
              if (!response.ok) {
                // Re-open the running snapshot so the next cycle can retry.
                const runningSnapshot: StoredTimerSnapshot = {
                  ...snapshot,
                  runningStartedAt: snapshot.runningStartedAt,
                  actualEnd: snapshot.actualEnd,
                };
                window.localStorage.setItem(storageKey, JSON.stringify(runningSnapshot));
                return false;
              }

              const autoStopPayload: TaskAutoStopNotePayload = {
                taskId: parsedKey.taskId,
                reportDate: parsedKey.reportDate,
                actualStart: nextSnapshot.actualStart,
                actualEnd: nextSnapshot.actualEnd,
                trackedMinutes: Number(nextSnapshot.trackedMinutes || 0),
                timestamp: Date.now(),
              };

              writePendingTaskAutoStopNote(autoStopPayload);
              window.dispatchEvent(
                new CustomEvent(TASK_AUTO_STOP_NOTE_EVENT, {
                  detail: autoStopPayload,
                }),
              );

              return true;
            })
            .catch(() => {
              window.localStorage.setItem(storageKey, JSON.stringify(snapshot));
              return false;
            })
            .finally(() => {
              pendingKeysRef.current.delete(storageKey);
            }),
        );
      }

      if (!saveJobs.length) {
        return;
      }

      const results = await Promise.all(saveJobs);
      if (results.some(Boolean)) {
        router.refresh();
      }
    }

    flushAutoStops().catch(() => null);
    const interval = window.setInterval(() => {
      flushAutoStops().catch(() => null);
    }, 30_000);

    return () => window.clearInterval(interval);
  }, [router]);

  return null;
}
