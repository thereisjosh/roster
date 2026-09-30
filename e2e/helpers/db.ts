import dotenv from "dotenv";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../../lib/db/schema";

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });

let _testDb: NeonHttpDatabase<typeof schema> | null = null;

export function getTestDb() {
  if (!_testDb) {
    const sql = neon(process.env.DATABASE_URL!);
    _testDb = drizzle(sql, { schema });
  }
  return _testDb;
}

export const testDb = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(getTestDb(), prop, receiver);
  },
});

export async function cleanupTestUser(email: string) {
  const users = await testDb
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email));

  if (users.length === 0) return;

  const testUser = users[0];
  const businessId = testUser.businessId;

  if (businessId) {
    // Delete staff and related data
    const staffMembers = await testDb
      .select()
      .from(schema.staff)
      .where(eq(schema.staff.businessId, businessId));

    for (const s of staffMembers) {
      await testDb
        .delete(schema.availabilitySubmission)
        .where(eq(schema.availabilitySubmission.staffId, s.id));
      await testDb
        .delete(schema.conversationWindow)
        .where(eq(schema.conversationWindow.staffId, s.id));
    }

    // Delete schedule runs and related data
    const runs = await testDb
      .select()
      .from(schema.scheduleRun)
      .where(eq(schema.scheduleRun.businessId, businessId));

    for (const run of runs) {
      await testDb
        .delete(schema.managerEdit)
        .where(eq(schema.managerEdit.runId, run.id));
      await testDb
        .delete(schema.coverRequest)
        .where(eq(schema.coverRequest.scheduleRunId, run.id));
      await testDb
        .delete(schema.scheduleVariation)
        .where(eq(schema.scheduleVariation.runId, run.id));
    }

    await testDb
      .delete(schema.scheduleRun)
      .where(eq(schema.scheduleRun.businessId, businessId));
    await testDb
      .delete(schema.preferenceRule)
      .where(eq(schema.preferenceRule.businessId, businessId));
    await testDb
      .delete(schema.communicationLog)
      .where(eq(schema.communicationLog.businessId, businessId));
    await testDb
      .delete(schema.staff)
      .where(eq(schema.staff.businessId, businessId));
  }

  // Delete auth records
  await testDb
    .delete(schema.session)
    .where(eq(schema.session.userId, testUser.id));
  await testDb
    .delete(schema.account)
    .where(eq(schema.account.userId, testUser.id));
  await testDb.delete(schema.user).where(eq(schema.user.id, testUser.id));

  if (businessId) {
    await testDb
      .delete(schema.business)
      .where(eq(schema.business.id, businessId));
  }
}
