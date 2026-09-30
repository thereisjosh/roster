import { test, expect } from "@playwright/test";

test.describe("Settings page", () => {
  test("shows heading and business info", async ({ page }) => {
    await page.goto("/settings");

    await expect(
      page.getByRole("heading", { name: "Settings" })
    ).toBeVisible();
    await expect(page.getByText(/E2E Business/)).toBeVisible({ timeout: 10000 });
    await expect(page.getByText(/Asia\/Singapore/)).toBeVisible();
    await expect(page.getByText(/trial/i)).toBeVisible();
  });

  test("shows all 4 tabs", async ({ page }) => {
    await page.goto("/settings");

    await expect(page.getByRole("tab", { name: "Rules" })).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByRole("tab", { name: "Availability" })
    ).toBeVisible();
    await expect(
      page.getByRole("tab", { name: "Shift Types" })
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Weights" })).toBeVisible();
  });

  test("rules tab shows scheduling fields", async ({ page }) => {
    await page.goto("/settings");

    // Rules tab is default
    await expect(page.getByText("Max Shifts Per Week")).toBeVisible({
      timeout: 10000,
    });
    await expect(
      page.getByText("Min Rest Hours Between Shifts")
    ).toBeVisible();
    await expect(
      page.getByText("Overtime Threshold (hours/week)")
    ).toBeVisible();
  });

  test("shift types tab shows defaults and add button", async ({ page }) => {
    await page.goto("/settings");

    await page.getByRole("tab", { name: "Shift Types" }).click();

    await expect(page.locator('input[value="Morning"]')).toBeVisible({
      timeout: 10000,
    });
    await expect(page.locator('input[value="Afternoon"]')).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add Shift Type" })
    ).toBeVisible();

    // Click add and verify new empty row appears
    await page.getByRole("button", { name: "Add Shift Type" }).click();
    await expect(page.getByPlaceholder("Shift name").last()).toHaveValue("");
  });

  test("save configuration persists changes", async ({ page }) => {
    await page.goto("/settings");

    // Wait for rules tab to load
    await expect(page.getByText("Max Shifts Per Week")).toBeVisible({
      timeout: 10000,
    });

    // Change max shifts per week
    const maxShiftsInput = page.locator('input[type="number"]').first();
    await maxShiftsInput.fill("4");

    // Save
    await page.getByRole("button", { name: "Save Configuration" }).click();

    // Wait for success toast
    await expect(page.getByText("Configuration saved")).toBeVisible({
      timeout: 10000,
    });

    // Reload and verify the value persists
    await page.reload();
    await expect(page.getByText("Max Shifts Per Week")).toBeVisible({
      timeout: 10000,
    });
    await expect(maxShiftsInput).toHaveValue("4");
  });
});
