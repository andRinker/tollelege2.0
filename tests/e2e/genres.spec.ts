import { expect, type Locator, test } from "@playwright/test";
import { rapidAdd, signUp, snackbar } from "./helpers";

test("a teacher adds a genre, gives a book that genre, and filters the library by it", async ({ page }) => {
  await signUp(page, "Mina Okafor");
  await rapidAdd(page, ["9780064440202", "9780439708180"]);

  await test.step("every teacher starts with the chart's genres", async () => {
    await page.goto("/settings/genres");
    const list = page.getByRole("list", { name: "Genres" });
    await expect(list.getByRole("listitem")).toHaveCount(9);
    await expect(list.getByText("Nonfiction")).toBeVisible();
  });

  await test.step("add a genre with its own dot colour", async () => {
    await page.getByRole("button", { name: "Add a genre" }).click();
    const dialog = page.getByRole("dialog", { name: "Add a genre" });
    await dialog.getByRole("textbox", { name: "Name" }).fill("Early Readers");
    // The native input is visually hidden behind its swatch, as React Aria does for every radio.
    await dialog.getByRole("radio", { name: "Teal" }).check({ force: true });
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(snackbar(page, /Early Readers added/)).toBeVisible();
    await expect(page.getByRole("list", { name: "Genres" }).getByText("Early Readers")).toBeVisible();
  });

  await test.step("give a book that genre from its page", async () => {
    await page.goto("/library");
    await page.getByRole("link", { name: /Frog and Toad Are Friends/ }).first().click();
    await page.getByRole("button", { name: "Edit" }).first().click();
    const dialog = page.getByRole("dialog", { name: "Edit book" });
    await dialog.getByRole("button", { name: /Genre/ }).click();
    await page.getByRole("option", { name: "Early Readers" }).click();
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(snackbar(page, /Book details saved/)).toBeVisible();
    await expect(page.getByRole("link", { name: /Genre: Early Readers/ })).toBeVisible();
  });

  await test.step("filter the library by it", async () => {
    await page.goto("/library");
    await page.getByRole("button", { name: "Early Readers" }).click();
    await expect(page).toHaveURL(/genre=/);
    await expect(page.getByRole("link", { name: /Frog and Toad Are Friends/ })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /Harry Potter/ })).toHaveCount(0);
  });
});

test("a teacher catalogues a genre shelf, and every book added takes that genre", async ({ page }) => {
  await signUp(page, "Ines Duarte");
  await page.goto("/library/add");

  await test.step("choose the genre for new books", async () => {
    await page.getByRole("button", { name: /Genre for new books/ }).click();
    await page.getByRole("option", { name: "Fantasy" }).click();
    await expect(page.getByRole("button", { name: /Genre for new books/ })).toContainText("Fantasy");
  });

  await test.step("a looked-up book starts in it", async () => {
    const field = page.getByRole("textbox", { name: "ISBN" });
    await field.fill("9780439708180");
    await field.press("Enter");
    await expect(page.getByText("Found", { exact: true })).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /^Genre\b/ }).filter({ hasNotText: "for new books" }).last()).toContainText("Fantasy");
    await page.getByRole("button", { name: "Add to library" }).click();
    await expect(snackbar(page, /Added Harry Potter/)).toBeVisible();
  });

  await test.step("it's remembered, and a rapid scan takes it too", async () => {
    await page.reload();
    await expect(page.getByRole("button", { name: /Genre for new books/ })).toContainText("Fantasy");
    await rapidAdd(page, ["9780545010221"]);
  });

  await test.step("both are in that genre in the library", async () => {
    await page.goto("/library");
    await page.getByRole("button", { name: "Fantasy" }).click();
    await expect(page).toHaveURL(/genre=/);
    await expect(page.getByRole("link", { name: /Sorcerer's Stone/ })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /Deathly Hallows/ })).toHaveCount(1);
  });
});

/** Ticks a checkbox from the keyboard, as someone tabbing through the library would. */
async function tick(checkbox: Locator) {
  await checkbox.focus();
  await checkbox.press("Space");
  await expect(checkbox).toBeChecked();
}

test("a teacher selects several books and sets their genre, bin and lending, then deletes some", async ({ page }) => {
  await signUp(page, "Tomas Reyes");
  await rapidAdd(page, ["9780064440202", "9780439708180", "9780545010221"]);
  await page.goto("/library");

  await test.step("choose two books", async () => {
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const books = page.getByRole("list", { name: "Books to select" });
    await tick(books.getByRole("checkbox", { name: "Frog and Toad Are Friends" }));
    await tick(books.getByRole("checkbox", { name: "Harry Potter and the Deathly Hallows" }));
    await expect(page.getByRole("toolbar", { name: "Selected books" }).getByText("2 books selected")).toBeVisible();
  });

  await test.step("give them a genre", async () => {
    const bar = page.getByRole("toolbar", { name: "Selected books" });
    await bar.getByRole("button", { name: "Genre" }).click();
    await page.getByRole("menuitem", { name: "Realistic Fiction" }).click();
    await expect(snackbar(page, /2 books set to Realistic Fiction/)).toBeVisible();
  });

  await test.step("select the whole page and move it to one bin", async () => {
    await tick(page.getByRole("checkbox", { name: "Select all on this page" }));
    const bar = page.getByRole("toolbar", { name: "Selected books" });
    await expect(bar.getByText("3 books selected")).toBeVisible();
    await bar.getByRole("button", { name: "Bin" }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Bin or shelf" }).fill("Bin 2");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(snackbar(page, /3 books moved to Bin 2/)).toBeVisible();
  });

  await test.step("hold two back from lending, then delete them", async () => {
    const books = page.getByRole("list", { name: "Books to select" });
    await tick(books.getByRole("checkbox", { name: "Frog and Toad Are Friends" }));
    await tick(books.getByRole("checkbox", { name: "Harry Potter and the Deathly Hallows" }));
    const bar = page.getByRole("toolbar", { name: "Selected books" });
    await bar.getByRole("button", { name: "Lending" }).click();
    await page.getByRole("menuitem", { name: "Hold back from lending" }).click();
    await expect(snackbar(page, /Held back 2 books/)).toBeVisible();

    await tick(books.getByRole("checkbox", { name: "Frog and Toad Are Friends" }));
    await tick(books.getByRole("checkbox", { name: "Harry Potter and the Deathly Hallows" }));
    await bar.getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog", { name: "Delete 2 books?" }).getByRole("button", { name: "Delete" }).click();
    await expect(snackbar(page, /Deleted 2 books/)).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("link", { name: /Sorcerer's Stone/ })).toHaveCount(1);
    await expect(page.getByRole("link", { name: /Deathly Hallows/ })).toHaveCount(0);
  });
});
