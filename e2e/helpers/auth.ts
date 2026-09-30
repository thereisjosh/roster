import fs from "fs";
import path from "path";

const testUserFile = path.join(__dirname, "..", ".auth", "test-user.json");

function getTestEmail(): string {
  // In test workers, read the email saved by global-setup
  if (fs.existsSync(testUserFile)) {
    return JSON.parse(fs.readFileSync(testUserFile, "utf-8")).email;
  }
  // In global-setup (first run), generate a unique email
  return `e2e-${Date.now()}@test.roster.local`;
}

export const TEST_USER = {
  name: "E2E Test User",
  email: getTestEmail(),
  password: "TestPassword123!",
  businessName: "E2E Business",
};
