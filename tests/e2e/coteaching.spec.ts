import { expect, test } from "@playwright/test";
import { createClassWithStudents, firstHref, settledSnackbar, signUp } from "./helpers";

/**
 * A co-teacher is only ever granted on a verified email, which only Google sign-in gives,
 * so the suite can't sign in as one; `tests/integration/coteaching.test.ts` covers what a
 * co-teacher sees and can do. What this proves end to end is the half that guards the
 * door: an owner can invite someone, and an account that merely has the address, without
 * having proven it, gets an invitation and nothing else.
 */
test("inviting a co-teacher grants nothing to an address that hasn't been proven", async ({ browser, page }) => {
  const baseURL = test.info().project.use.baseURL;
  const other = await browser.newContext({ baseURL, timezoneId: "America/Chicago" });
  const otherPage = await other.newPage();
  const otherEmail = await signUp(otherPage, "Dana Brooks");

  await signUp(page, "Maria Alvarez");
  await createClassWithStudents(page, "Room 12", ["Ada Lovelace"]);
  const classUrl = new URL(page.url()).pathname;
  const studentHref = await firstHref(page, /^\/students\/[0-9a-f-]{36}$/);

  await test.step("the owner invites them from the class page", async () => {
    await expect(page.getByText("Only you teach this class.")).toBeVisible();
    await page.getByRole("button", { name: "Add a co-teacher" }).click();
    await page.getByRole("dialog").getByRole("textbox", { name: "Their school email" }).fill(otherEmail.toUpperCase());
    await page.getByRole("dialog").getByRole("button", { name: "Add" }).click();
    await settledSnackbar(page, `Invited ${otherEmail}. They'll get access the first time they sign in with Google.`);
    await expect(page.getByRole("list", { name: "Co-teachers" }).getByText(otherEmail)).toBeVisible();
  });

  await test.step("the unverified account gets no way in", async () => {
    await otherPage.goto("/dashboard");
    await expect(otherPage.getByRole("button", { name: /classroom/i })).toHaveCount(0);
    await otherPage.goto("/classes");
    await expect(otherPage.getByText("No classes yet")).toBeVisible();
    for (const href of [classUrl, studentHref]) {
      expect((await otherPage.goto(href))?.status(), href).toBe(404);
    }
  });

  await test.step("the owner can cancel the invitation", async () => {
    await page.getByRole("button", { name: `Cancel the invitation to ${otherEmail}` }).click();
    await settledSnackbar(page, `Cancelled the invitation to ${otherEmail}`);
    await expect(page.getByText("Only you teach this class.")).toBeVisible();
  });

  await other.close();
});
