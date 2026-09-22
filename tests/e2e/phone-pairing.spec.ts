import { expect, type Page, test } from "@playwright/test";
import { signUp } from "./helpers";

const TITLE = "Harry Potter and the Deathly Hallows";

/**
 * The pairing URL is only ever handed to the browser that asked for it, and only inside
 * the server action's response — there is no element to read it from, because putting it
 * on screen in text is exactly what the QR code avoids.
 */
async function catchPairingUrl(page: Page): Promise<{ get: () => string | null }> {
  let found: string | null = null;
  // Intercepted rather than read from a `response` event: a server action's body is
  // streamed and is already gone by the time an event handler asks for it.
  await page.route("**/library/add", async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const response = await route.fetch();
    const body = await response.text();
    found ??= body.match(/https?:\/\/[^"\s\\]*\/scan#[A-Za-z0-9_-]+/)?.[0] ?? null;
    await route.fulfill({ response, body });
  });
  return { get: () => found };
}

test("a phone that cannot sign in still scans into the library", async ({ browser, page }) => {
  await signUp(page, "Rae Delgado");

  const pairing = await catchPairingUrl(page);
  await page.goto("/library/add");
  await page.getByRole("button", { name: "Show the code" }).click();
  await expect(page.getByRole("img", { name: /pairing code/i })).toBeVisible();
  await expect(page.getByText("Waiting for your phone")).toBeVisible();

  await expect.poll(pairing.get, { message: "a pairing URL in the action response" }).not.toBeNull();
  const pairUrl = pairing.get() as string;

  // The phone: its own context, so it carries none of the teacher's cookies.
  const phoneContext = await browser.newContext({
    baseURL: test.info().project.use.baseURL,
    timezoneId: "America/Chicago",
    userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148",
  });
  const phone = await phoneContext.newPage();
  await phone.goto(pairUrl);

  await expect(phone.getByRole("heading", { name: "Scanning" })).toBeVisible();
  await expect(phone.getByText("Rae Delgado")).toBeVisible();
  // The token is wiped from the address bar the moment it has been read.
  expect(new URL(phone.url()).hash).toBe("");

  await phone.getByRole("textbox", { name: /type an ISBN/i }).fill("9780545010221");
  await phone.getByRole("button", { name: "Add", exact: true }).click();
  await expect(phone.getByText(TITLE)).toBeVisible();

  // The laptop hears about it on its own, into the same list a USB scanner feeds.
  await expect(page.getByText(TITLE)).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText("1 book added")).toBeVisible();
  await expect(page.getByText(/is scanning/)).toBeVisible();

  // It really was added, not just announced.
  await page.goto("/library");
  await expect(page.getByRole("link", { name: TITLE }).first()).toBeVisible();

  // A second phone cannot take over a code the first one claimed.
  const intruderContext = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const intruder = await intruderContext.newPage();
  await intruder.goto(pairUrl);
  await expect(intruder.getByRole("heading", { name: "Not connected" })).toBeVisible();
  await expect(intruder.getByText(/Another phone is already using/)).toBeVisible();
  await intruderContext.close();

  // Disconnecting stops the phone that was working.
  await page.goto("/library/add");
  await page.getByRole("button", { name: "Disconnect" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Disconnect" }).click();

  await phone.reload();
  await expect(phone.getByRole("heading", { name: "Not connected" })).toBeVisible();
  await phoneContext.close();
});

test("the scanner refuses to open without a pairing code", async ({ page }) => {
  await page.goto("/scan");
  await expect(page.getByRole("heading", { name: "Not connected" })).toBeVisible();
  await expect(page.getByText(/scanning the code shown on your computer/)).toBeVisible();
});
