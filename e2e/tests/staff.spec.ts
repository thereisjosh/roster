import { test, expect } from "@playwright/test";

test.describe.configure({ mode: "serial" });

const staffName = `Staff ${Date.now()}`;
const editedName = `${staffName} Edited`;

test.describe("Staff page", () => {
  test("shows page heading", async ({ page }) => {
    await page.goto("/staff");

    await expect(page.getByRole("heading", { name: "Staff" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Add Staff" })
    ).toBeVisible();
  });

  test("add staff member", async ({ page }) => {
    await page.goto("/staff");

    await page.getByRole("button", { name: "Add Staff" }).click();
    await expect(
      page.getByRole("heading", { name: "Add Staff Member" })
    ).toBeVisible();

    await page.getByLabel("Name *").fill(staffName);
    await page.getByRole("button", { name: "Add Staff" }).click();

    // Wait for dialog to close and row to appear
    await expect(page.getByRole("cell", { name: staffName })).toBeVisible({
      timeout: 10000,
    });
  });

  test("edit staff member", async ({ page }) => {
    await page.goto("/staff");

    // Wait for the staff row to load
    await expect(page.getByRole("cell", { name: staffName })).toBeVisible({
      timeout: 10000,
    });

    // Click edit button in the row containing our staff member
    const row = page.getByRole("row").filter({ hasText: staffName });
    await row.getByRole("button").first().click();

    await expect(
      page.getByRole("heading", { name: "Edit Staff Member" })
    ).toBeVisible();

    await page.getByLabel("Name *").fill(editedName);
    await page.getByRole("button", { name: "Save Changes" }).click();

    await expect(page.getByRole("cell", { name: editedName })).toBeVisible({
      timeout: 10000,
    });
  });

  test("deactivate staff member", async ({ page }) => {
    await page.goto("/staff");

    await expect(page.getByRole("cell", { name: editedName })).toBeVisible({
      timeout: 10000,
    });

    const row = page.getByRole("row").filter({ hasText: editedName });
    // Second button in the actions column is deactivate
    await row.getByRole("button").nth(1).click();

    await expect(
      page.getByRole("heading", { name: "Deactivate Staff Member" })
    ).toBeVisible();

    await page.getByRole("button", { name: "Deactivate" }).click();

    // After deactivation, the status badge should show Inactive
    await expect(row.getByText("Inactive")).toBeVisible({ timeout: 10000 });
  });
});
