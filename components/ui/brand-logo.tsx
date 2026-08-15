import Image from "next/image";
import { cn } from "@/lib/utils";

/** Intrinsic size of public/logo.png — the designer's file, used untouched. */
const LOGO_WIDTH = 1485;
const LOGO_HEIGHT = 390;
const LOGO_RATIO = LOGO_WIDTH / LOGO_HEIGHT;

/**
 * The full Akribis lockup — mark plus "akribis Pharma".
 *
 * Rendered from the supplied PNG exactly as delivered: no recolouring, no
 * resampling, no CSS filters. The wordmark is black, so on a dark surface
 * it would otherwise disappear; rather than alter the artwork, dark mode
 * sets it on a light plate (`plate`), which is how a single-version logo
 * is normally handled.
 *
 * `unoptimized` on purpose. Next's optimiser would serve it from
 * `/_next/image?url=...`, a path the service worker does not recognise as
 * a static asset (no file extension), so the logo would be missing from
 * every offline page. Served directly, it is cached like any other image —
 * and precached by name in public/sw.js.
 */
export function BrandLogo({
  height = 32,
  plate = true,
  className,
  priority = false,
}: {
  /** Rendered height in pixels; width follows the artwork's ratio. */
  height?: number;
  /** Light backing in dark mode. Turn off on surfaces already light. */
  plate?: boolean;
  className?: string;
  priority?: boolean;
}) {
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center",
        plate && "dark:rounded-lg dark:bg-white dark:px-sp-sm dark:py-sp-xs",
        className,
      )}
    >
      <Image
        src="/logo.png"
        alt="Akribis Pharma"
        width={Math.round(height * LOGO_RATIO)}
        height={height}
        style={{ height, width: "auto" }}
        priority={priority}
        unoptimized
      />
    </span>
  );
}
