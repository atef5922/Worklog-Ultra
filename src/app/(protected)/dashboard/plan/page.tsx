import { ClipboardList } from "lucide-react";
import { PageHeader } from "@/components/dashboard/page-header";
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
      <PageHeader
        icon={ClipboardList}
        subtitle="Build today's task list with department-aware entries and clear priorities."
        title="Today's Task"
      />
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
