/**
 * Seed script — populates the database with example café data
 * for testing the full schedule generation loop.
 *
 * Usage: npm run db:seed
 */

import fs from "fs";
import dotenv from "dotenv";
import path from "path";
import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { eq } from "drizzle-orm";
import * as schema from "../lib/db/schema";
import type { BusinessConfig, PayStructure, AvailabilitySlot } from "../lib/db/schema";

dotenv.config({ path: path.resolve(__dirname, "..", ".env") });

const sql = neon(process.env.DATABASE_URL!);
const db = drizzle(sql, { schema });

// ---------------------------------------------------------------------------
// Business config
// ---------------------------------------------------------------------------

const cafeConfig: BusinessConfig = {
  weekStartDay: 1,
  availabilityDeadlineDay: 5,
  availabilityDeadlineHour: 18,
  reminderIntervals: [48, 24],
  operatingHours: {
    "0": { open: "09:00", close: "21:00" },
    "1": { open: "11:00", close: "21:00" },
    "3": { open: "11:00", close: "21:00" },
    "4": { open: "11:00", close: "21:00" },
    "5": { open: "11:00", close: "21:00" },
    "6": { open: "09:00", close: "21:00" },
  },
  closedDays: [2], // Tuesday
  coverageRequirements: [
    { role: "barista", days: [1, 3, 4, 5], startTime: "11:00", endTime: "15:00", minStaff: 1, maxStaff: 3 },
    { role: "barista", days: [1, 3, 4, 5], startTime: "15:00", endTime: "21:00", minStaff: 2, maxStaff: 5 },
    { role: "chef",    days: [1, 3, 4, 5], startTime: "11:00", endTime: "20:00", minStaff: 1, maxStaff: 2 },
    { role: "barista", days: [0, 6],       startTime: "09:00", endTime: "15:00", minStaff: 2, maxStaff: 5 },
    { role: "barista", days: [6],          startTime: "15:00", endTime: "21:00", minStaff: 2, maxStaff: 5 },
    { role: "barista", days: [0],          startTime: "15:00", endTime: "21:00", minStaff: 1, maxStaff: 6 },
    { role: "chef",    days: [0, 6],       startTime: "09:00", endTime: "20:00", minStaff: 1, maxStaff: 2 },
  ],
  fullTimeHours: { min: 40, target: 44, max: 48 },
  breakRules: [
    { name: "Lunch", durationMinutes: 60 },
    { name: "Dinner", durationMinutes: 60 },
  ],
  breakDeduction: { enabled: true, appliesTo: "full-time" },
  maxConsecutiveDays: 6,
  minRestHoursBetweenShifts: 10,
  costWeight: 0.25,
  fairnessWeight: 0.25,
  preferenceWeight: 0.35,
};

// ---------------------------------------------------------------------------
// Staff definitions
// ---------------------------------------------------------------------------

interface StaffDef {
  name: string;
  employmentType: "full_time" | "part_time" | "casual";
  level: number;
  roles: string[];
  payStructure: PayStructure;
}

const salariedPay = (monthly: number, hourlyEst: number): PayStructure => ({
  payType: "salaried",
  monthlySalary: monthly,
  baseHourlyRate: hourlyEst,
});

const hourlyPay = (rate: number): PayStructure => ({
  payType: "hourly",
  baseHourlyRate: rate,
});

