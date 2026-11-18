import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Lets a verification build write somewhere other than `.next`:
   *
   *   NEXT_DIST_DIR=.next-verify npx next build
   *
   * Without this, `next build` run while `next dev` is up replaces the
   * directory the dev server is serving from, and every request then fails
   * with ENOENT on a page that was there a second ago. Next has no such
   * environment variable of its own — the name only exists because this
   * line gives it meaning. Unset (Vercel, `next start`) it stays `.next`.
   */
  distDir: process.env.NEXT_DIST_DIR || ".next",
  experimental: {
    serverActions: {
      // The catalogue import uploads a whole referential: the CNOPS 2014
      // workbook alone is 467 KB, and it is sent twice (analysis, then
      // confirmation). The 1 MB default leaves no room for a larger one.
      bodySizeLimit: "16mb",
    },
  },
};

export default nextConfig;
