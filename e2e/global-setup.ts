import { chromium, type FullConfig } from "@playwright/test";
import path from "path";
import fs from "fs";
import { TEST_USER } from "./helpers/auth";

const authDir = path.join(__dirname, ".auth");
const authFile = path.join(authDir, "user.json");
const testUserFile = path.join(authDir, "test-user.json");

export default async function globalSetup(_config: FullConfig) {
  fs.mkdirSync(authDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  // Sign up the test user via the UI
  await page.goto("http://localhost:3000/signup");
  await page.getByLabel("Your name").fill(TEST_USER.name);
  await page.getByLabel("Email").fill(TEST_USER.email);
  await page.getByLabel("Password").fill(TEST_USER.password);
  await page.getByLabel("Business name").fill(TEST_USER.businessName);
  await page.getByRole("button", { name: "Create account" }).click();

  // Wait for redirect to dashboard
  await page.waitForURL("**/dashboard", { timeout: 30000 });

  // Save auth state for authenticated tests
  await page.context().storageState({ path: authFile });

  // Persist test user email for teardown
  fs.writeFileSync(testUserFile, JSON.stringify({ email: TEST_USER.email }));

  await browser.close();
}
