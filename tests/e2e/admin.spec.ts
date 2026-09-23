import { expect, test } from "@playwright/test";
import { PASSWORD, signUp } from "./helpers";

/**
 * An admin can only be proven by a verified email, which only Google sign-in provides, so
 * the suite can't sign in as one. What it can prove is the other half, which matters more:
 * nobody gets in by other means, including by registering an admin's address themselves.
 */
test("the admin area stays shut to everyone who isn't a verified admin", async ({ page }) => {
  await test.step("an ordinary teacher sees no admin entry and gets a 404", async () => {
    await signUp(page, "Iris Novak");
    await page.goto("/dashboard");
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
    expect((await page.goto("/admin"))?.status()).toBe(404);
    expect((await page.goto("/admin/teachers/anything"))?.status()).toBe(404);
  });

  await test.step("and can't start acting as anyone", async () => {
    const response = await page.request.post("/api/auth/act-as/start", {
      data: { userId: "anyone" },
      headers: { Origin: test.info().project.use.baseURL! },
    });
    expect(response.ok()).toBe(false);
  });

  await test.step("signing up with an admin's address doesn't make you one", async () => {
    await page.context().clearCookies();
    const response = await page.request.post("/api/auth/sign-up/email", {
      data: { name: "Not The Admin", email: "squatted-admin@example.test", password: PASSWORD },
      headers: { Origin: test.info().project.use.baseURL! },
    });
    // A second run (the phone project) finds the address taken; sign in to it instead.
    if (!response.ok()) {
      await page.request.post("/api/auth/sign-in/email", {
        data: { email: "squatted-admin@example.test", password: PASSWORD },
        headers: { Origin: test.info().project.use.baseURL! },
      });
    }
    await page.goto("/dashboard");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: "Admin" })).toHaveCount(0);
    expect((await page.goto("/admin"))?.status()).toBe(404);
  });
});
