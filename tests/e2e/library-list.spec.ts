import { expect, type Page, test } from "@playwright/test";
import { rapidAdd, signUp, snackbar } from "./helpers";

/** One row's controls. They're grouped under the book's title, so this finds the right "Delete". */
function rowActions(page: Page, title: string) {
  return page.getByRole("list", { name: "Books" }).getByRole("group", { name: title });
}

test("the library list edits, holds back from lending and deletes, row by row", async ({ page }) => {
  await signUp(page, "Priya Natarajan");
  await rapidAdd(page, ["9780064440202", "9780439708180"]);

  await test.step("switching to the list is remembered", async () => {
    await page.goto("/library");
    await page.getByRole("radio", { name: "List" }).click();
    await expect(page.getByRole("list", { name: "Books" })).toBeVisible();
    await page.reload();
    await expect(page.getByRole("list", { name: "Books" })).toBeVisible();
    await expect(page.getByRole("radio", { name: "List" })).toBeChecked();
  });

  await test.step("exclude a title from lending, and the row says so", async () => {
    const frog = rowActions(page, "Frog and Toad Are Friends");
    await frog.getByRole("button", { name: "Exclude from lending" }).click();
    await expect(snackbar(page, /held back from lending/)).toBeVisible();
    await expect(frog.getByRole("button", { name: "Include in lending" })).toBeVisible();

    // It's saved, not just shown: still held back after a reload, and on the book's page.
    await page.reload();
    const row = page.getByRole("list", { name: "Books" }).getByRole("listitem").filter({ hasText: "Frog and Toad Are Friends" });
    await expect(row.getByText("Not lent")).toBeVisible();
    await expect(rowActions(page, "Frog and Toad Are Friends").getByRole("button", { name: "Include in lending" })).toBeVisible();
  });

  await test.step("edit a title's details from its row", async () => {
    await rowActions(page, "Frog and Toad Are Friends").getByRole("button", { name: "Edit details" }).click();
    const dialog = page.getByRole("dialog", { name: "Edit book" });
    // The row fetches the full record, so fields the list never shows arrive filled in.
    await expect(dialog.getByRole("textbox", { name: "Publisher" })).toHaveValue("HarperTrophy");
    await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Frog and Toad Are Friends (Class Set)");
    await dialog.getByRole("button", { name: "Save" }).click();
    await expect(snackbar(page, "Book details saved")).toBeVisible();
    await expect(page.getByRole("list", { name: "Books" }).getByText("Frog and Toad Are Friends (Class Set)")).toBeVisible();
  });

  await test.step("delete a title from its row", async () => {
    await rowActions(page, "Harry Potter and the Sorcerer's Stone").getByRole("button", { name: "Delete" }).click();
    await page.getByRole("dialog", { name: "Delete this book?" }).getByRole("button", { name: "Delete" }).click();
    await expect(snackbar(page, "Deleted Harry Potter and the Sorcerer's Stone")).toBeVisible();
    await expect(page.getByRole("list", { name: "Books" }).getByText("Harry Potter and the Sorcerer's Stone")).toHaveCount(0);
    await expect(page.getByText("1 title · 1 copy")).toBeVisible();
  });

  await test.step("the grid is one tap back", async () => {
    await page.getByRole("radio", { name: "Grid" }).click();
    await expect(page.getByRole("list", { name: "Books" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Frog and Toad Are Friends \(Class Set\)/ })).toBeVisible();
  });
});
