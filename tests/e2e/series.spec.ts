import { expect, type Locator, test } from "@playwright/test";
import { rapidAdd, signUp, snackbar } from "./helpers";

/** Ticks a checkbox from the keyboard, as someone tabbing through the library would. */
async function tick(checkbox: Locator) {
  await checkbox.focus();
  await checkbox.press("Space");
  await expect(checkbox).toBeChecked();
}

test("a series shows as one stack in the library, and opens to its books in order", async ({ page }) => {
  await signUp(page, "Priya Natarajan");
  // Deathly Hallows's catalogue record names its series; Frog and Toad has none.
  await rapidAdd(page, ["9780545010221", "9780064440202"]);

  await test.step("a looked-up book is given its series by hand", async () => {
    await page.goto("/library/add");
    const field = page.getByRole("textbox", { name: "ISBN" });
    await field.fill("9780439708180");
    await field.press("Enter");
    await expect(page.getByText("Found", { exact: true })).toBeVisible({ timeout: 30_000 });
    await page.getByRole("combobox", { name: "Series" }).fill("Harry Potter");
    await page.getByRole("textbox", { name: "Book no." }).fill("1");
    await page.getByRole("button", { name: "Add to library" }).click();
    await expect(snackbar(page, /Added Harry Potter/)).toBeVisible();
  });

  await test.step("the two are one stack", async () => {
    await page.goto("/library");
    await expect(page.getByRole("link", { name: "Harry Potter, 2 books" })).toBeVisible();
    await expect(page.getByRole("link", { name: /Deathly Hallows/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Frog and Toad/ })).toHaveCount(1);
  });

  await test.step("choosing the stack chooses both books", async () => {
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await tick(page.getByRole("list", { name: "Books to select" }).getByRole("checkbox", { name: "Harry Potter, 2 books" }));
    await expect(page.getByRole("toolbar", { name: "Selected books" }).getByText("2 books selected")).toBeVisible();
    await page.getByRole("button", { name: "Done" }).click();
  });

  await test.step("opening it lists the series in order", async () => {
    await page.getByRole("link", { name: "Harry Potter, 2 books" }).click();
    await expect(page).toHaveURL(/series=Harry/);
    await expect(page.getByRole("heading", { name: "Harry Potter" })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Harry Potter and the/ })).toHaveText([/Sorcerer's Stone/, /Deathly Hallows/]);
    await page.getByRole("link", { name: "All books" }).click();
    await expect(page).not.toHaveURL(/series=/);
  });

  await test.step("a book's page names its series", async () => {
    await page.goto("/library?series=Harry%20Potter");
    await page.getByRole("link", { name: /Deathly Hallows/ }).click();
    await expect(page.getByRole("link", { name: /Harry Potter, book 7/ })).toBeVisible();
  });

  await test.step("finding series checks the books without one, and says when it's done", async () => {
    await page.goto("/settings");
    await page.getByRole("button", { name: "Find series for my library" }).click();
    // Only Frog and Toad is left without a series, and its record has none.
    await expect(page.getByText(/Checked 1 book and found a series for 0\. That's every book\./)).toBeVisible({ timeout: 30_000 });
    await expect(page.getByRole("button", { name: /Find series|more|again/ })).toHaveCount(0);
  });

  await test.step("stacks can be turned off", async () => {
    await page.goto("/library");
    await page.getByRole("button", { name: "Sort" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Stack each series" }).click();
    await expect(page.getByRole("link", { name: /Deathly Hallows/ })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Harry Potter, 2 books" })).toHaveCount(0);
  });
});
