import { ClipboardList } from "lucide-react";
import { PlanForm } from "@/components/dashboard/plan-form";
import { requireEmployee } from "@/lib/auth/server";
import { getAssignableUsers, getDepartments, getPlanSuggestions } from "@/lib/worklog";
import { isTenderDepartmentName } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function PlanPage() {
  const user = await requireEmployee();
  const isTenderDepartment = isTenderDepartmentName(user.department?.name);
  const [departments, suggestions, assignableUsers] = await Promise.all([
    getDepartments(),
    getPlanSuggestions(user.id, user.departmentId),
    getAssignableUsers(),
  ]);

  return (
    <div className="flex flex-col gap-3 sm:gap-4">
      <section className="flex min-w-0 items-center gap-2.5" data-page-section>
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[0.875rem] bg-[linear-gradient(140deg,#6172ff_0%,#7c6cf8_46%,#a855f7_100%)] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.38),inset_0_0_0_1px_rgba(255,255,255,0.22),0_4px_10px_rgba(79,94,247,0.26),0_10px_24px_rgba(139,92,246,0.24)]">
          <ClipboardList className="h-4.5 w-4.5" strokeWidth={2.3} />
        </span>
        <div className="min-w-0">
          <h1 className="truncate text-[1.05rem] font-semibold leading-tight text-[var(--foreground)] sm:text-[1.18rem] lg:text-xl">
            Today&apos;s Task
          </h1>
          <p className="truncate text-xs text-[var(--muted-foreground)] sm:text-sm">
            Build today&apos;s task list with department-aware entries and clear priorities.
          </p>
        </div>
      </section>
      <PlanForm
        assignableUsers={assignableUsers ?? []}
        currentUserId={user.id}
        departments={departments ?? []}
        initialTasks={[]}
        isTenderDepartment={isTenderDepartment}
        suggestions={suggestions ?? []}
        userDepartmentId={user.departmentId}
        role={user.role}
      />
    </div>
  );
}
