type WorklogTrackerStatus = {
  running: boolean;
  active: Array<{ source: string; label: string }>;
  pending: number;
  intervalMinutes: number;
  folder: string;
  retentionDays: number;
};

interface Window {
  worklogDesktop?: {
    isDesktop: true;
    startTracking(input: { source: string; label: string; userId: string; taskId: string }): Promise<WorklogTrackerStatus>;
    stopTracking(input: { source: string }): Promise<WorklogTrackerStatus>;
    getTrackerStatus(): Promise<WorklogTrackerStatus>;
    openTrackerFolder(input: { userId: string }): Promise<string>;
    exportTrackerScreenshots(input: { userId: string }): Promise<{ ok: boolean; canceled?: boolean; message?: string; destination?: string }>;
    onTrackerStatus(callback: (status: WorklogTrackerStatus) => void): () => void;
  };
}
