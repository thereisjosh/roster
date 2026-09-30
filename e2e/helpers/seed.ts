import { eq } from "drizzle-orm";
import { testDb } from "./db";
import * as schema from "../../lib/db/schema";
import { getDefaultConfig } from "../../lib/config-defaults";

export async function getTestBusinessId(email: string): Promise<string> {
  const users = await testDb
    .select()
    .from(schema.user)
    .where(eq(schema.user.email, email));

  if (users.length === 0) throw new Error(`No user found for ${email}`);
  if (!users[0].businessId) throw new Error(`User ${email} has no business`);

  return users[0].businessId;
}

export async function seedBusinessConfig(businessId: string) {
  await testDb
    .update(schema.business)
    .set({ config: getDefaultConfig() })
    .where(eq(schema.business.id, businessId));
}

export async function seedStaff(businessId: string, count: number = 3) {
  const staffNames = ["Alice Johnson", "Bob Smith", "Carol White", "Dan Brown", "Eve Davis"];
  const inserted: (typeof schema.staff.$inferSelect)[] = [];

  for (let i = 0; i < count; i++) {
    const rows = await testDb
      .insert(schema.staff)
      .values({
        businessId,
        name: staffNames[i % staffNames.length],
        email: `staff-${i}@test.roster.local`,
        employmentType: "part_time",
        isActive: true,
        roles: [],
      })
      .returning();
    inserted.push(rows[0]);
  }

  return inserted;
}