const staffDefs: StaffDef[] = [
  // Full-time chefs
  { name: "Hau",       employmentType: "full_time",  level: 2, roles: ["chef"], payStructure: salariedPay(2601, 15.63) },
  { name: "Mei Wah",   employmentType: "full_time",  level: 2, roles: ["chef"], payStructure: salariedPay(2601, 15.63) },
  // L2 baristas
  { name: "Wilson",    employmentType: "part_time",   level: 2, roles: ["barista"], payStructure: hourlyPay(11) },
  { name: "Geri",      employmentType: "part_time",   level: 2, roles: ["barista"], payStructure: hourlyPay(11) },
  { name: "Kexin",     employmentType: "part_time",   level: 2, roles: ["barista"], payStructure: hourlyPay(12) },
  { name: "Elisabeth", employmentType: "part_time",   level: 2, roles: ["barista"], payStructure: hourlyPay(11) },
  { name: "Keryn",     employmentType: "part_time",   level: 2, roles: ["barista"], payStructure: hourlyPay(11) },
  // L1 baristas
  { name: "Clemens",   employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(10) },
  { name: "Matteus",   employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(10) },
  { name: "Rachael",   employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(11) },
  { name: "Jun Hui",   employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(11) },
  { name: "Jared",     employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(11) },
  { name: "Ulfah",     employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(11) },
  { name: "Elynn",     employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(11) },
  { name: "Kai Qi",    employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(10) },
  { name: "Cheryl",    employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(10) },
  { name: "Denice",    employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(10) },
  { name: "Chelsy",    employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(10) },
  { name: "Ying En",   employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(10) },
  { name: "Odelia",    employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(11) },
  { name: "Jolynn",    employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(10) },
  { name: "Wan Jie",   employmentType: "part_time",   level: 1, roles: ["barista"], payStructure: hourlyPay(10) },
];

// ---------------------------------------------------------------------------
// Preference rules
// ---------------------------------------------------------------------------

const preferenceRules: { ruleType: "hard" | "soft"; ruleText: string }[] = [
  { ruleType: "hard", ruleText: "Level 1 (L1) staff must always be paired with a Level 2 (L2) or Manager on the same shift for supervision" },
  { ruleType: "hard", ruleText: "Full-time staff must be scheduled for at least 2 weekend shifts per week" },
  { ruleType: "soft", ruleText: "During peak lunch period (11:30-14:00), prioritise having more staff on shift" },
  { ruleType: "soft", ruleText: "During peak dinner period (18:00-20:30), prioritise having more staff on shift" },
];

// ---------------------------------------------------------------------------
// Availability from golden eval data (6 weeks)
// ---------------------------------------------------------------------------

function slot(day: string, startTime: string, endTime: string): AvailabilitySlot {
  return { day, startTime, endTime, preference: "available" };
}

// Golden files → target week starts (most recent first)
const GOLDEN_WEEK_MAPPING: { file: string; goldenStart: string; targetStart: string }[] = [
  { file: "week-23feb.json", goldenStart: "2026-02-23", targetStart: "2026-04-27" },
  { file: "week-2mar.json",  goldenStart: "2026-03-02", targetStart: "2026-04-20" },
  { file: "week-9mar.json",  goldenStart: "2026-03-09", targetStart: "2026-04-13" },
  { file: "week-16mar.json", goldenStart: "2026-03-16", targetStart: "2026-04-06" },
  { file: "week-23mar.json", goldenStart: "2026-03-23", targetStart: "2026-03-30" },
  { file: "week-30mar.json", goldenStart: "2026-03-30", targetStart: "2026-03-23" },
];

// Staff names in the seed that we want to match from golden data
const SEED_STAFF_NAMES = new Set(staffDefs.map((s) => s.name));

/**
 * Re-date a day string from the golden week to the target week,
 * preserving the day-of-week offset from the week start.
 */
function redateDay(originalDay: string, goldenStart: string, targetStart: string): string {
  const orig = new Date(originalDay + "T00:00:00Z");
  const gStart = new Date(goldenStart + "T00:00:00Z");
  const offsetMs = orig.getTime() - gStart.getTime();
  const tStart = new Date(targetStart + "T00:00:00Z");
  const newDate = new Date(tStart.getTime() + offsetMs);
  return newDate.toISOString().slice(0, 10);
}

interface GoldenStaffEntry {
  id: string;
  name: string;
  availability?: { day: string; startTime: string; endTime: string }[];
}

/**
 * Load golden data and build availability per target week.
 * Returns: Map<targetWeekStart, Map<staffName, AvailabilitySlot[]>>
 */
