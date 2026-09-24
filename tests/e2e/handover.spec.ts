import { expect, test } from "@playwright/test";
import { createClassWithStudents, rapidAdd, signUp } from "./helpers";

/**
 * A hand-over only goes to a verified account, which only Google sign-in gives, so the suite
 * can't complete one; `tests/integration/handover.test.ts` covers the move itself. What this
 * proves end to end is the form, and that an account which merely has the address is never
 * shown a class full of student names: the offer waits on the email instead.
 */
test("a hand-over waits on the email rather than go to an account that hasn't proven it", async ({ browser, page }) => {
  const baseURL = test.info().project.use.baseURL;
  const other = await browser.newContext({ baseURL, timezoneId: "America/Chicago" });
  const otherPage = await other.newPage();
  const otherEmail = await signUp(otherPage, "Dana Brooks");

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
  await expect(page.getByRole("heading", { name: `Waiting for ${otherEmail}` })).toBeVisible();
  await expect(page.getByText(/They haven't signed in yet/)).toBeVisible();

  await test.step("the account with the address, unproven, sees nothing", async () => {
    await otherPage.goto("/dashboard");
    await expect(otherPage.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(otherPage.getByText(/wants to hand you/)).toHaveCount(0);
    await expect(otherPage.getByRole("button", { name: "Accept" })).toHaveCount(0);
  });

  await test.step("and the sender can withdraw it", async () => {
    await page.getByRole("button", { name: "Withdraw the offer" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Withdraw" }).click();
    await expect(page.getByRole("heading", { name: "Who's taking over" })).toBeVisible();
  });
  await other.close();
});
