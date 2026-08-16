import { IdCard, Image as ImageIcon, Settings, UserRound } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
import { PanelHeader } from "@/components/dashboard/panel-header";
import { ProfileSettingsForm } from "@/components/settings/profile-settings-form";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { requireUser } from "@/lib/auth/server";
import { toProfileSettingsUser } from "@/lib/contracts/user";
import { getDepartments } from "@/lib/worklog";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser();
  const departments = await getDepartments();
  const profileUser = toProfileSettingsUser(user);
  const resolvedAvatarUrl = profileUser.avatarUrl || null;

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <PageHeader
        icon={Settings}
        subtitle="Your identity, photo, and workspace preferences."
        title="Settings"
      />

      <div className="grid items-start gap-3 sm:gap-4 xl:grid-cols-[22.5rem_1fr]">
        <section
          className="dashboard-accent accent-violet rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-3 shadow-[var(--shadow)] sm:p-3.5"
          data-dashboard-panel
        >
          <PanelHeader icon={UserRound} title="Your Profile" tone="bg-violet-500/10 text-violet-500" />

          <div className="mt-2.5 flex items-center gap-3 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-3">
            <Avatar className="h-12 w-12 border-0 ring-2 ring-[#4f5ef7]/25">
              {resolvedAvatarUrl ? <AvatarImage alt={user.name} src={resolvedAvatarUrl} /> : null}
              <AvatarFallback className="text-base font-bold">{user.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <p className="truncate text-[0.95rem] font-bold text-[var(--foreground)]">{user.name}</p>
              <p className="truncate text-[0.72rem] font-bold uppercase tracking-[0.14em] text-[#4f5ef7]">
                {profileUser.displayRole}
              </p>
              <p className="truncate text-[0.75rem] text-[var(--muted-foreground)]">
                {user.department?.name ?? "Executive Office"}
              </p>
            </div>
          </div>

          <div className="mt-2 space-y-2">
            <div className="flex items-start gap-2.5 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-sky-500/10 text-sky-500">
                <ImageIcon className="h-3.5 w-3.5" />
              </span>
              <p className="text-[0.78rem] leading-5 text-[var(--muted-foreground)]">
                Your profile photo appears in the header, messages, and the team directory.
              </p>
            </div>
            <div className="flex items-start gap-2.5 rounded-xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-3">
              <span className="mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-500">
                <IdCard className="h-3.5 w-3.5" />
              </span>
              <p className="text-[0.78rem] leading-5 text-[var(--muted-foreground)]">
                Name, designation, and department are shown to teammates on every task you touch.
              </p>
            </div>
          </div>
        </section>

        <section
          className="dashboard-accent accent-indigo rounded-[1.25rem] border border-[var(--panel-border)] bg-[var(--panel)] p-3 shadow-[var(--shadow)] sm:p-3.5"
          data-dashboard-panel
        >
          <PanelHeader icon={IdCard} title="Workspace Identity" />
          <p className="mt-1.5 text-[0.78rem] leading-5 text-[var(--muted-foreground)]">
            These details appear across the workspace. Changes save immediately after you submit.
          </p>
          <div className="mt-2.5">
            <ProfileSettingsForm departments={departments} user={profileUser} />
          </div>
        </section>
      </div>
    </div>
  );
}
