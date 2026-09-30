/**
 * Knowledge base ingest — creates/updates pages after edits and approvals.
 */

import { eq, and, gte } from "drizzle-orm";
import { db } from "@/lib/db";
import { managerEdit, scheduleRun, staff as staffTable } from "@/lib/db/schema";
import { upsertPage, getPage, getPagesByType } from "./store";
import type { PageMetadata, PairEvidence, ShiftHistoryEntry } from "./types";
import { createLogger } from "@/lib/logging";

const logger = createLogger("knowledge-ingest");

/**
 * Ingest a manager edit into the knowledge base.
 * Called after preference extraction in the extract-preferences Inngest function.
 */
export async function ingestManagerEdit(
  businessId: string,
  editId: string,
  staffId: string,
  staffName: string,
  originalShift: string,
  newShift: string,
  reason: string | null,
  extractedRules: Array<{ text: string; confidence: number }>,
): Promise<void> {
  const staffSlug = `staff/${staffName.toLowerCase().replace(/\s+/g, "-")}`;

  // 1. Update staff page with edit log
  const staffPage = await getPage(businessId, staffSlug);
  if (staffPage) {
    const editEntry = `- ${new Date().toISOString().slice(0, 10)}: Moved from ${originalShift} → ${newShift}${reason ? ` (${reason})` : ""}`;
    const updatedContent = staffPage.content.replace(
      "## Observed Patterns",
      `${editEntry}\n\n## Observed Patterns`,
    );
    await upsertPage(businessId, staffSlug, {
      pageType: "staff",
      title: staffPage.title,
      content: updatedContent,
      metadata: staffPage.metadata as PageMetadata,
    });
  }

  // 2. Create rule pages for extracted rules
  for (const rule of extractedRules) {
    const ruleSlug = `rule/${editId.slice(0, 8)}-${extractedRules.indexOf(rule)}`;
    const content = [
      `# ${rule.text}`,
      "",
      `- **Confidence:** ${rule.confidence}`,
      `- **Source:** Extracted from manager edit`,
      `- **Edit:** ${originalShift} → ${newShift} for ${staffName}`,
      `- **Staff:** [[${staffSlug}]]`,
      reason ? `- **Reason:** ${reason}` : "",
    ]
      .filter(Boolean)
      .join("\n");

    await upsertPage(businessId, ruleSlug, {
      pageType: "rule",
      title: rule.text,
      content,
      metadata: {
        staffIds: [staffId],
        confidence: rule.confidence,
        ruleType: "soft",
      },
    });
  }

  // 3. Append to edit log page
  const logSlug = "log/edits";
  const logPage = await getPage(businessId, logSlug);
  const logEntry = `| ${new Date().toISOString().slice(0, 10)} | ${staffName} | ${originalShift} → ${newShift} | ${reason ?? "-"} | ${extractedRules.length} rules |`;

  if (logPage) {
    const updatedContent = logPage.content + "\n" + logEntry;
    await upsertPage(businessId, logSlug, {
      pageType: "log",
      title: "Edit Log",
      content: updatedContent,
      metadata: logPage.metadata as PageMetadata,
    });
  } else {
    const content = [
      "# Edit Log",
      "",
      "| Date | Staff | Change | Reason | Rules Extracted |",
      "|------|-------|--------|--------|-----------------|",
      logEntry,
    ].join("\n");
    await upsertPage(businessId, logSlug, {
      pageType: "log",
      title: "Edit Log",
      content,
    });
  }

  logger.info({ businessId, editId, staffId }, "manager edit ingested into KB");
}

/**
 * Update staff pages with shift history after a schedule is approved.
 */
