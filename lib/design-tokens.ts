/**
 * Base design tokens for Akribis' "modern medical SaaS" look — a
 * programmatic mirror of the CSS custom properties defined in
 * app/globals.css, for the rare cases that need a raw value in JS
 * rather than a Tailwind class (e.g. inline chart colors). Component
 * styling itself should use the Tailwind utilities (`bg-primary`,
 * `text-foreground`, `rounded-xl`, `shadow-card`, ...), which read from
 * the same CSS variables — keep both in sync if either changes.
 */

/**
 * Sourced directly from public/logo.svg and public/icon.svg (the Akribis
 * mark) rather than a hand-picked approximation: DEFAULT and light were
 * already exact matches to the logo's mid and light facets; dark has
 * been corrected to the logo's actual dark facet (was emerald-600,
 * which doesn't appear in the logo at all).
 */
export const colors = {
  primary: {
    /** emerald-500 — logo's mid-tone facet */
    DEFAULT: "#10B981",
    /** emerald-400 — logo's light facets */
    light: "#34D399",
    /** emerald-700 — logo's dark facet; darker shade for active/pressed states */
    dark: "#047857",
  },
  /**
   * Reserved for distinguishing a second data series in charts — not a
   * general-purpose UI accent. Buttons, links and highlights stay
   * emerald; only a second chart series (or similar "this is the other
   * one" signal) should reach for this.
   */
  accent: {
    /** orange-400 */
    DEFAULT: "#FB923C",
  },
  neutral: {
    /** gray-50 — page background */
    background: "#F9FAFB",
    /** pure white — card surfaces */
    card: "#FFFFFF",
    /** gray-900 — primary text */
    foreground: "#111827",
    /** gray-500 — secondary/muted text */
    muted: "#6B7280",
    /** gray-200 — hairline borders; kept light on purpose, elevation comes from shadow, not border weight */
    border: "#E5E7EB",
  },
  destructive: "#DC2626",
} as const;

/** Bar/line colors for multi-series charts, in priority order. */
export const chartColors = [
  colors.primary.DEFAULT,
  colors.accent.DEFAULT,
  colors.primary.light,
  colors.neutral.muted,
  colors.primary.dark,
] as const;

export const radius = {
  sm: "0.5rem",
  md: "0.6875rem",
  lg: "0.875rem",
  xl: "1.225rem",
  "2xl": "1.575rem",
} as const;

/**
 * The app's spacing scale — six deliberately coarse steps. Every gap,
 * padding and margin in layout code picks one of these, which is what
 * keeps vertical and horizontal rhythm consistent from screen to screen.
 *
 * In markup use the Tailwind names generated from the matching
 * `--spacing-sp-*` custom properties in app/globals.css: `gap-sp-md`,
 * `px-sp-lg`, `space-y-sp-lg`, `mb-sp-xl`, ... Reach for this object only
 * when a raw value is genuinely needed in JS (inline styles, charts).
 *
 * Rules of thumb for picking a step:
 *   xs   icon-to-label, tightest pairing inside a control
 *   sm   related controls inside a single group
 *   md   between groups on a row (header zones, button rows)
 *   lg   page padding, and between blocks within a page
 *   xl   between major page sections
 *   2xl  hero / empty-state breathing room
 *
 * Why the `sp-` prefix: Tailwind v4 resolves `max-w-*` and `w-*` against
 * both `--container-*` and `--spacing-*`, and spacing wins. Registering
 * these as plain `--spacing-md` silently redefined `max-w-md` from 28rem
 * to 16px (`max-w-xs` to 4px, `max-w-2xl` to 48px), collapsing the POS
 * column, table search inputs and tooltips. Declaring `--container-*`
 * explicitly does not win precedence back, so the prefix is the fix —
 * don't remove it.
 *
 * Tailwind's numeric steps (`p-4`, `gap-2`) still resolve, but new code
 * should use these names — they're what stops the half-steps (`gap-2.5`,
 * `px-1.5`) that caused the header/sidebar drift from creeping back in.
 * Keep in sync with the `--spacing-sp-*` block in app/globals.css.
 */
export const spacing = {
  /** 4px — `gap-sp-xs` */
  xs: "4px",
  /** 8px — `gap-sp-sm` */
  sm: "8px",
  /** 16px — `gap-sp-md` */
  md: "16px",
  /** 24px — `gap-sp-lg` */
  lg: "24px",
  /** 32px — `gap-sp-xl` */
  xl: "32px",
  /** 48px — `gap-sp-2xl` */
  "2xl": "48px",
} as const;

/** Soft, low-opacity elevation — no hard-edged borders. */
export const shadow = {
  soft: "0 1px 2px 0 rgb(0 0 0 / 0.04), 0 1px 3px 0 rgb(0 0 0 / 0.06)",
  card: "0 1px 2px 0 rgb(0 0 0 / 0.03), 0 8px 24px -8px rgb(0 0 0 / 0.08)",
} as const;

/**
 * Two-font system: Manrope for every heading, Inter for everything else
 * (body copy, tables, forms, descriptions — anywhere legibility in long
 * stretches matters more than visual punch). Both are loaded as
 * variable fonts via next/font/google in app/layout.tsx.
 *
 * Weight scale for headings — apply consistently everywhere a new h1/h2/h3
 * (or a component-level "title" standing in for one, e.g. CardTitle)
 * is introduced. app/globals.css's `@layer base` already applies this
 * automatically to real h1/h2/h3 elements; anything else opts in with
 * `font-heading` + the matching weight class below.
 *   h1 → font-extrabold (800)
 *   h2 → font-bold      (700)
 *   h3 → font-semibold  (600)
 * Body text stays at Inter's regular weight (400) — avoid bumping body
 * copy to medium/semibold outside of deliberate emphasis.
 */
export const font = {
  /** Manrope */
  heading: "var(--font-heading)",
  /** Inter — same value `font-sans` resolves to */
  sans: "var(--font-sans)",
  weights: {
    h1: 800,
    h2: 700,
    h3: 600,
    body: 400,
  },
} as const;
