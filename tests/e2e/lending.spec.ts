import { expect, test } from "@playwright/test";
import { rapidAdd, signUp, snackbar } from "./helpers";

const LENT = "Harry Potter and the Deathly Hallows";
const HELD_BACK = "The Alchemist";

// One account per teacher, and no more: Better Auth rate-limits sign-ups per IP, and the
// specs share one. Everything below is the same pair of teachers throughout.
test("two teachers connect, lend a book between their libraries, and send it home", async ({
  browser,
  page,
}) => {
  // Rae has two books, one of which she keeps for herself.
  const raeEmail = await signUp(page, "Rae Delgado");
  await rapidAdd(page, ["9780545010221", "9780062315007"]);
  await page.goto("/library");
  await page.getByRole("link", { name: HELD_BACK }).first().click();
  await page.waitForURL(/\/library\/[0-9a-f-]{36}$/);
  // react-aria renders the switch as a visually hidden input, so drive it by its label.
  await page.getByText("Offer to connected teachers").click();
  await expect(page.getByText("Held back.", { exact: false })).toBeVisible();

  const samContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    timezoneId: "America/Chicago",
  });
  const sam = await samContext.newPage();
  await signUp(sam, "Sam Chen");

  // Nobody is connected yet, so there is nothing to borrow from.
  await sam.goto("/lending");
  await expect(sam.getByText("Share shelves with another teacher")).toBeVisible();

  await sam.getByRole("button", { name: "Invite a teacher" }).first().click();
  const invite = sam.getByRole("dialog");
  await invite.getByRole("textbox", { name: "Their email address" }).fill(raeEmail);
  await invite.getByRole("button", { name: "Send" }).click();
  await expect(snackbar(sam, /Invitation sent to Rae Delgado/)).toBeVisible();

  // Until Rae accepts, Sam can see nothing of hers.
  await sam.goto("/lending");
  await expect(sam.getByText("Hasn’t answered yet")).toBeVisible();
  await expect(sam.getByRole("link", { name: "Shelves" })).toHaveCount(0);

  await page.goto("/lending");
  await expect(page.getByText("Wants to share shelves with you")).toBeVisible();
  await page.getByRole("button", { name: "Accept" }).click();
  await expect(snackbar(page, /now sharing shelves/)).toBeVisible();

  // Sam sees only the title Rae offers, and asks for it.
  await sam.goto("/lending");
  await sam.getByRole("link", { name: "Shelves" }).click();
  await sam.waitForURL(/\/lending\/shelf\//);
  await expect(sam.getByText("1 title offered")).toBeVisible();
  await expect(sam.getByText(LENT).first()).toBeVisible();
  await expect(sam.getByText(HELD_BACK)).toHaveCount(0);
  await expect(sam.getByText("1 free")).toBeVisible();

  await sam.getByRole("button", { name: "Ask to borrow" }).first().click();
  const request = sam.getByRole("dialog");
  await request.getByRole("textbox", { name: "Add a note" }).fill("For my read-aloud shelf");
  await request.getByRole("button", { name: "Send request" }).click();
  await expect(snackbar(sam, new RegExp(`Asked Rae Delgado for ${LENT}`))).toBeVisible();

  // Rae sees the request, with the note, and lends it.
  await page.goto("/lending");
  await expect(page.getByText(/Sam Chen — “For my read-aloud shelf”/)).toBeVisible();
  await page.getByRole("button", { name: "Lend it" }).first().click();
  await page.getByRole("dialog").getByRole("button", { name: "Lend it" }).click();
  await expect(snackbar(page, /is on its way to Sam Chen/)).toBeVisible();

  // The copy has left Rae's shelf.
  await page.goto("/lending");
  await expect(page.getByText(/With Sam Chen/)).toBeVisible();
  await page.goto("/library");
  await page.getByRole("link", { name: LENT }).first().click();
  await page.waitForURL(/\/library\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Lent to Sam Chen", { exact: false })).toBeVisible();

  // And landed on Sam's, in his own library, ready for his students.
  await sam.goto("/library");
  await expect(sam.getByText(LENT).first()).toBeVisible();
  await sam.goto("/lending");
  await expect(sam.getByText(/From Rae Delgado/)).toBeVisible();

  // Sam sends it home again.
  await sam.getByRole("button", { name: "Send it back" }).click();
  await sam.getByRole("dialog").getByRole("button", { name: "Send it back" }).click();
  await expect(snackbar(sam, /is home/)).toBeVisible();

  await sam.goto("/library");
  await expect(sam.getByText("Your library is empty")).toBeVisible();
  await page.goto("/library");
  await page.getByRole("link", { name: LENT }).first().click();
  await page.waitForURL(/\/library\/[0-9a-f-]{36}$/);
  await expect(page.getByText("Available").first()).toBeVisible();

  await samContext.close();
});
