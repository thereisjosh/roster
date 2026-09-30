import { test, expect } from "@playwright/test";
import { TEST_USER } from "../helpers/auth";

test.describe("Login page", () => {
  test("shows login form", async ({ page }) => {
    await page.goto("/login");

    await expect(page.getByText("Sign in", { exact: true }).first()).toBeVisible({ timeout: 10000 });
    await expect(page.getByLabel("Email")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Sign in" })
    ).toBeVisible();
  });

  test("shows error on invalid credentials", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email").fill("nobody@example.com");
    await page.getByLabel("Password").fill("WrongPassword123!");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.locator(".bg-destructive\\/10")).toBeVisible({
      timeout: 10000,
    });
  });

  test("successful login redirects to /dashboard", async ({ page }) => {
    await page.goto("/login");

    await page.getByLabel("Email").fill(TEST_USER.email);
    await page.getByLabel("Password").fill(TEST_USER.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await page.waitForURL("**/dashboard", { timeout: 15000 });
    expect(page.url()).toContain("/dashboard");
  });

  test("sign up link navigates to /signup", async ({ page }) => {
    await page.goto("/login");

    await page.getByRole("link", { name: "Sign up" }).click();
    await page.waitForURL("**/signup");
    expect(page.url()).toContain("/signup");
  });

  test("/dashboard without auth redirects to /login", async ({ page }) => {
    await page.goto("/dashboard");

    await page.waitForURL("**/login", { timeout: 10000 });
    expect(page.url()).toContain("/login");
  });
});
