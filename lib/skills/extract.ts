/**
 * Natural language extraction — manager utterances → structured skill/relationship/rule signals.
 *
 * Primary capture mechanism. Extraction results are surfaced for manager confirmation
 * before being committed to the database.
 */

import { callWithFallback } from "@/lib/llm/fallback";
import { createLogger } from "@/lib/logging";

const logger = createLogger("skill-extract");

export interface SkillExtractionResult {
  skills: {
    staffName: string | null;
    tag: string;
    shiftType: string | null;
    isRequirement: boolean;
    proficiencySignal: "strong" | "adequate" | "developing" | null;
    rawEvidence: string;
  }[];
  relationships: {
    staffName1: string;
    staffName2: string | null;
    semantics: "separate" | "pair";
    label: string;
    rawEvidence: string;
  }[];
  rules: {
    ruleText: string;
    ruleType: "soft" | "hard" | "temporary";
    rawEvidence: string;
  }[];
  uncertainties: string[];
}

export async function extractManagerSignals(
  utterance: string,
  context: {
    businessId: string;
    staffNames: string[];
    shiftTypes: string[];
    existingTags: string[];
  },
): Promise<SkillExtractionResult> {
  const prompt = `Extract structured scheduling signals from this manager statement.

MANAGER SAID: "${utterance}"

CONTEXT:
- Staff names: ${context.staffNames.join(", ") || "none known"}
- Shift types: ${context.shiftTypes.join(", ") || "none known"}
- Existing skill tags: ${context.existingTags.join(", ") || "none yet"}

INSTRUCTIONS:
1. Extract any skills mentioned (staff capabilities, certifications, language abilities).
2. Extract any relationship signals (friction, mentorship, pairing preferences).
3. Extract any scheduling rules (preferences, constraints).
4. For skill tags: check existingTags first. If the new tag means the same thing as an existing tag (e.g. "coffee machine" ≈ "espresso machine"), use the existing tag verbatim. This prevents duplicates.
5. For proficiencySignal: "strong" = explicitly skilled/expert, "adequate" = can do it, "developing" = learning/new to it, null = no signal.

Return JSON:
{
  "skills": [{ "staffName": string|null, "tag": string, "shiftType": string|null, "isRequirement": boolean, "proficiencySignal": "strong"|"adequate"|"developing"|null, "rawEvidence": string }],
  "relationships": [{ "staffName1": string, "staffName2": string|null, "semantics": "separate"|"pair", "label": string, "rawEvidence": string }],
  "rules": [{ "ruleText": string, "ruleType": "soft"|"hard"|"temporary", "rawEvidence": string }],
  "uncertainties": [string]
}

Only include items you're reasonably confident about. Return empty arrays if no clear signals.`;

  try {
    const response = await callWithFallback({
      taskType: "preference_extraction",
      businessId: context.businessId,
      prompt,
      systemPrompt:
        "You extract structured scheduling signals from manager statements. Return valid JSON only.",
      jsonMode: true,
      temperature: 0,
    });

    const parsed = JSON.parse(response.content);
    return {
      skills: parsed.skills ?? [],
      relationships: parsed.relationships ?? [],
      rules: parsed.rules ?? [],
      uncertainties: parsed.uncertainties ?? [],
    };
  } catch (err) {
    logger.warn({ err, utterance: utterance.slice(0, 200) }, "extraction failed");
    return { skills: [], relationships: [], rules: [], uncertainties: [] };
  }
}
