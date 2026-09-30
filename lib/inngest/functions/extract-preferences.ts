import { inngest } from "../client";
import type { InngestFunction } from "inngest";
import { db } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { managerEdit, preferenceRule, staff, staffSkill } from "@/lib/db/schema";
import { callWithFallback } from "@/lib/llm/fallback";
import { ingestManagerEdit } from "@/lib/knowledge/ingest";
import { detectPairFromEdit } from "@/lib/relationships/detect";
import { extractManagerSignals } from "@/lib/skills/extract";
import { getExistingTags } from "@/lib/skills/query";
import { createLogger } from "@/lib/logging";

const logger = createLogger("extract-preferences");

export const extractPreferences: InngestFunction.Any = inngest.createFunction(
  {
    id: "extract-preferences",
    triggers: [{ event: "schedule/edit.recorded" }],
  },
  async ({ event, step }: { event: any; step: any }) => {
    const { editId, businessId } = event.data as {
      editId: string;
      businessId: string;
    };

    const rules = await step.run("extract", async () => {
      const edit = await db.query.managerEdit.findFirst({
        where: eq(managerEdit.id, editId),
        with: { staff: true },
      });

      if (!edit) {
        logger.warn({ editId }, "edit not found");
        return [];
      }

      // Skip if already processed
      if (edit.extractedRules && edit.extractedRules !== "") {
        return [];
      }

      const staffMember = edit.staff;
      const prompt = `A manager edited a schedule:
- Staff: ${staffMember?.name ?? edit.staffId}
- Original shift: ${edit.originalShift}
- New shift: ${edit.newShift}
- Reason: ${edit.editReason ?? "not provided"}

Extract scheduling preference rules from this edit. Each rule should be a human-readable constraint.
For example: "Sarah prefers morning shifts", "John should not work Sundays", "Alice works best paired with Bob".

Return JSON: {"rules": [{"text": "...", "confidence": 0.0-1.0}]}
Only include rules you're reasonably confident about. Return empty array if no clear pattern.`;

      const response = await callWithFallback({
        taskType: "preference_extraction",
        businessId,
        prompt,
        systemPrompt:
          "You extract scheduling preference rules from manager edits. Return valid JSON only.",
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
        logger.warn({ content: response.content.slice(0, 200) }, "failed to parse preference extraction");
        return [];
      }
    });

    if (rules.length > 0) {
      await step.run("insert-rules", async () => {
        for (const rule of rules) {
          await db.insert(preferenceRule).values({
            businessId,
            ruleText: rule.text,
            ruleType: "soft",
            source: "learned_from_edit",
            confidence: rule.confidence,
            active: rule.confidence >= 0.7,
          });
        }

        // Mark edit as processed
        await db
          .update(managerEdit)
          .set({ extractedRules: JSON.stringify(rules.map((r: { text: string; confidence: number }) => r.text)) })
          .where(eq(managerEdit.id, editId));
      });
    }

    // Ingest into knowledge base
    if (rules.length > 0) {
      await step.run("ingest-kb", async () => {
        const edit = await db.query.managerEdit.findFirst({
          where: eq(managerEdit.id, editId),
          with: { staff: true },
        });
        if (edit) {
          await ingestManagerEdit(
            businessId,
            editId,
            edit.staffId,
            edit.staff?.name ?? edit.staffId,
            edit.originalShift,
            edit.newShift,
            edit.editReason,
            rules,
          );
        }
      });
    }

    // Detect pair dynamics from this edit
    await step.run("detect-pairs", async () => {
      const edit = await db.query.managerEdit.findFirst({
        where: eq(managerEdit.id, editId),
      });
      if (edit) {
        await detectPairFromEdit(
          businessId,
          editId,
          edit.staffId,
          edit.originalShift,
          edit.newShift,
          edit.runId,
          edit.editReason,
        );
      }
    });

    // Extract skill/relationship/rule signals from edit reason text
    await step.run("extract-signals", async () => {
      const edit = await db.query.managerEdit.findFirst({
        where: eq(managerEdit.id, editId),
        with: { staff: true },
      });
      if (!edit?.editReason) return;

      const allStaff = await db.query.staff.findMany({
        where: and(eq(staff.businessId, businessId), eq(staff.isActive, true)),
      });
      const existingTags = await getExistingTags(businessId);

      const signals = await extractManagerSignals(edit.editReason, {
        businessId,
        staffNames: allStaff.map((s) => s.name),
        shiftTypes: [], // shift types not easily available here
        existingTags,
      });

      logger.info(
        {
          editId,
          skills: signals.skills.length,
          relationships: signals.relationships.length,
          rules: signals.rules.length,
        },
        "signals extracted from edit reason",
      );
    });

    logger.info({ editId, rulesExtracted: rules.length }, "preference extraction complete");
    return { editId, rulesExtracted: rules.length };
  },
);
