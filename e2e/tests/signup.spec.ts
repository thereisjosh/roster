import { test, expect } from "@playwright/test";
import { cleanupTestUser } from "../helpers/db";

const signupTestEmail = `e2e-signup-${Date.now()}@test.roster.local`;

test.describe("Signup page", () => {
  test.afterAll(async () => {
    await cleanupTestUser(signupTestEmail);
  });

  test("shows signup form", async ({ page }) => {
    await page.goto("/signup");

    await expect(
      page.getByText("Create account", { exact: true }).first()
    ).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(page.getByLabel("Business name")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Create account" })
    ).toBeVisible();
  });

  test("successful signup redirects to /dashboard", async ({ page }) => {
    await page.goto("/signup");

    await page.getByLabel("Your name").fill("Signup Test");
    await page.getByLabel("Email").fill(signupTestEmail);
    await page.getByLabel("Password").fill("TestPassword123!");
    await page.getByLabel("Business name").fill("Signup Test Business");
    await page.getByRole("button", { name: "Create account" }).click();

    await page.waitForURL("**/dashboard", { timeout: 30000 });
    expect(page.url()).toContain("/dashboard");
  });

  test("sign in link navigates to /login", async ({ page }) => {
    await page.goto("/signup");

    await page.getByRole("link", { name: "Sign in" }).click();
    await page.waitForURL("**/login");
    expect(page.url()).toContain("/login");
  });
});
