import AxeBuilder from "@axe-core/playwright";
import { expect, type Page, test } from "@playwright/test";
import { createClassWithStudents, firstHref, rapidAdd, signUp, snackbar } from "./helpers";

async function expectNoSeriousViolations(page: Page, name: string) {
  const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const serious = results.violations
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => `${violation.id} (${violation.impact}): ${violation.help}\n  ${violation.nodes.map((node) => node.target.join(" ")).slice(0, 5).join("\n  ")}`);
  // Soft, so one run reports every screen with problems.
  expect.soft(serious, `${name} accessibility violations`).toEqual([]);
}

test("public pages have no serious accessibility violations", async ({ page }) => {
  for (const path of ["/sign-in", "/sign-up", "/forgot-password", "/privacy"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoSeriousViolations(page, path);
  }
});

test("app screens have no serious accessibility violations", async ({ page }) => {
  await signUp(page, "Casey Morgan");
  await page.goto("/dashboard");
  await expectNoSeriousViolations(page, "empty dashboard");

  await createClassWithStudents(page, "Room 3", ["Lena Cho", "Omar Haddad"]);
  const classPath = new URL(page.url()).pathname;
  const studentPath = await firstHref(page, /^\/students\/[0-9a-f-]{36}$/);
  await rapidAdd(page, ["9780064440202", "9780062315007"]);
  await page.goto("/library");
  const bookPath = await firstHref(page, /^\/library\/[0-9a-f-]{36}$/);

  await page.goto("/checkout");
  await page.getByRole("button", { name: /Lena Cho/ }).click();
  const isbn = page.getByRole("textbox", { name: "Scan or type the book's ISBN" });
  await isbn.fill("9780064440202");
  await isbn.press("Enter");
  await expect(snackbar(page, /checked out to Lena/)).toBeVisible();
  await expectNoSeriousViolations(page, "checkout with a session");

  for (const path of ["/dashboard", "/library", bookPath, "/library/add", "/classes", classPath, studentPath, "/checkout", "/checkin", "/settings"]) {
    await page.goto(path);
    await page.waitForLoadState("networkidle");
    await expectNoSeriousViolations(page, path);
  }
});
