import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/**
 * Shared heading for dashboard panels: tinted icon chip + title + optional action.
 * Keeps every panel on the same rhythm instead of each card inventing its own header.
 */
export function PanelHeader({
  action,
  icon: Icon,
  title,
  tone = "bg-[#4f5ef7]/10 text-[#4f5ef7]",
}: {
  action?: ReactNode;
  icon: LucideIcon;
  title: string;
  tone?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-2">
        <span className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[0.625rem] ${tone}`}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h3 className="truncate text-[0.92rem] font-bold tracking-[-0.01em] text-[var(--foreground)] sm:text-[0.98rem]">
          {title}
        </h3>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}
