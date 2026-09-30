/**
 * Generator orchestrator — the core schedule generation pipeline.
 *
 * Connects inputs (staff, availability, config) to outputs (scheduleRun + 3 variations)
 * via LLM with fallback and validation.
 */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  scheduleRun,
  scheduleVariation,
  type ShiftAssignment,
} from "@/lib/db/schema";
import { callScheduleGeneration } from "@/lib/llm/schedule-client";
import { CostTracker } from "@/lib/llm/cost-tracker";
import { DrizzleCostTrackerStore } from "@/lib/db/stores/cost-tracker-store";
import type { LlmRequest } from "@/lib/llm/types";
import { createLogger } from "@/lib/logging";
import { assembleScheduleInput, type AssembledData } from "./assembler";

const logger = createLogger("schedule-gen");
import {
  buildSystemPrompt,
  buildUserPrompt,
  type VariationType,
} from "./prompt-builder";
import {
  validateHardConstraints,
  parseTimeToHours,
  type ScheduleInput,
  type ScheduleOutput,
  type Shift,
  type Assignment,
} from "./validator";
import { computeSlotMetrics, type SlotMetrics } from "./scorer-bridge";
import type { GenerationSnapshot } from "@/lib/db/schema";

const VARIATION_TYPES: VariationType[] = [
  "cost_optimised",
  "fairness_optimised",
  "balanced",
];

export interface GenerateResult {
  runId: string;
  status: "pending_review" | "escalated";
  variationIds: string[];
  totalLlmCostUsd: number;
}

/**
 * Generates a schedule for a given business and week.
 *
 * 1. Assembles input data from DB
 * 2. For each variation type, calls LLM with appropriate prompt
 * 3. Validates output, retries once on hard constraint failure
 * 4. Persists scheduleRun + 3 scheduleVariation rows
 * 5. Logs LLM costs
 */
export async function generateSchedule(
  businessId: string,
  weekStart: Date,
): Promise<GenerateResult> {
  const costTracker = new CostTracker(new DrizzleCostTrackerStore());

  // 1. Create the schedule run record (status: generating)
  const [run] = await db
    .insert(scheduleRun)
    .values({
      businessId,
      weekStart,
      status: "generating",
      promptVersion: "v1",
    })
    .returning();

  try {
    // 2. Assemble input data
    const assembled = await assembleScheduleInput(businessId, weekStart);

    // 2b. Persist generation snapshot for scoring
    await db
      .update(scheduleRun)
      .set({
        generationSnapshot: {
          input: assembled.input,
          config: assembled.config,
          preferenceRules: assembled.preferenceRules,
          weights: assembled.weights,
          weekStart: weekStart.toISOString().slice(0, 10),
        },
      })
      .where(eq(scheduleRun.id, run.id));

    // 3. Generate all 3 variations
    const variations: Array<{
      type: VariationType;
      assignments: ShiftAssignment[];
      totalCost: number;
      warnings: string[];
    }> = [];

    let totalLlmCostUsd = 0;
    const snapshot: GenerationSnapshot = {
      input: assembled.input,
      config: assembled.config,
      preferenceRules: assembled.preferenceRules,
      weights: assembled.weights,
      weekStart: weekStart.toISOString().slice(0, 10),
    };

    for (const variationType of VARIATION_TYPES) {
      const result = await generateVariation(
        businessId,
        assembled,
        variationType,
        costTracker,
      );
      variations.push(result.variation);
      totalLlmCostUsd += result.llmCostUsd;

      // Inline slot-scoring
      try {
        const sm = computeSlotMetrics(snapshot, result.variation.assignments);
        const pad = variationType.padEnd(18);
        const recallStr = sm.slotRecall != null ? ` recall=${sm.slotRecall.toFixed(2)}` : "";
        logger.info(
          { variationType, hoursOK: sm.hoursCompliance, minStaff: sm.minStaffCoverage, elig: sm.eligibilityCompliance, util: sm.staffUtilization, recall: sm.slotRecall, costUsd: result.llmCostUsd },
          "variation scored",
        );
      } catch (e) {
        logger.warn({ variationType, err: e }, "slot-scoring failed");
      }
    }

    logger.info({ totalLlmCostUsd, variations: VARIATION_TYPES.length }, "generation complete");

    // 4. Insert variation rows + update run status (atomic)
    const variationIds: string[] = await db.transaction(async (tx) => {
      const ids: string[] = [];
      for (const v of variations) {
        const [row] = await tx
          .insert(scheduleVariation)
          .values({
            runId: run.id,
            variationType: v.type,
            assignments: v.assignments,
            totalCost: v.totalCost,
            coverageWarnings: v.warnings.length > 0 ? v.warnings.join("; ") : null,
          })
          .returning();
        ids.push(row.id);
      }

      // 5. Update run status and cost
      await tx
        .update(scheduleRun)
        .set({
          status: "pending_review",
          costUsd: totalLlmCostUsd,
          updatedAt: new Date(),
        })
        .where(eq(scheduleRun.id, run.id));

      return ids;
    });

    return {
      runId: run.id,
      status: "pending_review",
      variationIds,
      totalLlmCostUsd,
    };
  } catch (error) {
    // All tiers failed — escalate
    await db
      .update(scheduleRun)
      .set({ status: "escalated", updatedAt: new Date() })
      .where(eq(scheduleRun.id, run.id));

    return {
      runId: run.id,
      status: "escalated",
      variationIds: [],
      totalLlmCostUsd: 0,
    };
  }
}

