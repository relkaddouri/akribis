import { describe, expect, it } from "vitest";
import { cn } from "@/lib/utils";

describe("sanity", () => {
  it("merges class names via cn()", () => {
    expect(cn("p-2", "text-sm")).toBe("p-2 text-sm");
  });
});