export async function ingestApprovedSchedule(
  businessId: string,
  weekStart: string,
  assignments: Array<{
    staffId: string;
    staffName: string;
    day: string;
    shiftType: string;
    startTime: string;
    endTime: string;
  }>,
): Promise<void> {
  // Group assignments by staff
  const byStaff = new Map<string, typeof assignments>();
  for (const a of assignments) {
    const list = byStaff.get(a.staffId) ?? [];
    list.push(a);
    byStaff.set(a.staffId, list);
  }

  for (const [staffId, staffAssignments] of byStaff) {
    const staffName = staffAssignments[0].staffName;
    const staffSlug = `staff/${staffName.toLowerCase().replace(/\s+/g, "-")}`;
    const staffPage = await getPage(businessId, staffSlug);
    if (!staffPage) continue;

    const historyEntry = staffAssignments
      .map((a) => `  - ${a.day}: ${a.shiftType} ${a.startTime}-${a.endTime}`)
      .join("\n");

    const historySection = `\n- **Week ${weekStart}:**\n${historyEntry}`;

    const updatedContent = staffPage.content.replace(
      "_No history yet — will be populated after schedule approvals._",
      historySection,
    ).replace(
      "## Observed Patterns",
      `${historySection}\n\n## Observed Patterns`,
    );

    // Update metadata with shift history
    const metadata = { ...staffPage.metadata } as PageMetadata;
    const entry: ShiftHistoryEntry = {
      weekStart,
      assignments: staffAssignments.map((a) => ({
        day: a.day,
        shift: `${a.shiftType} ${a.startTime}-${a.endTime}`,
        hours: parseFloat(a.endTime) - parseFloat(a.startTime),
      })),
    };
    metadata.shiftHistory = [...(metadata.shiftHistory ?? []), entry];

    await upsertPage(businessId, staffSlug, {
      pageType: "staff",
      title: staffPage.title,
      content: updatedContent,
      metadata,
    });
  }

  logger.info({ businessId, weekStart, staffCount: byStaff.size }, "approved schedule ingested");
}

/**
 * Detect pair dynamics from manager edits.
 * Looks for patterns where the same two staff are repeatedly separated or combined.
 */
export async function detectPairDynamics(businessId: string): Promise<number> {
  const fourWeeksAgo = new Date();
  fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28);

  // Fetch recent edits for this business
  const edits = await db.query.managerEdit.findMany({
    where: gte(managerEdit.createdAt, fourWeeksAgo),
    with: { staff: true },
  });

  // Filter to this business's edits
  const bizEdits: Array<{
    id: string;
    staffId: string;
    staffName: string;
    originalShift: string;
    newShift: string;
    createdAt: Date;
    runId: string;
  }> = [];

  for (const edit of edits) {
    const run = await db.query.scheduleRun.findFirst({
      where: eq(scheduleRun.id, edit.runId),
    });
    if (run?.businessId === businessId) {
      bizEdits.push({
        id: edit.id,
        staffId: edit.staffId,
        staffName: edit.staff?.name ?? edit.staffId,
        originalShift: edit.originalShift,
        newShift: edit.newShift,
        createdAt: edit.createdAt,
        runId: edit.runId,
      });
    }
  }

  // Group edits by run to find edits in the same schedule
  const editsByRun = new Map<string, typeof bizEdits>();
  for (const edit of bizEdits) {
    const list = editsByRun.get(edit.runId) ?? [];
    list.push(edit);
    editsByRun.set(edit.runId, list);
  }

  // Look for separation patterns: in the same run, staff A moved off a shift
  // where staff B remains (or vice versa)
  const pairCounts = new Map<string, { count: number; evidence: PairEvidence[]; names: [string, string] }>();

  for (const [, runEdits] of editsByRun) {
    if (runEdits.length < 2) continue;

    for (let i = 0; i < runEdits.length; i++) {
      for (let j = i + 1; j < runEdits.length; j++) {
        const a = runEdits[i];
        const b = runEdits[j];

        // Check if edits involve moving staff away from each other's shifts
        const aMovedFromBShift =
          a.originalShift === b.originalShift || a.originalShift === b.newShift;
        const bMovedFromAShift =
          b.originalShift === a.originalShift || b.originalShift === a.newShift;

        if (aMovedFromBShift || bMovedFromAShift) {
          const key = [a.staffId, b.staffId].sort().join("::");
          const existing = pairCounts.get(key) ?? { count: 0, evidence: [], names: [a.staffName, b.staffName] };
          existing.count++;
          existing.evidence.push({
            editId: a.id,
            date: a.createdAt.toISOString().slice(0, 10),
            description: `${a.staffName} and ${b.staffName} separated in schedule edit`,
          });
          pairCounts.set(key, existing);
        }
      }
    }
  }

  // Create pair pages for pairs with 2+ separations
  let pairsCreated = 0;
  for (const [key, data] of pairCounts) {
    if (data.count < 2) continue;

    const [staffId1, staffId2] = key.split("::");
    const [name1, name2] = data.names;
    const slug = `pair/${name1.toLowerCase().replace(/\s+/g, "-")}-${name2.toLowerCase().replace(/\s+/g, "-")}`;

    const existingPage = await getPage(businessId, slug);
    if (existingPage?.metadata && (existingPage.metadata as PageMetadata).rejectedAt) {
      continue; // Manager dismissed this pair signal
    }

    const content = [
      `# Pair Dynamics: ${name1} & ${name2}`,
      "",
      `**Type:** Friction (separation pattern)`,
      `**Weight:** ${data.count}`,
      `**Status:** ${existingPage ? "Updated" : "New — pending review"}`,
      "",
      "## Evidence",
      "",
      ...data.evidence.map((e) => `- ${e.date}: ${e.description}`),
      "",
      "## Staff Links",
      "",
      `- [[staff/${name1.toLowerCase().replace(/\s+/g, "-")}]]`,
      `- [[staff/${name2.toLowerCase().replace(/\s+/g, "-")}]]`,
    ].join("\n");

    const metadata: PageMetadata = {
      staffIds: [staffId1, staffId2],
      pairType: "friction",
      weight: data.count,
      evidence: data.evidence,
    };

    await upsertPage(businessId, slug, {
      pageType: "pair",
      title: `Pair: ${name1} & ${name2}`,
      content,
      metadata,
    });
    pairsCreated++;
  }

  logger.info({ businessId, pairsCreated }, "pair dynamics detection complete");
  return pairsCreated;
}

