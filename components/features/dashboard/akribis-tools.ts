import { FlaskConical, Sparkles, Stethoscope, Layers, type LucideIcon } from "lucide-react";
import type { OutilAkribisValue } from "@/lib/news/publications";

/**
 * Presentation for the Akribis companion products, shared by the sidebar's
 * "Outils" section and the actualités feed's Suite-announcement badges so
 * a tool always reads with the same icon and colour in both places.
 *
 * These colours are the one deliberate exception to the emerald-only
 * accent rule in lib/design-tokens.ts: each tool is colour-coded so it
 * reads as a separate product rather than as app navigation.
 */
export type AkribisTool = {
  label: string;
  icon: LucideIcon;
  /** Icon tint. */
  iconClass: string;
  /** Background + foreground for the small circle/badge carrying the icon. */
  circleClass: string;
};

export const AKRIBIS_TOOLS: Record<OutilAkribisValue, AkribisTool> = {
  intelligence: {
    label: "Akribis Intelligence",
    icon: Sparkles,
    iconClass: "text-violet-600 dark:text-violet-400",
    circleClass: "bg-violet-100 text-violet-700 dark:bg-violet-950 dark:text-violet-300",
  },
  labo: {
    label: "Akribis Labo",
    icon: FlaskConical,
    iconClass: "text-sky-600 dark:text-sky-400",
    circleClass: "bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  },
  medical: {
    label: "Akribis Medical",
    icon: Stethoscope,
    iconClass: "text-rose-600 dark:text-rose-400",
    circleClass: "bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300",
  },
  suite: {
    label: "Akribis Suite",
    icon: Layers,
    iconClass: "text-emerald-600 dark:text-emerald-400",
    circleClass: "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  },
};

/** The three tools listed in the sidebar, in display order (Suite is the umbrella brand, not a nav item). */
export const SIDEBAR_TOOL_ORDER: OutilAkribisValue[] = ["intelligence", "labo", "medical"];
