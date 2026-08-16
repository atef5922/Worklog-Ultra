"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { motion } from "framer-motion";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { BellRing, BriefcaseBusiness, CalendarCheck2, CheckSquare2, ClipboardList, FileClock, FolderTree, LayoutDashboard, LogOut, Menu, Settings, Shield, UserRoundSearch, Users, X } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { DashboardSidebarUser } from "@/lib/contracts/user";

const navItems = [
  { href: "/dashboard", icon: LayoutDashboard, label: "Dashboard" },
  { href: "/dashboard/plan", icon: ClipboardList, label: "Today's Task" },
  { href: "/dashboard/report", icon: FileClock, label: "Report" },
  { href: "/dashboard/attendance", icon: CalendarCheck2, label: "Attendance" },
  { href: "/dashboard/history", icon: BriefcaseBusiness, label: "History" },
  { href: "/dashboard/assignments", icon: CheckSquare2, label: "Assignments" },
  { href: "/dashboard/notices", icon: BellRing, label: "Notices" },
  { href: "/dashboard/directory", icon: UserRoundSearch, label: "Work Monitor" },
  { href: "/dashboard/team", icon: Users, label: "Team" },
  { href: "/admin", icon: Shield, label: "Admin" },
  { href: "/admin/departments", icon: FolderTree, label: "Departments" },
];

// Shared by the scrolling nav list and the pinned Settings row below it, so the
// two can never drift apart visually.
const navLinkClass =
  "sidebar-force-white flex items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-sm font-medium text-white transition-colors";
const navLinkActiveClass =
  "bg-[linear-gradient(135deg,#5667ff_0%,#4a59ea_100%)] text-[#f8fbff] shadow-[0_14px_24px_rgba(86,103,255,0.26)] sidebar-force-white";
const navLinkIdleClass = "hover:bg-white/12";