/**
 * Create/update a staff page when a staff member is created or updated.
 */
export async function ingestStaffChange(
  businessId: string,
  staffId: string,
  staffName: string,
  employmentType: string,
  level: number,
  roles: string[],
  isActive: boolean,
): Promise<void> {
  const slug = `staff/${staffName.toLowerCase().replace(/\s+/g, "-")}`;

  if (!isActive) {
    // Archive: mark the page content as archived
    const existing = await getPage(businessId, slug);
    if (existing) {
      await upsertPage(businessId, slug, {
        pageType: "staff",
        title: `${staffName} (archived)`,
        content: `_This staff member is no longer active._\n\n${existing.content}`,
        metadata: { ...existing.metadata as PageMetadata, staffIds: [staffId] },
      });
    }
    return;
  }

  const existing = await getPage(businessId, slug);
  const content = [
    `# ${staffName}`,
    "",
    `- **Employment:** ${employmentType.replace("_", " ")}`,
    `- **Level:** ${level}`,
    `- **Roles:** ${roles.join(", ") || "none"}`,
    "",
    "## Shift History",
    "",
    existing?.content.includes("**Week ")
      ? existing.content.split("## Shift History\n\n")[1]?.split("\n\n## Observed")[0] ?? "_No history yet — will be populated after schedule approvals._"
      : "_No history yet — will be populated after schedule approvals._",
    "",
    "## Observed Patterns",
    "",
    existing?.content.includes("## Observed Patterns")
      ? existing.content.split("## Observed Patterns\n\n")[1]?.split("\n\n## Related")[0] ?? "_No patterns detected yet._"
      : "_No patterns detected yet._",
    "",
    "## Related Rules",
    "",
    "_No rules linked yet._",
  ].join("\n");

  await upsertPage(businessId, slug, {
    pageType: "staff",
    title: staffName,
    content,
    metadata: { staffIds: [staffId] },
  });
}
