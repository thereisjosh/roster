import { test, expect } from "@playwright/test";
import { TEST_USER } from "../helpers/auth";
import { getTestBusinessId, seedBusinessConfig, seedStaff } from "../helpers/seed";

test.describe("Availability page", () => {
  test.beforeAll(async () => {
    const businessId = await getTestBusinessId(TEST_USER.email);
    await seedBusinessConfig(businessId);
    // Seed staff so the availability table is populated
    await seedStaff(businessId, 2);
  });

  test("shows heading and week navigation", async ({ page }) => {
    await page.goto("/availability");

    await expect(
      page.getByRole("heading", { name: "Availability" })
    ).toBeVisible();
    // Week range text should be visible (e.g., "Mon 4 — Sun 10")
    await expect(page.locator("text=/\\w{3} \\d/")).toBeVisible({
      timeout: 10000,
    });
  });

  test("displays staff table columns", async ({ page }) => {
    await page.goto("/availability");

    await expect(page.getByText("Staff Member")).toBeVisible({ timeout: 10000 });
    await expect(page.getByText("Status")).toBeVisible();
    await expect(page.getByText("Slots Filled")).toBeVisible();
  });

  test("week navigation changes displayed range", async ({ page }) => {
    await page.goto("/availability");

    // Wait for week range text to load
    const weekRangeSpan = page.locator(".flex.items-center.gap-3 span");
    await expect(weekRangeSpan).toBeVisible({ timeout: 10000 });

    const initialText = await weekRangeSpan.textContent();

    // Click the next week button — second icon button in the week nav container
    const weekNav = page.locator(".flex.items-center.gap-3");
    await weekNav.locator("button").nth(1).click();

    // Wait for the week range text to change
    await expect(async () => {
      const newText = await weekRangeSpan.textContent();
      expect(newText).not.toBe(initialText);
    }).toPass({ timeout: 5000 });
  });

  test("opens grid dialog for editing", async ({ page }) => {
    await page.goto("/availability");

    // Wait for staff rows to load
    await expect(page.getByText("Staff Member")).toBeVisible({ timeout: 10000 });

    // Click the first edit button
    const editButtons = page.locator("table button").or(page.getByRole("button").filter({ hasText: /edit/i }));
    await editButtons.first().click();

    // Dialog should open with availability grid
    await expect(page.getByRole("heading", { name: /Edit Availability/ })).toBeVisible({
      timeout: 5000,
    });
    await expect(page.getByText("Morning")).toBeVisible();
    await expect(page.getByText("Afternoon")).toBeVisible();
  });

  test("toggle cell and save availability", async ({ page }) => {
    await page.goto("/availability");

    await expect(page.getByText("Staff Member")).toBeVisible({ timeout: 10000 });

    // Open grid dialog
    const editButtons = page.locator("table button").or(page.getByRole("button").filter({ hasText: /edit/i }));
    await editButtons.first().click();

    await expect(page.getByRole("heading", { name: /Edit Availability/ })).toBeVisible({
      timeout: 5000,
    });

    // Click a cell showing "—" to toggle to available
    const unavailableCell = page.getByText("—").first();
    if (await unavailableCell.isVisible()) {
      await unavailableCell.click();
      // Should now show "available"
      await expect(page.getByText("available").first()).toBeVisible();
    }

    // Save
    await page.getByRole("button", { name: "Save Availability" }).click();

    // Dialog should close
    await expect(page.getByRole("heading", { name: /Edit Availability/ })).not.toBeVisible({
      timeout: 5000,
    });
  });
});
