"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

export function QueryProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            // Most queries in this app (products, sales) read from the
            // local Dexie cache, not the network — TanStack Query's
            // default `networkMode: "online"` would otherwise pause
            // them whenever `navigator.onLine` is false, even though
            // they don't need connectivity at all.
            networkMode: "always",
          },
          mutations: {
            networkMode: "always",
          },
        },
      }),
  );

  return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
}
