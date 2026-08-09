import { cookies } from "next/headers";
import { requireUser } from "@/lib/auth/session";
import { QueryProvider } from "@/components/providers/query-provider";
import { OfflineProvider } from "@/components/providers/offline-provider";
import { DashboardUserProvider } from "@/components/providers/dashboard-user-provider";
import { DashboardSidebar } from "@/components/features/dashboard/dashboard-sidebar";
import { SIDEBAR_COLLAPSED_COOKIE } from "@/components/features/dashboard/sidebar-cookie";
import { getUnreadPublicationCount } from "@/lib/server/publications";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  // Read server-side so the sidebar renders at its persisted width on the
  // very first paint — reading this after hydration instead would flash
  // the expanded sidebar on every load for users who collapsed it.
  const cookieStore = await cookies();
  const collapsed = cookieStore.get(SIDEBAR_COLLAPSED_COOKIE)?.value === "1";
  const unreadNewsCount = await getUnreadPublicationCount();

  return (
    <OfflineProvider pharmacyId={user.pharmacyId} userId={user.id}>
      <DashboardUserProvider user={{ name: user.name, email: user.email, role: user.role }}>
        {/* `overflow-hidden` on the shell so the page itself never scrolls:
            the sidebar is a fixed-height column and <main> is the only
            scroll port. Padding lives on the inner wrapper, not on <main>,
            so DashboardHeader can stick flush to the top of the scroll
            port and still bleed edge to edge. <main> is `relative` so it
            acts as the containing block for absolutely positioned
            descendants (Tailwind's `sr-only` among them): without it they
            resolve against the document, escape the scroll port's
            clipping, and stretch the page so the whole shell scrolls. */}
        <div className="flex h-svh overflow-hidden">
          <DashboardSidebar
            role={user.role}
            defaultCollapsed={collapsed}
            unreadNewsCount={unreadNewsCount}
          />
          <main className="relative flex-1 overflow-y-auto bg-background">
            <div className="px-sp-lg pb-sp-lg">
              <QueryProvider>{children}</QueryProvider>
            </div>
          </main>
        </div>
      </DashboardUserProvider>
    </OfflineProvider>
  );
}
