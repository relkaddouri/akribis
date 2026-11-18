import { cookies } from "next/headers";
import { requireAdmin } from "@/lib/auth/session";
import { QueryProvider } from "@/components/providers/query-provider";
import { DashboardUserProvider } from "@/components/providers/dashboard-user-provider";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AdminSidebar } from "@/components/features/admin/admin-sidebar";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/components/features/dashboard/sidebar-cookie";

/**
 * The Akribis back-office shell.
 *
 * The pages sit at `app/(admin)/admin/...`, not `app/(admin)/...`: a route
 * group contributes nothing to the URL, so the latter would have served
 * the catalogue at `/catalogue` — a path with no hint that it is staff
 * only, outside the `/admin` prefix the middleware guards, and one the
 * pharmacy side will want for browsing the catalogue itself in phase 2.
 * The group still earns its keep: it is what gives these pages this
 * layout instead of the pharmacy one.
 *
 * Structurally a copy of the pharmacy shell — same gutters, same scroll
 * model, same sidebar card — minus OfflineProvider and the offline
 * banner. Akribis staff work from an office on the national catalogue:
 * there is no counter to keep serving when the network drops, and an
 * offline write queue keyed by pharmacy has nothing to key on here.
 *
 * `requireAdmin()` is the second of three gates. The middleware turns
 * pharmacists away before this layout runs, and each server action checks
 * again on its own — a POST never passes through a layout.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const admin = await requireAdmin();

  // Read server-side so the sidebar renders at its persisted width on the
  // very first paint — reading this after hydration instead would flash
  // the expanded sidebar on every load for users who collapsed it.
  const cookieStore = await cookies();
  const collapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";

  return (
    <QueryProvider>
      <DashboardUserProvider user={{ name: admin.name, email: admin.email, role: admin.role }}>
        {/* On the pharmacy side this provider lives inside the sidebar.
            Here it wraps the whole shell, because the page content uses
            tooltips too and the back-office has no equivalent of the
            sidebar to inherit one from. */}
        <TooltipProvider delayDuration={200}>
          {/* `overflow-hidden` on the shell so the page itself never
              scrolls: the sidebar is a fixed-height column and <main> is
              the only scroll port. Padding lives on the inner wrapper, not
              on <main>, so the header can stick flush to the top of the
              scroll port and still bleed edge to edge. */}
          <div className="flex h-svh overflow-hidden print:block print:h-auto print:overflow-visible">
            {/* Gutter around the sidebar so it reads as a floating card,
                like the header. `py-sp-lg pl-sp-lg` puts its top edge at
                the same 24px as the header's card, and <main>'s own
                `px-sp-lg` supplies the 24px between the two. */}
            <div className="flex py-sp-lg pl-sp-lg print:hidden">
              <AdminSidebar defaultCollapsed={collapsed} />
            </div>
            <main className="relative flex-1 overflow-y-auto bg-background print:overflow-visible">
              <div className="px-sp-lg pb-sp-lg">{children}</div>
            </main>
          </div>
        </TooltipProvider>
      </DashboardUserProvider>
    </QueryProvider>
  );
}
