import path from "path";
import fs from "fs";
import { cleanupTestUser } from "./helpers/db";

const testUserFile = path.join(__dirname, ".auth", "test-user.json");

export default async function globalTeardown() {
  if (!fs.existsSync(testUserFile)) return;

  const { email } = JSON.parse(fs.readFileSync(testUserFile, "utf-8"));
  await cleanupTestUser(email);

  // Clean up auth artifacts
  fs.rmSync(path.join(__dirname, ".auth"), { recursive: true, force: true });
}
