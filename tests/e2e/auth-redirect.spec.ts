import { test, expect } from "@playwright/test";

test("unauthenticated visitor is redirected from /dashboard to /login", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login$/);
});

test("unauthenticated visitor is redirected from /parametres to /login", async ({
  page,
}) => {
  await page.goto("/parametres");
  await expect(page).toHaveURL(/\/login$/);
});