// ---------------------------------------------------------------------------
// Internal: Generate a single variation
// ---------------------------------------------------------------------------

async function generateVariation(
  businessId: string,
  assembled: AssembledData,
  variationType: VariationType,
  costTracker: CostTracker,
): Promise<{
  variation: {
    type: VariationType;
    assignments: ShiftAssignment[];
    totalCost: number;
    warnings: string[];
  };
  llmCostUsd: number;
}> {
  const { input, preferenceRules, weights, config, staffNames, wikiContext, relationships, staffSkills, compositionRules } = assembled;
  let llmCostUsd = 0;

  // Build name maps: UUID ↔ lowercase staff name for LLM-friendly IDs
  const { uuidToName, nameToUuid } = buildStaffNameMaps(staffNames);
  const namedInput = replaceStaffIds(input, uuidToName);

  // Map relationship staff IDs to names for LLM
  const namedRelationships = relationships?.map((r) => ({
    ...r,
    staffId1: uuidToName.get(r.staffId1) ?? r.staffId1,
    staffId2: r.staffId2 ? (uuidToName.get(r.staffId2) ?? r.staffId2) : null,
  } as typeof r));

  // Map skill staff IDs to names for LLM
  const namedSkills = staffSkills?.map((sk) => ({
    ...sk,
    staffId: uuidToName.get(sk.staffId) ?? sk.staffId,
  }));

  // Build prompt using named IDs
  const systemPrompt = buildSystemPrompt({
    input: namedInput,
    variationType,
    preferenceRules,
    config,
    wikiContext,
    relationships: namedRelationships,
    staffSkills: namedSkills,
    compositionRules,
  });
  const userPrompt = buildUserPrompt({
    input: namedInput,
    variationType,
    preferenceRules,
    weights,
    config,
    wikiContext,
    relationships: namedRelationships,
    staffSkills: namedSkills,
    compositionRules,
  });

  // Call LLM with structured outputs
  const maxTokens = 16384;
  const temperature = 0;

  logger.info({ variationType, systemLen: systemPrompt.length, userLen: userPrompt.length }, "prompt built");

  let response = await callScheduleGeneration({
    systemPrompt,
    userPrompt,
    maxTokens,
    temperature,
  });
  const costPer1MInput = 3.0;
  const costPer1MOutput = 15.0;
  let responseCostUsd =
    (response.inputTokens / 1_000_000) * costPer1MInput +
    (response.outputTokens / 1_000_000) * costPer1MOutput;
  llmCostUsd += responseCostUsd;

  logger.info({ variationType, inputTokens: response.inputTokens, outputTokens: response.outputTokens, costUsd: responseCostUsd, latencyMs: response.latencyMs }, "LLM response");

  await costTracker.logCall(
    { taskType: "schedule_generation", businessId, prompt: userPrompt, systemPrompt, rosterSize: input.staff.length },
    { content: response.content, model: "claude-sonnet-4-6", inputTokens: response.inputTokens, outputTokens: response.outputTokens, costUsd: responseCostUsd, latencyMs: response.latencyMs, tier: "primary" },
    true,
  );

  // Parse (using named IDs), restore UUIDs, then validate
  let parsed = parseScheduleOutput(response.content, namedInput);
  restoreStaffIds(parsed, nameToUuid);
  let validation = validateHardConstraints(input, parsed, config);

  // Retry once if hard constraints failed
  if (!validation.passed) {
    logger.warn({ variationType, violations: validation.violations }, "validation failed");
    const retryPrompt = buildUserPrompt({
      input: namedInput,
      variationType,
      preferenceRules,
      weights,
      config,
      retryViolations: validation.violations,
    });

    response = await callScheduleGeneration({
      systemPrompt,
      userPrompt: retryPrompt,
      maxTokens,
      temperature,
    });
    responseCostUsd =
      (response.inputTokens / 1_000_000) * costPer1MInput +
      (response.outputTokens / 1_000_000) * costPer1MOutput;
    llmCostUsd += responseCostUsd;

    logger.info({ variationType, retry: true, inputTokens: response.inputTokens, outputTokens: response.outputTokens, costUsd: responseCostUsd, latencyMs: response.latencyMs }, "LLM retry response");

    await costTracker.logCall(
      { taskType: "schedule_generation", businessId, prompt: retryPrompt, systemPrompt, rosterSize: input.staff.length },
      { content: response.content, model: "claude-sonnet-4-6", inputTokens: response.inputTokens, outputTokens: response.outputTokens, costUsd: responseCostUsd, latencyMs: response.latencyMs, tier: "primary" },
      true,
    );

    parsed = parseScheduleOutput(response.content, namedInput);
    restoreStaffIds(parsed, nameToUuid);
    validation = validateHardConstraints(input, parsed, config);
  }

  // Transform assignments to ShiftAssignment[] format
  const shiftMap = new Map(input.shifts.map((s) => [s.id, s]));
  const staffMap = new Map(input.staff.map((s) => [s.id, s]));

  const assignments: ShiftAssignment[] = parsed.assignments.map((a) => {
    const shift = shiftMap.get(a.shiftId);
    const staffMember = staffMap.get(a.staffId);
    const startTime = a.startTime ?? shift?.startTime ?? "00:00";
    const endTime = a.endTime ?? shift?.endTime ?? "00:00";
    const hours = parseTimeToHours(endTime) - parseTimeToHours(startTime);
    const hourlyRate = staffMember?.hourlyRate ?? 0;

    return {
      staffId: a.staffId,
      staffName: staffNames.get(a.staffId) ?? a.staffId,
      day: a.date ?? shift?.date ?? "",
      shiftType: a.role ?? shift?.requiredRole ?? "",
      startTime,
      endTime,
      cost: hours * hourlyRate,
    };
  });

  const totalCost = assignments.reduce((sum, a) => sum + a.cost, 0);
  const rawWarnings: string[] = [
    ...(parsed.warnings ?? []),
    ...(!validation.passed ? validation.violations : []),
  ];

  // Replace UUIDs with human-readable staff names in warnings
  const warnings = rawWarnings.map(w => {
    let msg = w;
    for (const [id, name] of staffNames) {
      msg = msg.replaceAll(id, name);
    }
    return msg;
  });

  return {
    variation: {
      type: variationType,
      assignments,
      totalCost,
      warnings,
    },
    llmCostUsd,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts slot-level assignments (hours arrays) to shift-level assignments
 * that the validator and DB schema expect.
 *
 * Slot format:  { staffId, role, date, hours: [11, 12, 13] }
 * Shift format: { shiftId, staffId, date, startTime, endTime, role }
 */
function convertSlotToShiftAssignments(
  slotAssignments: Array<{ staffId: string; role: string; date: string; hours: number[] }>,
  input: ScheduleInput,
): Assignment[] {
  const results: Assignment[] = [];

  // Build a lookup of shifts by date+role for efficient matching
  const shiftsByDateRole = new Map<string, Shift[]>();
  for (const shift of input.shifts) {
    const key = shift.date + "|" + shift.requiredRole;
    if (!shiftsByDateRole.has(key)) shiftsByDateRole.set(key, []);
    shiftsByDateRole.get(key)!.push(shift);
  }

  for (const sa of slotAssignments) {
    if (!sa.hours || !Array.isArray(sa.hours) || sa.hours.length === 0) continue;
    const sortedHours = [...sa.hours].sort((a, b) => a - b);

    // Match each hour to its shift first, then group within each shift
    const candidateShifts = shiftsByDateRole.get(sa.date + "|" + sa.role) ?? [];
    const hoursByShift = new Map<string, { shift: Shift; hours: number[] }>();

    for (const hour of sortedHours) {
      let matched: Shift | undefined;
      for (const shift of candidateShifts) {
        const shiftStart = parseTimeToHours(shift.startTime);
        const shiftEnd = parseTimeToHours(shift.endTime);
        if (hour >= shiftStart && hour < shiftEnd) {
          matched = shift;
          break;
        }
      }

      if (matched) {
        if (!hoursByShift.has(matched.id)) hoursByShift.set(matched.id, { shift: matched, hours: [] });
        hoursByShift.get(matched.id)!.hours.push(hour);
      } else {
        // No matching shift — create a standalone assignment for this hour
        const fallbackId = sa.date + "-" + sa.role + "-" + String(hour).padStart(2, "0") + ":00";
        if (!hoursByShift.has(fallbackId)) hoursByShift.set(fallbackId, { shift: undefined as unknown as Shift, hours: [] });
        hoursByShift.get(fallbackId)!.hours.push(hour);
      }
    }

    // Group contiguous hours within each shift into runs
    for (const [shiftId, { shift, hours }] of hoursByShift) {
      const sorted = hours.sort((a, b) => a - b);
      const runs: number[][] = [];
      let currentRun = [sorted[0]];
      for (let i = 1; i < sorted.length; i++) {
        if (sorted[i] === currentRun[currentRun.length - 1] + 1) {
          currentRun.push(sorted[i]);
        } else {
          runs.push(currentRun);
          currentRun = [sorted[i]];
        }
      }
      runs.push(currentRun);

      for (const run of runs) {
        const startHour = run[0];
        const endHour = run[run.length - 1] + 1;
        const startTime = String(startHour).padStart(2, "0") + ":00";
        const endTime = String(endHour).padStart(2, "0") + ":00";

        results.push({
          shiftId: shift ? shift.id : shiftId,
          staffId: sa.staffId,
          date: sa.date,
          startTime,
          endTime,
          role: sa.role,
        });
      }
    }
  }
  return results;
}

function extractJson(raw: string): string {
  let content = raw
    .replace(/^```(?:json)?\s*\n?/gm, "")
    .replace(/\n?\s*```\s*$/gm, "")
    .trim();
  const i = content.indexOf("{");
  const j = content.lastIndexOf("}");
  return i !== -1 && j > i ? content.substring(i, j + 1) : content;
}

function parseScheduleOutput(content: string, input: ScheduleInput): ScheduleOutput {
  const cleaned = extractJson(content);
  try {
    const parsed = JSON.parse(cleaned);
    const rawAssignments = parsed.assignments ?? [];

    // Detect slot-level format (has `hours` array) vs shift-level format (has `shiftId`)
    const isSlotFormat = rawAssignments.length > 0 && Array.isArray(rawAssignments[0]?.hours);

    const assignments = isSlotFormat
      ? convertSlotToShiftAssignments(rawAssignments, input)
      : rawAssignments;

    return {
      assignments,
      unfilledShifts: parsed.unfilledShifts ?? [],
      warnings: parsed.warnings ?? [],
      metadata: parsed.metadata,
    };
  } catch (e) {
    logger.error({ err: e instanceof Error ? e.message : e, raw: content.slice(0, 500) }, "parse failed");
    // If we got deterministic fallback output, adapt it
    try {
      const fallback = JSON.parse(cleaned);
      if (fallback.method === "greedy_constraint_solver") {
        return {
          assignments: fallback.assignments ?? [],
          unfilledShifts: [],
          warnings: ["Generated by deterministic fallback solver"],
        };
      }
    } catch {
      // ignore
    }
    return { assignments: [], unfilledShifts: [], warnings: ["Failed to parse LLM output"] };
  }
}

// ---------------------------------------------------------------------------
// Staff name mapping helpers
// ---------------------------------------------------------------------------

/**
 * Builds bidirectional maps between UUIDs and lowercase staff names.
 * Handles duplicate names with suffix (e.g. "wilson", "wilson-2").
 */
function buildStaffNameMaps(staffNames: Map<string, string>): {
  uuidToName: Map<string, string>;
  nameToUuid: Map<string, string>;
} {
  const uuidToName = new Map<string, string>();
  const nameToUuid = new Map<string, string>();
  const nameCounts = new Map<string, number>();

  for (const [uuid, displayName] of staffNames) {
    const baseName = displayName.toLowerCase().replace(/\s+/g, "-");
    const count = (nameCounts.get(baseName) ?? 0) + 1;
    nameCounts.set(baseName, count);
    const name = count === 1 ? baseName : `${baseName}-${count}`;
    uuidToName.set(uuid, name);
    nameToUuid.set(name, uuid);
  }

  return { uuidToName, nameToUuid };
}

/**
 * Returns a shallow clone of input with all staff[].id fields replaced via idMap.
 */
function replaceStaffIds(input: ScheduleInput, idMap: Map<string, string>): ScheduleInput {
  return {
    ...input,
    staff: input.staff.map((s) => ({
      ...s,
      id: idMap.get(s.id) ?? s.id,
    })),
  };
}

/**
 * Mutates parsed output to restore UUIDs from named staff IDs.
 */
function restoreStaffIds(parsed: ScheduleOutput, nameToUuid: Map<string, string>): void {
  for (const a of parsed.assignments) {
    a.staffId = nameToUuid.get(a.staffId) ?? a.staffId;
  }
}
