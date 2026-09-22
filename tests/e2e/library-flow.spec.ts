import { expect, test } from "@playwright/test";
import { createClassWithStudents, PASSWORD, snackbar, uniqueEmail } from "./helpers";

test("a teacher signs up, builds a catalog and roster, and checks a book out and back in", async ({ page }) => {
  await test.step("sign up with email", async () => {
    await page.goto("/sign-up");
    await page.getByRole("textbox", { name: "Your name" }).fill("Jordan Reyes");
    await page.getByRole("textbox", { name: "School email" }).fill(uniqueEmail("jordan"));
    await page.getByLabel("Password", { exact: true }).fill(PASSWORD);
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole("heading", { name: "Get started" })).toBeVisible();
  });

  await test.step("create a class and paste a roster", async () => {
    await createClassWithStudents(page, "Room 12", ["Ada Lovelace", "Grace Hopper"]);
    await expect(page.getByRole("link", { name: /Ada Lovelace/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /Grace Hopper/ })).toBeVisible();
  });

  await test.step("look up a book by ISBN and add it", async () => {
    await page.goto("/library/add");
    await page.getByRole("textbox", { name: "ISBN" }).fill("9780064440202");
    await page.getByRole("button", { name: "Look up" }).click();
    await expect(page.getByRole("heading", { name: /Frog and Toad Are Friends/ })).toBeVisible();
    await page.getByRole("button", { name: "Add to library" }).click();
    await expect(snackbar(page, /Added Frog and Toad Are Friends/)).toBeVisible();
  });

  await test.step("add a book without an ISBN", async () => {
    await page.getByRole("button", { name: "Add a book without an ISBN" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Our Class Poetry Anthology");
    await dialog.getByRole("button", { name: "Add book" }).click();
    await expect(snackbar(page, "Added Our Class Poetry Anthology")).toBeVisible();
  });

  await test.step("rapid scan another book", async () => {
    await page.getByText("Rapid scan", { exact: true }).click();
    const field = page.getByRole("textbox", { name: "ISBN" });
    await field.fill("9780439708180");
    await field.press("Enter");
    await expect(page.getByText("1 book added")).toBeVisible({ timeout: 30_000 });
  });

  await test.step("see all three in the library", async () => {
    await page.goto("/library");
    await expect(page.getByText("3 titles · 3 copies")).toBeVisible();
  });

  await test.step("check out a book to a student", async () => {
    await page.goto("/checkout");
    await page.getByRole("button", { name: /Ada Lovelace/ }).click();
    const isbn = page.getByRole("textbox", { name: "Scan or type the book's ISBN" });
    await isbn.fill("9780064440202");
    await isbn.press("Enter");
    await expect(snackbar(page, /Frog and Toad Are Friends.*checked out to Ada/)).toBeVisible();
  });

  await test.step("the dashboard counts it", async () => {
    await page.goto("/dashboard");
    await expect(page.getByText("1 book out", { exact: true })).toBeVisible();
    await expect(page.getByRole("list", { name: "Recent activity" }).getByText("Checked out to Ada Lovelace")).toBeVisible();
  });

  await test.step("check the book back in", async () => {
    await page.goto("/checkin");
    const isbn = page.getByRole("textbox", { name: "Scan or type the book's ISBN" });
    await isbn.fill("9780064440202");
    await isbn.press("Enter");
    await expect(snackbar(page, /Returned Frog and Toad Are Friends.*from Ada Lovelace/)).toBeVisible();
    await expect(page.getByText("Everything's on the shelf")).toBeVisible();
  });

  await test.step("the student's reading history shows it", async () => {
    await page.goto("/classes");
    await page.getByRole("link", { name: /Room 12/ }).click();
    await page.getByRole("link", { name: /Ada Lovelace/ }).click();
    await expect(page.getByRole("heading", { name: "Ada Lovelace" })).toBeVisible();
    await expect(page.getByRole("list", { name: /history/i }).getByText(/Frog and Toad Are Friends/)).toBeVisible();
  });

  // Every destination added to the bar takes width from the labels already there, and the
  // longest one is bold while you're on it. 360px is the narrowest phone still in use.
  await test.step("every navigation label fits a narrow phone", async () => {
    const viewport = page.viewportSize();
    await page.setViewportSize({ width: 360, height: 844 });
    await page.goto("/checkout");

    const bar = page.locator("nav[data-nav-bar]");
    await expect(bar).toBeVisible();
    const clipped = await bar.locator("a").evaluateAll((links) =>
      links
        .map((link) => link.querySelector("span:last-child") as HTMLElement)
        .filter((label) => label.scrollWidth > label.clientWidth + 1)
        .map((label) => label.textContent),
    );
    expect(clipped, "navigation labels cut off at 360px").toEqual([]);
    // Fitting the labels must not be paid for by pushing the bar off the screen.
    const overflows = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflows, "the page scrolls sideways at 360px").toBe(false);

    if (viewport) await page.setViewportSize(viewport);
  });
});
