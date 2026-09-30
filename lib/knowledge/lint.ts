/**
 * Knowledge base lint — periodic checks for stale, orphaned, or contradicting pages.
 */

import { eq, and } from "drizzle-orm";
import { db } from "@/lib/db";
import { staff as staffTable } from "@/lib/db/schema";
import { getPagesByType, deletePage, upsertPage, getPage } from "./store";
import type { KnowledgePage, PageMetadata } from "./types";
import { callWithFallback } from "@/lib/llm/fallback";
import { applyDecay, checkGraduations } from "@/lib/relationships/lifecycle";
import { decayStaleSkillRules, updateSkillProficiency } from "@/lib/skills/lifecycle";
import { createLogger } from "@/lib/logging";

const logger = createLogger("knowledge-lint");

export interface LintResult {
  staleRules: string[];
  orphanedRefs: string[];
  contradictions: string[];
  decayedPairs: string[];
  inactiveStaffRefs: string[];
}

/**
 * Run lint checks on the knowledge base for a business.
 */
export async function lintKnowledgeBase(businessId: string): Promise<LintResult> {
  const result: LintResult = {
    staleRules: [],
    orphanedRefs: [],
    contradictions: [],
    decayedPairs: [],
    inactiveStaffRefs: [],
  };

  // 1. Check for rules referencing inactive staff
  const staffPages = await getPagesByType(businessId, "staff");
  const rulePages = await getPagesByType(businessId, "rule");
  const pairPages = await getPagesByType(businessId, "pair");

  const activeStaff = await db.query.staff.findMany({
    where: and(eq(staffTable.businessId, businessId), eq(staffTable.isActive, true)),
  });
  const activeStaffIds = new Set(activeStaff.map((s) => s.id));

  // Check rule pages for inactive staff references
  for (const page of rulePages) {
    const meta = page.metadata as PageMetadata;
    if (meta.staffIds) {
      const hasInactive = meta.staffIds.some((id) => !activeStaffIds.has(id));
      if (hasInactive) {
        result.inactiveStaffRefs.push(page.slug);
      }
    }
  }

  // 2. Check for stale rules (not updated in 8+ weeks)
  const eightWeeksAgo = new Date();
  eightWeeksAgo.setUTCDate(eightWeeksAgo.getUTCDate() - 56);

  for (const page of rulePages) {
    if (page.updatedAt < eightWeeksAgo) {
      result.staleRules.push(page.slug);
    }
  }

  // 3. Check pair dynamics for decay (not reinforced in 6+ weeks)
  const sixWeeksAgo = new Date();
  sixWeeksAgo.setUTCDate(sixWeeksAgo.getUTCDate() - 42);

  for (const page of pairPages) {
    const meta = page.metadata as PageMetadata;
    if (meta.rejectedAt) continue; // Already dismissed
    if (page.updatedAt < sixWeeksAgo && (meta.weight ?? 0) < 3) {
      result.decayedPairs.push(page.slug);

      // Decay the weight
      const newWeight = Math.max(0, (meta.weight ?? 1) - 1);
      if (newWeight === 0) {
        await deletePage(businessId, page.slug);
      } else {
        await upsertPage(businessId, page.slug, {
          pageType: "pair",
          title: page.title,
          content: page.content,
          metadata: { ...meta, weight: newWeight },
        });
      }
    }
  }

  // 4. Check for orphaned cross-references
  const allPages = [...staffPages, ...rulePages, ...pairPages];
  const allSlugs = new Set(allPages.map((p) => p.slug));

  for (const page of allPages) {
    const refs = page.content.match(/\[\[([^\]]+)\]\]/g) ?? [];
    for (const ref of refs) {
      const slug = ref.slice(2, -2);
      if (!allSlugs.has(slug)) {
        result.orphanedRefs.push(`${page.slug} → ${slug}`);
      }
    }
  }

  // 5. Detect contradictions using LLM (only if there are enough rules)
  if (rulePages.length >= 3) {
    try {
      const ruleTexts = rulePages.map((p) => p.title);
      const response = await callWithFallback({
        taskType: "knowledge_lint",
        businessId,
        prompt: `These are scheduling preference rules for a business. Identify any contradictions (rules that conflict with each other).

Rules:
${ruleTexts.map((t, i) => `${i + 1}. ${t}`).join("\n")}

Return JSON: {"contradictions": [{"rule1": 1, "rule2": 3, "reason": "..."}]}
Return empty array if no contradictions found.`,
        systemPrompt: "You detect contradictions in scheduling rules. Return valid JSON only.",
        jsonMode: true,
        temperature: 0,
      });

      const parsed = JSON.parse(response.content);
      for (const c of parsed.contradictions ?? []) {
        const r1 = rulePages[c.rule1 - 1];
        const r2 = rulePages[c.rule2 - 1];
        if (r1 && r2) {
          result.contradictions.push(`${r1.slug} vs ${r2.slug}: ${c.reason}`);
        }
      }
    } catch (err) {
      logger.warn({ err }, "contradiction detection failed");
    }
  }

  // 6. Apply relationship and preference rule decay
  const decayResult = await applyDecay(businessId);
  result.decayedPairs.push(...decayResult.decayedRelationships, ...decayResult.deletedRelationships);

  // 7. Check for graduation candidates (training relationships)
  const graduations = await checkGraduations(businessId);
  if (graduations.length > 0) {
    logger.info(
      { businessId, graduationCandidates: graduations.length },
      "training relationships may have graduated",
    );
  }

  // 8. Skill lifecycle — stale rules and proficiency updates
  await decayStaleSkillRules(businessId);
  await updateSkillProficiency(businessId);

  logger.info(
    {
      businessId,
      staleRules: result.staleRules.length,
      orphanedRefs: result.orphanedRefs.length,
      contradictions: result.contradictions.length,
      decayedPairs: result.decayedPairs.length,
      inactiveStaffRefs: result.inactiveStaffRefs.length,
    },
    "knowledge base lint complete",
  );

  return result;
}
