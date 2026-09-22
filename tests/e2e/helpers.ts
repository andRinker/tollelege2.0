import { expect, type Page, test } from "@playwright/test";

export const PASSWORD = "correct-horse-battery";

export function uniqueEmail(name: string) {
  return `${name.toLowerCase().replace(/\W+/g, ".")}.${Date.now()}.${Math.random().toString(36).slice(2, 7)}@example.test`;
}

/** Creates an account through the auth API (faster than the form) and signs this page's context in. */
export async function signUp(page: Page, name: string) {
  const email = uniqueEmail(name);
  // Better Auth rate-limits sign-ups per IP in production builds; wait out a 429 instead of failing.
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await page.request.post("/api/auth/sign-up/email", {
      data: { name, email, password: PASSWORD },
      headers: { Origin: test.info().project.use.baseURL! },
    });
    if (response.status() === 429) {
      await page.waitForTimeout(Number(response.headers()["x-retry-after"] ?? 10) * 1000 + 250);
      continue;
    }
    expect(response.ok(), await response.text()).toBeTruthy();
    return email;
  }
  throw new Error("Sign-up stayed rate limited");
}

export function snackbar(page: Page, text: string | RegExp) {
  return page.getByRole("status").getByText(text);
}

/**
 * Waits for a snackbar to finish fading in. `toBeVisible()` resolves as soon as the
 * element is laid out, which on a slow machine is partway through the fade — and axe
 * reads a half-transparent message as a real colour-contrast failure.
 */
export async function settledSnackbar(page: Page, text: string | RegExp) {
  const message = snackbar(page, text);
  await expect(message).toBeVisible();
  await expect
    .poll(() =>
      message.evaluate((element) => {
        let node: HTMLElement | null = element as HTMLElement;
        let lowest = 1;
        while (node) {
          lowest = Math.min(lowest, Number(getComputedStyle(node).opacity || "1"));
          node = node.parentElement;
        }
        return lowest;
      }),
    )
    .toBeGreaterThan(0.99);
  return message;
}

export async function createClassWithStudents(page: Page, className: string, names: string[]) {
  await page.goto("/classes");
  await page.getByRole("button", { name: "New class" }).first().click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Class name" }).fill(className);
  await page.getByRole("dialog").getByRole("button", { name: "Create" }).click();
  await page.waitForURL(/\/classes\/[0-9a-f-]{36}$/);
  await page.getByRole("button", { name: "Import" }).click();
  await page.getByRole("dialog").getByRole("textbox", { name: "Student names" }).fill(names.join("\n"));
  await page.getByRole("dialog").getByRole("button", { name: `Add ${names.length}` }).click();
  await expect(snackbar(page, `Added ${names.length} ${names.length === 1 ? "student" : "students"}`)).toBeVisible();
}

/** Adds books by ISBN with rapid scan, the way a USB scanner would type them. */
export async function rapidAdd(page: Page, isbns: string[]) {
  await page.goto("/library/add");
  await page.getByText("Rapid scan", { exact: true }).click();
  const field = page.getByRole("textbox", { name: "ISBN" });
  for (const isbn of isbns) {
    await field.fill(isbn);
    await field.press("Enter");
  }
  await expect(page.getByText(`${isbns.length} ${isbns.length === 1 ? "book" : "books"} added`)).toBeVisible({ timeout: 30_000 });
}

export async function firstHref(page: Page, pattern: RegExp) {
  // A single snapshot races the revalidation that puts these links on the page, so poll
  // the way a locator assertion would rather than reading the DOM once.
  let href: string | undefined;
  await expect
    .poll(
      async () => {
        const hrefs = await page
          .locator("a[href]")
          .evaluateAll((links) => links.map((link) => link.getAttribute("href") ?? ""));
        href = hrefs.find((candidate) => pattern.test(candidate));
        return href ?? null;
      },
      { message: `a link matching ${pattern}` },
    )
    .not.toBeNull();
  return href!;
}
