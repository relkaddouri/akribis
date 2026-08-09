import { Rss } from "lucide-react";
import { listPublications } from "@/lib/server/publications";
import { getTodayGlance } from "@/lib/server/today";
import { DashboardHeader } from "@/components/features/dashboard/dashboard-header";
import { NewsFeed } from "@/components/features/news/news-feed";
import { TodayGlance } from "@/components/features/news/today-glance";

/**
 * Read-only for both owner and assistant — there is deliberately no
 * authoring UI here. Publishing is an admin_akribis concern handled
 * outside this app.
 */
export default async function ActualitesPage() {
  // requireUser() runs inside both facades, so the page is gated the same
  // way as the rest of the dashboard.
  const [publications, glance] = await Promise.all([listPublications(), getTodayGlance()]);

  return (
    <div className="space-y-sp-lg">
      <DashboardHeader title="Akribis actualités" icon={<Rss />} />

      {/* 70/30 split on large screens; single column below, with the feed
          first so the glance panel doesn't push it off the fold.
          `items-start` matters: grid items stretch by default, and a
          full-height item can't move within its track, which silently
          disables `sticky` on the glance column. */}
      <div className="grid grid-cols-1 items-start gap-sp-lg lg:grid-cols-[7fr_3fr]">
        <NewsFeed publications={publications} />
        {/* Pinned just under the sticky header while the feed scrolls past.
            Capped to the remaining viewport height with its own scroll, so
            a short screen can still reach the bottom of the panel. Only
            from `lg` up — stacked below the feed on narrow screens, where
            sticking it would eat most of the viewport. */}
        <aside className="lg:sticky lg:top-(--dashboard-header-offset) lg:max-h-[calc(100svh-var(--dashboard-header-offset))] lg:overflow-y-auto">
          <TodayGlance glance={glance} />
        </aside>
      </div>
    </div>
  );
}
