import dotenv from "dotenv";
import { defineConfig, devices } from "@playwright/test";
import path from "path";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const authFile = path.join(__dirname, ".auth", "user.json");

export default defineConfig({
  testDir: "./tests",
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: "html",
  outputDir: "./test-results",

  use: {
    baseURL: "http://localhost:3000",
    trace: "on-first-retry",
  },

  globalSetup: require.resolve("./global-setup"),
  globalTeardown: require.resolve("./global-teardown"),

  projects: [
    {
      name: "unauthenticated",
      testMatch: ["login.spec.ts", "signup.spec.ts"],
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "authenticated",
      testMatch: [
        "dashboard.spec.ts",
        "staff.spec.ts",
        "availability.spec.ts",
        "settings.spec.ts",
      ],
      use: {
        ...devices["Desktop Chrome"],
        storageState: authFile,
      },
    },
  ],

  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: true,
  },
});
