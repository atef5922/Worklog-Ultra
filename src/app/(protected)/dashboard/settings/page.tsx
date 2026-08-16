import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ProfileSettingsForm } from "@/components/settings/profile-settings-form";
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
    <div className="grid gap-5 xl:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader>
          <CardTitle>Profile Settings</CardTitle>
          <CardDescription>Update your identity, photo, and workspace preferences.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center gap-4 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-4">
            <Avatar>
              {resolvedAvatarUrl ? <AvatarImage alt={user.name} src={resolvedAvatarUrl} /> : null}
              <AvatarFallback>{user.name.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div>
              <p className="text-lg font-semibold text-white">{user.name}</p>
              <p className="text-sm text-[var(--muted-foreground)]">{profileUser.displayRole}</p>
              <p className="text-sm text-[var(--muted-foreground)]">{user.department?.name ?? "Executive Office"}</p>
            </div>
          </div>
          <div className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-4 text-sm text-[var(--muted-foreground)]">
            Your uploaded profile photo will appear in the left sidebar, top header, messages, and future enterprise directory screens.
          </div>
          <div className="rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-muted)] p-4 text-sm text-[var(--muted-foreground)]">
            Theme switching, salary baseline, and account support all live inside this same enterprise settings area.
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Workspace Identity</CardTitle>
          <CardDescription>These settings affect how your account appears across the enterprise system.</CardDescription>
        </CardHeader>
        <CardContent>
          <ProfileSettingsForm departments={departments} user={profileUser} />
        </CardContent>
      </Card>
    </div>
  );
}
