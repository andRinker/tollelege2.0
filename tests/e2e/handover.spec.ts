import { expect, test } from "@playwright/test";
import { createClassWithStudents, rapidAdd, signUp } from "./helpers";

/**
 * A hand-over only goes to a verified account, which only Google sign-in gives, so the suite
 * can't complete one; `tests/integration/handover.test.ts` covers the move itself. What this
 * proves end to end is the form, and that an account which merely has the address can't be
 * handed a class full of student names.
 */
test("a hand-over is refused to an account that hasn't proven its address", async ({ browser, page }) => {
  const baseURL = test.info().project.use.baseURL;
  const other = await browser.newContext({ baseURL, timezoneId: "America/Chicago" });
  const otherEmail = await signUp(await other.newPage(), "Dana Brooks");
  await other.close();

  await signUp(page, "Maria Alvarez");
  await createClassWithStudents(page, "Room 12", ["Ada Lovelace"]);
  await rapidAdd(page, ["9780545010221"]);

  await page.goto("/settings");
  await page.getByRole("link", { name: "Hand over classes or books" }).click();
  await page.waitForURL("**/settings/hand-over");

  await page.getByRole("button", { name: "Offer to hand over" }).click();
  await expect(page.getByRole("textbox", { name: "Their school email" })).toBeFocused();

  await page.getByRole("textbox", { name: "Their school email" }).fill(otherEmail);
  await page.getByRole("button", { name: "Offer to hand over" }).click();
  await expect(page.getByText("Choose at least one class or book to hand over.")).toBeVisible();

  await page.locator("label").filter({ hasText: "Room 12" }).click();
  await page.locator("label").filter({ hasText: "All of them (1)" }).click();
  await expect(page.getByText("1 class and 1 book")).toBeVisible();
  await page.getByRole("button", { name: "Offer to hand over" }).click();
  await expect(page.getByText(/Ask them to sign in with Google first/)).toBeVisible();
  await expect(page.getByText(/^Waiting for/)).toHaveCount(0);
});
