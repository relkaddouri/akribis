import { cn } from "@/lib/utils";

/**
 * Emerald/neutral tint pairs only — orange is reserved for the second
 * chart series (see lib/design-tokens.ts) and must never appear as a
 * general UI accent like this.
 */
const PALETTE = [
  "bg-emerald-100 text-emerald-700",
  "bg-gray-200 text-gray-700",
  "bg-emerald-200 text-emerald-800",
  "bg-gray-100 text-gray-600",
  "bg-emerald-50 text-emerald-600",
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash << 5) - hash + value.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

function getInitials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return words[0]!.slice(0, 2).toUpperCase();
  return (words[0]![0]! + words[1]![0]!).toUpperCase();
}

export function AvatarBadge({ name, className }: { name: string; className?: string }) {
  const palette = PALETTE[hashString(name) % PALETTE.length];

  return (
    <span
      className={cn(
        "flex size-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
        palette,
        className,
      )}
      aria-hidden
    >
      {getInitials(name)}
    </span>
  );
}
