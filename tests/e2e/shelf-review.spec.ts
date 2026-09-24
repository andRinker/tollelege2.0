import { expect, type Page, test } from "@playwright/test";
import { signUp, snackbar } from "./helpers";

/**
 * The shelf review, driven by the canned shelf in `src/server/shelf-scan/fixtures.ts`
 * (SHELF_SCAN_FIXTURES=1 in the Playwright config). That shelf is deliberately the awkward
 * one — six spines, of which only two reach a catalogue:
 *
 *   0 The Alchemist ......... read and matched
 *   1 ....................... unreadable, fragment "The Mouse and the"
 *   2 ....................... unreadable, nothing legible
 *   3 Deathly Hallows ....... read and matched
 *   4 Boxcar Children ....... read perfectly well, but no catalogue knows it
 *   5 ....................... unreadable, nothing legible
 *
 * What is being tested is the scan admitting what it couldn't finish: the count, the place
 * on the shelf each unfinished spine sits, and the three ways out of one.
 */

// The two matched books, as the review quotes them when placing a gap between them.
const ALCHEMIST = "“The Alchemist”";
const HALLOWS = "“Harry Potter and the Deathly Hallows”";
const FROG = "“Frog and Toad Are Friends”";

/** A 1×1 JPEG. The reader is on fixtures, so the pixels never matter — only the upload does. */
const TINY_JPEG = Buffer.from(
  "/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFQEBAQAAAAAAAAAAAAAAAAAAAAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCdABmX/9k=",
  "base64",
);

