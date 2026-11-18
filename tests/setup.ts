import { vi } from "vitest";

// Adds toBeInTheDocument() and friends to expect(), for the component
// tests under tests/admin.
import "@testing-library/jest-dom/vitest";

// The real package throws when it detects it's not running in a Server
// Component context, which includes Vitest's jsdom test environment.
// Files under lib/auth and lib/supabase import it as a safeguard against
// client bundling — harmless to no-op here.
vi.mock("server-only", () => ({}));

// jsdom doesn't implement IndexedDB, so Dexie (lib/offline/db.ts) needs
// this polyfill to run in tests at all.
import "fake-indexeddb/auto";
