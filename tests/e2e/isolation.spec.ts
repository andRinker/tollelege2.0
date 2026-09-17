import { expect, test } from "@playwright/test";
import { createClassWithStudents, firstHref, rapidAdd, signUp } from "./helpers";

test("a second teacher sees none of the first teacher's library, classes, or students", async ({ browser, page }) => {
  await signUp(page, "Avery Stone");
  await createClassWithStudents(page, "Room 7", ["Nia Park"]);
  const studentHref = await firstHref(page, /^\/students\/[0-9a-f-]{36}$/);
  const classUrl = new URL(page.url()).pathname;
  await rapidAdd(page, ["9780545010221"]);
  await page.goto("/library");
  const bookHref = await firstHref(page, /^\/library\/[0-9a-f-]{36}$/);

  const other = await browser.newContext({ baseURL: test.info().project.use.baseURL, timezoneId: "America/Chicago" });
  const otherPage = await other.newPage();
  await signUp(otherPage, "Blake Rivers");

  await otherPage.goto("/library");
  await expect(otherPage.getByText("Your library is empty")).toBeVisible();
  await otherPage.goto("/classes");
  await expect(otherPage.getByText("No classes yet")).toBeVisible();
  await otherPage.goto("/checkin");
  await expect(otherPage.getByText("Everything's on the shelf")).toBeVisible();

  for (const href of [bookHref, classUrl, studentHref]) {
    const response = await otherPage.goto(href);
    expect(response?.status(), href).toBe(404);
    await expect(otherPage.getByText("We couldn't find that page")).toBeVisible();
  }
  await other.close();
});