function SidebarContent({
  user,
  pathname,
  mobile = false,
  onNavigate,
}: {
  user: DashboardSidebarUser;
  pathname: string;
  mobile?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();

  async function logout() {
    onNavigate?.();
    const response = await fetch("/api/auth/logout", { method: "POST" });
    const result = await response.json();
    toast.success(result.message);
    router.push("/auth/login");
    router.refresh();
  }

  const settingsLink = (
    <motion.div transition={{ duration: 0.18, ease: "easeOut" }} whileHover={{ x: 4 }} whileTap={{ scale: 0.99 }}>
      <Link
        className={cn(navLinkClass, pathname === "/dashboard/settings" ? navLinkActiveClass : navLinkIdleClass)}
        href="/dashboard/settings"
        onClick={() => onNavigate?.()}
      >
        <Settings className="h-5 w-5" />
        <span>Settings</span>
      </Link>
    </motion.div>
  );

  const navNode = (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        className={cn(
          "flex shrink-0 items-center",
          // Desktop: full-bleed so the band's hairline runs edge to edge and joins
          // the header's; the inner padding still matches the nav rows exactly.
          mobile ? "px-2.5 py-2" : "dashboard-brandbar -mx-3 px-[1.375rem]",
        )}
      >
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#102b4f] text-[#35d39a]">
            <CheckSquare2 className="h-5 w-5" />
          </div>
          <p className="sidebar-force-white truncate text-base font-bold tracking-[-0.02em]">WorkLog Ultra</p>
        </div>
      </div>
      <motion.nav
        animate={{ opacity: 1, x: 0 }}
        // pr leaves room for the 4px hover slide, and overflow-x-hidden makes
        // sure a wider label can never turn this into a horizontal scrollbar.
        className="mt-4 min-h-0 flex-1 space-y-0.5 overflow-y-auto overflow-x-hidden pr-1.5"
        initial={{ opacity: 0, x: -18 }}
        transition={{ duration: 0.38, ease: "easeOut" }}
      >
        {navItems.map((item) => {
          const active = pathname === item.href;
          const Icon = item.icon;
          const hiddenForEmployee =
            item.href === "/admin" && !["manager", "admin"].includes(user.role);
          const hiddenDepartments =
            item.href === "/admin/departments" &&
            !["manager", "admin"].includes(user.role) &&
            !user.extraAccess?.includes("manage_departments");
          const hiddenForTeam = item.href === "/dashboard/team" && user.role === "employee" && !user.extraAccess?.includes("team_dashboard");
          const hiddenWorkMonitor =
            item.href === "/dashboard/directory" &&
            !["manager", "admin"].includes(user.role) &&
            !user.extraAccess?.includes("work_monitor");
          const hiddenForAdminWorkerFlow = false;
          const hiddenRequestInboxForAdmin = false;

          if (hiddenForEmployee || hiddenDepartments || hiddenForTeam || hiddenWorkMonitor || hiddenForAdminWorkerFlow || hiddenRequestInboxForAdmin) return null;

          const linkNode = (
            <motion.div
              key={item.href}
              transition={{ duration: 0.18, ease: "easeOut" }}
              whileHover={{ x: 4 }}
              whileTap={{ scale: 0.99 }}
            >
              <Link
                key={item.href}
                href={item.href}
                onClick={() => onNavigate?.()}
                className={cn(navLinkClass, active ? navLinkActiveClass : navLinkIdleClass)}
              >
                <Icon className="h-5 w-5" />
                <span>{item.label}</span>
                {item.href === "/dashboard/assignments" && (user.assignmentNotifications ?? 0) > 0 ? (
                  <span className="ml-auto inline-flex h-2.5 w-2.5 shrink-0 rounded-full bg-[#ff4d6d]" />
                ) : null}
              </Link>
            </motion.div>
          );

          if (mobile) {
            return (
              <Dialog.Close asChild key={item.href}>
                {linkNode}
              </Dialog.Close>
            );
          }

          return linkNode;
        })}
      </motion.nav>
      <div className={cn("mt-auto shrink-0 space-y-0.5 pt-2", mobile && "mb-4")}>
        {mobile ? <Dialog.Close asChild>{settingsLink}</Dialog.Close> : settingsLink}
        <button
          className="sidebar-force-white flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left text-sm font-semibold transition hover:bg-white/10"
          onClick={logout}
          type="button"
        >
          <LogOut className="h-5 w-5" />
          <span>Log Out</span>
        </button>
      </div>
    </div>
  );

  return navNode;
}

export function Sidebar({ user }: { user: DashboardSidebarUser }) {
  const pathname = usePathname();

  return (
    <motion.aside
      animate={{ opacity: 1, x: 0 }}
      className="sticky top-0 hidden h-screen w-[14.25rem] shrink-0 bg-[linear-gradient(160deg,#000080_0%,#001f66_55%,#020b31_100%)] px-3 pb-3 lg:flex lg:flex-col"
      initial={{ opacity: 0, x: -26 }}
      transition={{ duration: 0.42, ease: "easeOut" }}
    >
      <SidebarContent pathname={pathname} user={user} />
    </motion.aside>
  );
}

export function MobileSidebar({ user }: { user: DashboardSidebarUser }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <Dialog.Root onOpenChange={setOpen} open={open}>
      <Dialog.Trigger asChild>
        <Button
          aria-label="Open navigation menu"
          className="h-11 w-11 rounded-2xl bg-white text-slate-700 hover:bg-slate-50 lg:hidden"
          size="icon"
          variant="ghost"
        >
          <Menu className="h-5 w-5" />
        </Button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-40 bg-[rgba(3,8,18,0.72)] backdrop-blur-sm lg:hidden" />
        <Dialog.Content className="fixed inset-y-0 left-0 z-50 flex w-[85vw] max-w-[18.75rem] flex-col bg-[linear-gradient(160deg,#000080_0%,#001f66_55%,#020b31_100%)] p-3.5 shadow-[0_30px_90px_rgba(3,8,18,0.45)] outline-none lg:hidden">
          <div className="mb-3 flex shrink-0 items-center justify-between">
            <Dialog.Title className="text-sm font-semibold uppercase tracking-[0.24em] text-white">
              WorkLog Ultra
            </Dialog.Title>
            <Dialog.Close asChild>
              <Button
                aria-label="Close navigation menu"
                className="h-11 w-11 rounded-2xl border border-white/35 bg-white/8 !text-white hover:bg-white/14 hover:!text-white"
                size="icon"
                variant="ghost"
              >
                <X className="h-5 w-5 !text-white" />
              </Button>
            </Dialog.Close>
          </div>
          <SidebarContent mobile onNavigate={() => setOpen(false)} pathname={pathname} user={user} />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
