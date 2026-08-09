/**
 * Deliberately its own module with no "use client" directive: the
 * dashboard layout (a Server Component) reads this cookie name to render
 * the sidebar at its persisted width on first paint. Exporting it from
 * dashboard-sidebar.tsx instead would silently break — Next replaces
 * exports of a "use client" module with client references when a Server
 * Component imports them, so the name would arrive as a proxy rather
 * than the string and every lookup would miss.
 */
export const SIDEBAR_COLLAPSED_COOKIE = "akribis-sidebar-collapsed";
