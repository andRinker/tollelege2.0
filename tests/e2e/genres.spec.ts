import { expect, test } from "@playwright/test";
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
