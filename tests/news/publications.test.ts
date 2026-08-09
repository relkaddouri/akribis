import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  countUnread,
  filterPublications,
  formatRelativeDate,
  type PublicationItem,
} from "@/lib/news/publications";

/**
 * In-memory Prisma fake for the read-state flow, same approach as
 * tests/orders/receive-order.test.ts: the real server facade runs, only
 * Postgres is swapped out. This is what makes the badge test meaningful —
 * it exercises markPublicationsRead → getUnreadPublicationCount for real,
 * including the "already read" idempotency path.
 */
const state = vi.hoisted(() => ({
  publications: [] as Array<{ id: string }>,
  lectures: [] as Array<{ userId: string; publicationId: string }>,
}));

vi.mock("@/lib/db/client", () => ({
  prisma: {
    publication: {
      count: vi.fn(async ({ where }: { where: { lectures: { none: { userId: string } } } }) => {
        const userId = where.lectures.none.userId;
        return state.publications.filter(
          (p) => !state.lectures.some((l) => l.userId === userId && l.publicationId === p.id),
        ).length;
      }),
    },
    publicationLecture: {
      createMany: vi.fn(
        async ({
          data,
          skipDuplicates,
        }: {
          data: Array<{ userId: string; publicationId: string }>;
          skipDuplicates?: boolean;
        }) => {
          for (const row of data) {
            const exists = state.lectures.some(
              (l) => l.userId === row.userId && l.publicationId === row.publicationId,
            );
            if (exists) {
              // Mirrors the real unique (user, publication) index: without
              // skipDuplicates Postgres would reject the whole statement.
              if (!skipDuplicates) throw new Error("Unique constraint failed");
              continue;
            }
            state.lectures.push(row);
          }
        },
      ),
    },
  },
}));

vi.mock("@/lib/auth/session", () => ({
  requireUser: vi.fn(async () => ({
    id: "user-1",
    email: "owner@akribis.test",
    name: "Titulaire",
    role: "owner",
    pharmacyId: "pharmacy-1",
  })),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { getUnreadPublicationCount, markPublicationsRead } = await import(
  "@/lib/server/publications"
);

function publication(overrides: Partial<PublicationItem> = {}): PublicationItem {
  return {
    id: "pub-1",
    titre: "Titre",
    contenu: "Contenu",
    type: "nouveaute",
    niveauUrgence: null,
    outilAssocie: null,
    imageUrl: null,
    datePublication: new Date("2026-08-01T10:00:00Z"),
    auteur: "Équipe Akribis",
    lu: false,
    ...overrides,
  };
}

beforeEach(() => {
  state.publications = [{ id: "pub-1" }, { id: "pub-2" }, { id: "pub-3" }];
  state.lectures = [];
});

describe("unread badge count", () => {
  it("drops by one when a publication goes from unread to read", async () => {
    expect(await getUnreadPublicationCount()).toBe(3);

    await markPublicationsRead(["pub-2"]);

    expect(await getUnreadPublicationCount()).toBe(2);
  });

  it("reaches zero once every publication has been read", async () => {
    await markPublicationsRead(["pub-1", "pub-2", "pub-3"]);

    expect(await getUnreadPublicationCount()).toBe(0);
  });

  it("does not double-count when the same publication is marked read twice", async () => {
    // Cards mark themselves read on scroll-into-view, so the same id can
    // legitimately be submitted again — the count must not drift.
    await markPublicationsRead(["pub-1"]);
    await markPublicationsRead(["pub-1"]);

    expect(await getUnreadPublicationCount()).toBe(2);
    expect(state.lectures).toHaveLength(1);
  });

  it("keeps read-state per user — another user's read doesn't clear this one's badge", async () => {
    state.lectures.push({ userId: "user-2", publicationId: "pub-1" });

    expect(await getUnreadPublicationCount()).toBe(3);
  });

  it("writes nothing when handed an empty list", async () => {
    await markPublicationsRead([]);

    expect(state.lectures).toHaveLength(0);
    expect(await getUnreadPublicationCount()).toBe(3);
  });
});

describe("countUnread", () => {
  it("counts only the publications not yet read", () => {
    expect(
      countUnread([publication({ lu: false }), publication({ lu: true }), publication({ lu: false })]),
    ).toBe(2);
  });
});

describe("category filter", () => {
  const feed: PublicationItem[] = [
    publication({ id: "n1", type: "nouveaute", datePublication: new Date("2026-08-05T10:00:00Z") }),
    publication({ id: "a1", type: "alerte", datePublication: new Date("2026-08-04T10:00:00Z") }),
    publication({ id: "m1", type: "maintenance", datePublication: new Date("2026-08-03T10:00:00Z") }),
    publication({ id: "s1", type: "annonce_suite", datePublication: new Date("2026-08-02T10:00:00Z") }),
    publication({ id: "n2", type: "nouveaute", datePublication: new Date("2026-08-01T10:00:00Z") }),
  ];

  it("shows every publication under the 'Tous' tab", () => {
    expect(filterPublications(feed, "tous").map((p) => p.id)).toEqual([
      "n1",
      "a1",
      "m1",
      "s1",
      "n2",
    ]);
  });

  it("shows only Nouveautés when that category is selected", () => {
    const result = filterPublications(feed, "nouveaute");

    expect(result.map((p) => p.id)).toEqual(["n1", "n2"]);
    expect(result.every((p) => p.type === "nouveaute")).toBe(true);
  });

  it("shows only Alertes when that category is selected", () => {
    expect(filterPublications(feed, "alerte").map((p) => p.id)).toEqual(["a1"]);
  });

  it("shows only Maintenance when that category is selected", () => {
    expect(filterPublications(feed, "maintenance").map((p) => p.id)).toEqual(["m1"]);
  });

  it("shows only Akribis Suite announcements when that category is selected", () => {
    expect(filterPublications(feed, "annonce_suite").map((p) => p.id)).toEqual(["s1"]);
  });

  it("returns an empty list rather than falling back to everything when nothing matches", () => {
    const onlyNews = [publication({ id: "n1", type: "nouveaute" })];

    expect(filterPublications(onlyNews, "maintenance")).toEqual([]);
  });

  it("orders results newest first, whatever the input order", () => {
    const shuffled = [feed[4]!, feed[0]!, feed[2]!];

    expect(filterPublications(shuffled, "tous").map((p) => p.id)).toEqual(["n1", "m1", "n2"]);
  });

  it("does not mutate the array it was given", () => {
    const input = [feed[4]!, feed[0]!];
    filterPublications(input, "tous");

    expect(input.map((p) => p.id)).toEqual(["n2", "n1"]);
  });
});

describe("formatRelativeDate", () => {
  const now = new Date("2026-08-09T12:00:00Z");

  it.each([
    [new Date("2026-08-09T11:59:30Z"), "À l'instant"],
    [new Date("2026-08-09T11:45:00Z"), "Il y a 15 minutes"],
    [new Date("2026-08-09T11:00:00Z"), "Il y a 1 heure"],
    [new Date("2026-08-09T09:00:00Z"), "Il y a 3 heures"],
    [new Date("2026-08-08T12:00:00Z"), "Il y a 1 jour"],
    [new Date("2026-08-04T12:00:00Z"), "Il y a 5 jours"],
    [new Date("2026-06-09T12:00:00Z"), "Il y a 2 mois"],
    [new Date("2024-08-09T12:00:00Z"), "Il y a 2 ans"],
  ])("formats %s as %s", (date, expected) => {
    expect(formatRelativeDate(date, now)).toBe(expected);
  });
});