function loadGoldenAvailability(): Map<string, Map<string, AvailabilitySlot[]>> {
  const goldenDir = path.resolve(__dirname, "..", "evals", "golden", "schedules");
  const result = new Map<string, Map<string, AvailabilitySlot[]>>();

  for (const mapping of GOLDEN_WEEK_MAPPING) {
    const filePath = path.join(goldenDir, mapping.file);
    if (!fs.existsSync(filePath)) {
      console.warn(`Golden file not found: ${filePath}`);
      continue;
    }
    const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    const staffMap = new Map<string, AvailabilitySlot[]>();

    for (const s of (data.staff ?? []) as GoldenStaffEntry[]) {
      // Normalize name variants from golden data to match seed staffDefs
      let name = s.name;
      if (name === "Kaiqi") name = "Kai Qi";

      if (!SEED_STAFF_NAMES.has(name) || !s.availability?.length) continue;
      const slots = s.availability.map((a) =>
        slot(redateDay(a.day, mapping.goldenStart, mapping.targetStart), a.startTime, a.endTime),
      );
      staffMap.set(name, slots);
    }

    result.set(mapping.targetStart, staffMap);
  }

  return result;
}

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

async function seed() {
  // Find the current logged-in user to get their business
  const users = await db.select().from(schema.user);
  if (users.length === 0) {
    console.error("No user found. Please sign up at localhost:3000 first.");
    process.exit(1);
  }

  const owner = users[0];
  let businessId = owner.businessId;

  if (!businessId) {
    // Create a business for the user
    const [biz] = await db
      .insert(schema.business)
      .values({ name: "Example Café", config: cafeConfig })
      .returning();
    businessId = biz.id;
    await db
      .update(schema.user)
      .set({ businessId })
      .where(eq(schema.user.id, owner.id));
    console.log(`Created business: ${biz.name} (${biz.id})`);
  } else {
    // Update existing business config
    await db
      .update(schema.business)
      .set({ config: cafeConfig, name: "Example Café" })
      .where(eq(schema.business.id, businessId));
    console.log(`Updated business config for ${businessId}`);
  }

  // Clean existing staff, rules, and availability for this business
  const existingStaff = await db
    .select()
    .from(schema.staff)
    .where(eq(schema.staff.businessId, businessId));

  for (const s of existingStaff) {
    await db
      .delete(schema.availabilitySubmission)
      .where(eq(schema.availabilitySubmission.staffId, s.id));
  }
  await db
    .delete(schema.staff)
    .where(eq(schema.staff.businessId, businessId));
  await db
    .delete(schema.preferenceRule)
    .where(eq(schema.preferenceRule.businessId, businessId));

  // Insert staff
  const insertedStaff = await db
    .insert(schema.staff)
    .values(
      staffDefs.map((s) => ({
        businessId: businessId!,
        name: s.name,
        employmentType: s.employmentType,
        level: s.level,
        roles: s.roles,
        payStructure: s.payStructure,
      })),
    )
    .returning();

  console.log(`Inserted ${insertedStaff.length} staff members`);

  // Build name -> id map
  const staffIdByName = new Map(insertedStaff.map((s) => [s.name, s.id]));

  // Insert preference rules
  const insertedRules = await db
    .insert(schema.preferenceRule)
    .values(
      preferenceRules.map((r) => ({
        businessId: businessId!,
        ruleText: r.ruleText,
        ruleType: r.ruleType,
        source: "manager_explicit" as const,
        confidence: 1.0,
      })),
    )
    .returning();

  console.log(`Inserted ${insertedRules.length} preference rules`);

  // Insert availability submissions from golden eval data (6 weeks)
  const goldenAvailability = loadGoldenAvailability();
  let submissionCount = 0;

  for (const [targetWeekStart, staffAvailMap] of goldenAvailability) {
    const weekStartDate = new Date(targetWeekStart + "T00:00:00Z");
    for (const [name, slots] of staffAvailMap) {
      const staffId = staffIdByName.get(name);
      if (!staffId) continue;

      await db.insert(schema.availabilitySubmission).values({
        staffId,
        weekStart: weekStartDate,
        status: "submitted",
        slots,
        submittedAt: new Date(),
      });
      submissionCount++;
    }
  }

  console.log(
    `Seeded ${insertedStaff.length} staff, ${insertedRules.length} rules, and ${submissionCount} availability submissions across ${goldenAvailability.size} weeks`,
  );
}

seed().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
