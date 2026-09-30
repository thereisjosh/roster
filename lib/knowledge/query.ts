/**
 * Knowledge base query — retrieves structured WikiContext for schedule generation.
 */

import { queryRelevantPages, getPagesByType } from "./store";
import type { KnowledgePage, WikiContext, WikiRule, PairDynamic, PageMetadata } from "./types";
import { createLogger } from "@/lib/logging";

const logger = createLogger("knowledge-query");

/**
 * Query the knowledge base for context relevant to a schedule generation.
 * Returns null if no KB pages exist for this business (fallback to flat rules).
 */
export async function queryForGeneration(
  businessId: string,
  staffIds: string[],
  weekDates: string[],
): Promise<WikiContext | null> {
  // Convert dates to day-of-week numbers for metadata matching
  const days = weekDates.map((d) => new Date(d + "T00:00:00Z").getUTCDay());

  const pages = await queryRelevantPages(businessId, staffIds, days);

  if (pages.length === 0) {
    return null;
  }

  const hardRules: WikiRule[] = [];
  const softRules: WikiRule[] = [];
  const staffContext = new Map<string, string>();
  const pairDynamics: PairDynamic[] = [];

  for (const page of pages) {
    const meta = (page.metadata ?? {}) as PageMetadata;

    switch (page.pageType) {
      case "rule":
        processRulePage(page, meta, hardRules, softRules);
        break;
      case "staff":
        processStaffPage(page, meta, staffContext);
        break;
      case "pair":
        // Pair dynamics now come from staff_relationship table, not knowledge pages.
        // Skip processing pair pages — they are retained for historical reference only.
        break;
    }
  }

  logger.info(
    {
      businessId,
      staffCount: staffIds.length,
      hardRules: hardRules.length,
      softRules: softRules.length,
      staffContextEntries: staffContext.size,
      pairDynamics: pairDynamics.length,
      totalPages: pages.length,
    },
    "wiki context assembled for generation",
  );

  return { hardRules, softRules, staffContext, pairDynamics, pages };
}

function processRulePage(
  page: KnowledgePage,
  meta: PageMetadata,
  hardRules: WikiRule[],
  softRules: WikiRule[],
): void {
  const ruleType = meta.ruleType ?? "soft";
  const rule: WikiRule = {
    ruleText: page.title,
    ruleType,
    confidence: meta.confidence ?? 1.0,
    sourceSlug: page.slug,
  };

  if (ruleType === "hard") {
    hardRules.push(rule);
  } else {
    softRules.push(rule);
  }
}

function processStaffPage(
  page: KnowledgePage,
  meta: PageMetadata,
  staffContext: Map<string, string>,
): void {
  if (!meta.staffIds || meta.staffIds.length === 0) return;

  const staffId = meta.staffIds[0];

  // Extract context lines from the page content
  const lines: string[] = [];

  // Extract patterns section
  const patternsMatch = page.content.match(
    /## Observed Patterns\n\n([\s\S]*?)(?:\n\n##|$)/,
  );
  if (patternsMatch && !patternsMatch[1].includes("_No patterns")) {
    const patternLines = patternsMatch[1]
      .split("\n")
      .filter((l) => l.startsWith("- "))
      .map((l) => l.slice(2).trim());
    lines.push(...patternLines);
  }

  // Extract recent shift history patterns from metadata
  if (meta.patterns && meta.patterns.length > 0) {
    lines.push(...meta.patterns);
  }

  if (lines.length > 0) {
    staffContext.set(staffId, lines.join(". "));
  }
}

function processPairPage(
  page: KnowledgePage,
  meta: PageMetadata,
  pairDynamics: PairDynamic[],
): void {
  if (!meta.staffIds || meta.staffIds.length < 2) return;
  if (meta.rejectedAt) return; // Manager dismissed this

  pairDynamics.push({
    staffId1: meta.staffIds[0],
    staffId2: meta.staffIds[1],
    type: meta.pairType ?? "friction",
    weight: meta.weight ?? 1,
    evidence: meta.evidence ?? [],
    confirmed: meta.confidence === 1.0,
  });
}
