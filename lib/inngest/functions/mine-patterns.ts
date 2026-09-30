import { inngest } from "../client";
import type { InngestFunction } from "inngest";
import { db } from "@/lib/db";
import { eq, and, gte } from "drizzle-orm";
import { business, managerEdit, preferenceRule } from "@/lib/db/schema";
import { callWithFallback } from "@/lib/llm/fallback";
import { createLogger } from "@/lib/logging";

const logger = createLogger("mine-patterns");

export const minePatterns: InngestFunction.Any = inngest.createFunction(
  {
    id: "mine-patterns",
    triggers: [{ cron: "0 3 * * 1" }], // Monday 3am
  },
  async ({ step }: { step: any }) => {
    const businesses = await step.run("load-businesses", async () => {
      return db.query.business.findMany();
    });

    let totalRules = 0;

    for (const biz of businesses) {
      const rules = await step.run(`mine-${biz.id}`, async () => {
        // Fetch edits from last 4 weeks
        const fourWeeksAgo = new Date();
        fourWeeksAgo.setUTCDate(fourWeeksAgo.getUTCDate() - 28);

        const edits = await db.query.managerEdit.findMany({
          where: and(
            gte(managerEdit.createdAt, fourWeeksAgo),
          ),
          with: { staff: true, variation: true },
        });

        // Filter to this business's edits via the run relation
        // (managerEdit → run → business). Since we can't easily join here,
        // we'll check via variation's run.
        // For simplicity, fetch runs for this business
        const bizEdits = [];
        for (const edit of edits) {
          const run = await db.query.scheduleRun.findFirst({
            where: eq(
              (await import("@/lib/db/schema")).scheduleRun.id,
              edit.runId,
            ),
          });
          if (run?.businessId === biz.id) {
            bizEdits.push(edit);
          }
        }

        if (bizEdits.length < 3) {
          logger.info({ businessId: biz.id, editCount: bizEdits.length }, "not enough edits for mining");
          return [];
        }

        // Build summary for LLM
        const editSummaries = bizEdits.map((e) => ({
          staff: e.staff?.name ?? e.staffId,
          original: e.originalShift,
          newShift: e.newShift,
          reason: e.editReason ?? "none",
        }));

        const prompt = `Analyze these ${editSummaries.length} manager schedule edits from the last 4 weeks and identify recurring patterns or preferences:

${JSON.stringify(editSummaries, null, 2)}

Extract scheduling rules that appear across multiple edits. Each rule should be a human-readable constraint.

Return JSON: {"rules": [{"text": "...", "confidence": 0.0-1.0}]}
Only include rules supported by at least 2 edits. Return empty array if no clear patterns.`;

        const response = await callWithFallback({
          taskType: "pattern_mining",
          businessId: biz.id,
          prompt,
          systemPrompt:
            "You mine scheduling patterns from historical manager edits. Return valid JSON only.",
          jsonMode: true,
          temperature: 0,
        });

        try {
          const parsed = JSON.parse(response.content);
          return (parsed.rules ?? []) as Array<{
            text: string;
            confidence: number;
          }>;
        } catch {
          logger.warn({ content: response.content.slice(0, 200) }, "failed to parse pattern mining");
          return [];
        }
      });

      if (rules.length > 0) {
        const inserted = await step.run(`insert-${biz.id}`, async () => {
          // Dedup against existing rules
          const existing = await db.query.preferenceRule.findMany({
            where: eq(preferenceRule.businessId, biz.id),
          });
          const existingTexts = new Set(existing.map((r) => r.ruleText));

          let count = 0;
          for (const rule of rules) {
            if (existingTexts.has(rule.text)) continue;

            await db.insert(preferenceRule).values({
              businessId: biz.id,
              ruleText: rule.text,
              ruleType: "soft",
              source: "learned_from_edit",
              confidence: rule.confidence,
              active: false, // requires manager approval
            });
            count++;
          }
          return count;
        });

        totalRules += inserted;
      }
    }

    logger.info({ totalRules }, "pattern mining complete");
    return { totalRules };
  },
);
