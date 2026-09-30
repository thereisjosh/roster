import { test, expect } from "@playwright/test";
import { TEST_USER } from "../helpers/auth";
import { getTestBusinessId, seedBusinessConfig, seedStaff } from "../helpers/seed";

test.describe("Dashboard page", () => {
  test.beforeAll(async () => {
    const businessId = await getTestBusinessId(TEST_USER.email);
    await seedBusinessConfig(businessId);
    await seedStaff(businessId, 2);
  });

  test("shows heading and welcome message", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(
      page.getByRole("heading", { name: "Dashboard" })
    ).toBeVisible();
    await expect(page.getByText(/Welcome back/)).toBeVisible();
  });

  test("displays stats cards", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByText("Active Staff")).toBeVisible();
  });

  test("sidebar nav links are visible", async ({ page }) => {
    await page.goto("/dashboard");

    await expect(page.getByRole("link", { name: "Dashboard" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Staff" })).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Availability" })
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "Schedule" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Settings" })).toBeVisible();
  });

  test("nav click navigates to /staff", async ({ page }) => {
    await page.goto("/dashboard");

    await page.getByRole("link", { name: "Staff" }).click();
    await page.waitForURL("**/staff");
    expect(page.url()).toContain("/staff");
  });
});