async function photographShelf(page: Page) {
  await page.goto("/library/add");
  await page.getByRole("button", { name: "Photograph a shelf" }).click();
  await page
    .getByRole("dialog")
    .locator('input[type="file"]')
    .last()
    .setInputFiles({ name: "shelf.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG });
}

/**
 * The one line summing the shelf up. Anchored at the start so it can only match the whole
 * paragraph, never the span inside it holding the count.
 */
function summary(page: Page) {
  return page.getByRole("dialog").getByText(/^Found \d+ books?\./);
}

/** The row for one spine, found by a line only that row carries. */
function row(page: Page, text: string | RegExp) {
  return page.getByRole("dialog").locator("li").filter({ hasText: text });
}

test("a shelf photo says what it couldn't read, and where each one sits", async ({ page }) => {
  await signUp(page, "Marguerite Okafor");
  await photographShelf(page);

  const dialog = page.getByRole("dialog");

  await test.step("it counts the spines it couldn't finish", async () => {
    // Two matched, four didn't — and the four are the number worth saying out loud.
    await expect(summary(page)).toHaveText("Found 2 books. 4 spines need you.", { timeout: 40_000 });
  });

  await test.step("it places each one by its neighbours rather than only counting them", async () => {
    // Slots 1 and 2 are a run between the same two books, so a place alone would name them
    // identically. They are numbered within the run instead.
    await expect(dialog.getByText(`1st of 2, between ${ALCHEMIST} and ${HALLOWS}`)).toBeVisible();
    await expect(dialog.getByText(`2nd of 2, between ${ALCHEMIST} and ${HALLOWS}`)).toBeVisible();
    // Slot 5 sits at the end of the shelf, so it has only a left-hand neighbour — and that
    // neighbour is slot 4, which was read even though nothing matched it.
    await expect(dialog.getByText("after “Boxcar Children Special Edition”")).toBeVisible();
  });

  await test.step("it reports the part of an unreadable spine it could make out", async () => {
    await expect(dialog.getByText("Could make out: The Mouse and the")).toBeVisible();
  });

  await test.step("a spine it read but couldn't match keeps its title and says why it's here", async () => {
    const boxcar = row(page, "No catalogue had this one");
    await expect(boxcar.getByText("Boxcar Children Special Edition")).toBeVisible();
    // Named by its own title, so it is not counted into the run of blanks beside it.
    await expect(boxcar.getByText(`after ${HALLOWS}`)).toBeVisible();
    await expect(boxcar.getByText(/of 2,/)).toHaveCount(0);
  });

  await test.step("every gap offers all three ways out of it", async () => {
    const gap = row(page, `1st of 2, between ${ALCHEMIST} and ${HALLOWS}`);
    for (const name of ["Scan it", "Type ISBN", "By hand"]) {
      await expect(gap.getByRole("button", { name })).toBeVisible();
    }
  });

  await test.step("opening the review adds nothing on its own", async () => {
    // Only the two confident matches are ticked; the four gaps have nothing to tick.
    await expect(dialog.getByRole("button", { name: "Add 2" })).toBeVisible();
  });
});

test("a teacher fills the gaps by typing, by scanning and by hand", async ({ page }) => {
  await signUp(page, "Desmond Achebe");
  await photographShelf(page);

  const dialog = page.getByRole("dialog");
  await expect(summary(page)).toHaveText("Found 2 books. 4 spines need you.", { timeout: 40_000 });

  await test.step("typing an ISBN into a gap fills that row", async () => {
    await row(page, `1st of 2, between ${ALCHEMIST} and ${HALLOWS}`).getByRole("button", { name: "Type ISBN" }).click();
    await dialog.getByRole("textbox", { name: "ISBN" }).fill("9780064440202");
    await dialog.getByRole("button", { name: "Add", exact: true }).click();

    await expect(summary(page)).toHaveText("Found 2 books. 3 spines need you.", { timeout: 30_000 });
    await expect(row(page, "Frog and Toad Are Friends").first()).toBeVisible();
  });

  await test.step("the filled row now anchors its neighbour, so the list tightens up", async () => {
    // Slot 2 called itself "2nd of 2"; with slot 1 filled it is a run of one between two
    // books the teacher can now see named.
    await expect(dialog.getByText(`between ${FROG} and ${HALLOWS}`)).toBeVisible();
    await expect(dialog.getByText(/of 2, between “The Alchemist”/)).toHaveCount(0);
  });

  await test.step("arming a gap sends the next barcode into it", async () => {
    await row(page, `between ${FROG} and ${HALLOWS}`)
      .getByRole("button", { name: "Scan it" })
      .click();
    await expect(dialog.getByText(/Scan this one now/)).toBeVisible();

    // A USB scanner is a keyboard: a burst of digits, then Enter. The trailing newline has
    // to go in the same `type` call, because the wedge only trusts keys a few milliseconds
    // apart and a second round trip to the browser is far slower than any real scanner.
    // Dialogs swallow that burst by default — an armed gap is the one place that asks for it.
    await page.keyboard.type("9780439708180\n");

    await expect(summary(page)).toHaveText("Found 2 books. 2 spines need you.", { timeout: 30_000 });
    await expect(row(page, "Harry Potter and the Sorcerer's Stone").first()).toBeVisible();
  });

  await test.step("a spine no catalogue knows goes in by hand, prefilled with what was read", async () => {
    await row(page, "No catalogue had this one").getByRole("button", { name: "By hand" }).click();
    const manual = page.getByRole("dialog").filter({ has: page.getByRole("button", { name: "Add book" }) });
    await expect(manual.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(
      "Boxcar Children Special Edition",
    );
    await manual.getByRole("button", { name: "Add book" }).click();
    await expect(snackbar(page, "Added Boxcar Children Special Edition")).toBeVisible();
    await expect(summary(page)).toHaveText("Found 2 books. 1 spine needs you.");
  });

  await test.step("confirming the shelf adds the books that were ticked", async () => {
    await dialog.getByRole("button", { name: "Add 2" }).click();
    await expect(snackbar(page, /Added 2 books from the shelf/)).toBeVisible({ timeout: 30_000 });
  });

  await test.step("the library holds the matches and the gap fills, and nothing else", async () => {
    await page.goto("/library");
    for (const title of [
      "The Alchemist",
      "Harry Potter and the Deathly Hallows",
      "Frog and Toad Are Friends",
      "Harry Potter and the Sorcerer's Stone",
      "Boxcar Children Special Edition",
    ]) {
      await expect(page.getByText(title).first()).toBeVisible();
    }
    // The spine nobody could read is still nobody's guess: it was never added.
    await expect(page.getByText("5 titles · 5 copies")).toBeVisible();
  });
});

/**
 * With a count, the canned shelf comes up short (six books against ten), so it takes the
 * second look in `fixtures.ts`: a second Alchemist, a thin Frog and Toad, one more
 * unreadable spine, and Deathly Hallows dropped, which the merge must put back. Nine books
 * in all, so one of the ten is still nowhere in the photo.
 */
test("a count the photo falls short of earns a second look, and says what's still missing", async ({ page }) => {
  await signUp(page, "Tomasz Lind");
  await page.goto("/library/add");
  await page.getByRole("button", { name: "Photograph a shelf" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("textbox", { name: /How many books on this shelf/ }).fill("10");
  await dialog.locator('input[type="file"]').last().setInputFiles({ name: "shelf.jpg", mimeType: "image/jpeg", buffer: TINY_JPEG });

  await test.step("it measures the photo against the count", async () => {
    await expect(dialog.getByText(/^Found 9 of the 10 books you counted\. A second look found 3 of them\./)).toBeVisible({
      timeout: 40_000,
    });
  });

  await test.step("a book only the second look found waits for a deliberate yes", async () => {
    const frog = row(page, "Found on a second look");
    await expect(frog.getByText("Frog and Toad Are Friends")).toBeVisible();
    await expect(frog.getByRole("checkbox")).not.toBeChecked();
  });

  await test.step("copies count, and a book the second look dropped is still there", async () => {
    await expect(row(page, "2 copies on the shelf").getByText("The Alchemist")).toBeVisible();
    await expect(row(page, "Match").filter({ hasText: "Deathly Hallows" })).toHaveCount(1);
  });

  await test.step("the one it never saw is a row to fill like any other", async () => {
    const missing = row(page, "Not found in the photo");
    await expect(missing).toHaveCount(1);
    await expect(missing.getByText("Somewhere on this shelf; the photo showed no sign of it")).toBeVisible();
    for (const name of ["Scan it", "Type ISBN", "By hand"]) {
      await expect(missing.getByRole("button", { name })).toBeVisible();
    }
  });

  await test.step("confirming a row of copies adds every copy", async () => {
    // Two Alchemists and one Hallows; Frog and Toad waits unticked.
    await dialog.getByRole("button", { name: "Add 3" }).click();
    await expect(snackbar(page, "Added 2 books and 1 copy from the shelf.")).toBeVisible({ timeout: 30_000 });
  });
});
