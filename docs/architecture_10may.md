Here's the full agentic architecture showing how all the systems compose:
                                                 
  ╔══════════════════════════════════════════════════════════════════════════════════╗
  ║                          ROSTER AGENTIC ARCHITECTURE                            ║                                                                      
  ╚══════════════════════════════════════════════════════════════════════════════════╝
                                                                                                                                                           
                                WEEKLY CYCLE                                                                                                             
      ┌─────────┐     ┌─────────┐     ┌─────────┐     ┌─────────┐                                    
      │ COLLECT  │────▶│GENERATE │────▶│DISTRIBUTE│────▶│  COVER  │
      │  Loop 1  │     │ Loop 2  │     │  Loop 3  │     │ Loop 4  │
      └─────────┘     └────┬────┘     └──────────┘     └─────────┘
                           │                                │
                           │         ┌─────────┐            │
                           └────────▶│  LEARN   │◀───────────┘
                                     │ Loop 5   │
                                     └──────────┘

  ═══════════════════════════════════════════════════════════════════════════════════
                          SCHEDULE GENERATION PIPELINE (Loop 2)
  ═══════════════════════════════════════════════════════════════════════════════════

    schedule.generate tRPC mutation
           │
           ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                     ASSEMBLER (lib/scheduling/assembler.ts)         │
    │                                                                     │
    │  Fetches from DB:                                                   │
    │  ┌──────────┐ ┌───────────────┐ ┌──────────┐ ┌──────────────────┐  │
    │  │  Staff    │ │ Availability  │ │ Business │ │ Preference Rules │  │
    │  │ profiles  │ │ submissions   │ │  config  │ │  (all active)    │  │
    │  └──────────┘ └───────────────┘ └──────────┘ └──────────────────┘  │
    │                                                                     │
    │  Computes:                                                          │
    │  ┌──────────────────────────────────────────────────────────────┐   │
    │  │            ELIGIBILITY HARNESS (deterministic, 0 tokens)     │   │
    │  │                                                              │   │
    │  │  For each staff × each shift slot:                           │   │
    │  │    ✓ Has matching role?                                      │   │
    │  │    ✓ Availability overlaps ≥ 3 hours?                        │   │
    │  │    ✓ Under max weekly hours?                                 │   │
    │  │    ✓ Meets rest hours requirement?                           │   │
    │  │    ✓ Under max consecutive days?                             │   │
    │  │                                                              │   │
    │  │  Output: eligibility matrix (who CAN work where)             │   │
    │  │  The LLM never sees ineligible options — can't hallucinate   │   │
    │  │  impossible assignments                                      │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    └────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │              PROMPT BUILDER (lib/scheduling/prompt-builder.ts)       │
    │                                                                     │
    │  Composes context for LLM:                                          │
    │                                                                     │
    │  ┌─ HARD CONSTRAINTS (from validator) ──────────────────────────┐   │
    │  │  "Coverage: min 2 staff per shift"                           │   │
    │  │  "Max 5 consecutive days"                                    │   │
    │  │  "Min 10 hours rest between shifts"                          │   │
    │  │  These are NON-NEGOTIABLE. LLM must satisfy all.             │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    │                                                                     │
    │  ┌─ PREFERENCE RULES (from preferenceRule table) ───────────────┐   │
    │  │  MUST: "Alice cannot work Tuesdays" (hard rule, conf 0.95)   │   │
    │  │  PREFER: "Bob prefers morning shifts" (soft rule, conf 0.6)  │   │
    │  │  PREFER: "Don't pair Wilson with Ke Xin" (conf 0.7)         │   │
    │  │  These are BEST-EFFORT. LLM may violate if hard constraints  │   │
    │  │  force a tradeoff.                                           │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    │                                                                     │
    │  ┌─ KNOWLEDGE BASE CONTEXT (from knowledgePage) ────────────────┐   │
    │  │  Staff pages: "Alice has physio on Tuesdays"                 │   │
    │  │  Pair pages: "Wilson/Ke Xin — friction, separated 4x"       │   │
    │  │  Pattern pages: "Weekend AM shifts always understaffed"      │   │
    │  │  Rich narrative context the LLM uses for reasoning           │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    │                                                                     │
    │  ┌─ RELATIONSHIP GRAPH (from staffRelationship) ────────────────┐   │
    │  │  Structured edges: friction, affinity, mentorship             │   │
    │  │  "Wilson ←friction→ Ke Xin (weight 0.8, reinforced 3x)"     │   │
    │  │  Used for pairing/separation decisions                        │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    │                                                                     │
    │  ┌─ SKILL COMPOSITION (from staffSkill + shiftCompositionRule) ─┐   │
    │  │  "Closing shift requires ≥1 staff with 'senior_barista'      │   │
    │  │   at proficiency ≥ 3"                                        │   │
    │  │  "Sunday brunch requires ≥1 'latte_art' skilled staff"       │   │
    │  │  Deterministic validation, also fed to LLM as context        │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    │                                                                     │
    │  × 3 variation prompts:                                             │
    │    cost_optimised  │  fairness_optimised  │  balanced               │
    └────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │                    LLM ORCHESTRATION LAYER                          │
    │                                                                     │
    │  ┌─ ROUTER (lib/llm/router.ts) ────────────────────────────────┐   │
    │  │  schedule_generation → Claude Sonnet 4.5                     │   │
    │  │  preference_extraction → Claude Haiku 4.5                    │   │
    │  │  classification → GPT-4.1-Nano ($0.10/1M)                   │   │
    │  │  pattern_mining → Gemini 2.5 Pro (batch)                     │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    │                                                                     │
    │  ┌─ THREE-TIER FALLBACK (lib/llm/fallback.ts) ─────────────────┐   │
    │  │  Tier 1: Primary LLM (cheapest viable)                      │   │
    │  │  Tier 2: Fallback LLM (more expensive, higher reliability)  │   │
    │  │  Tier 3: Deterministic solver (greedy assignment, 0 tokens)  │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    │                                                                     │
    │  ┌─ HEALTH MONITOR (lib/llm/health.ts) ────────────────────────┐   │
    │  │  5-min sliding window per model                              │   │
    │  │  Auto-routes away from degraded models                       │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    │                                                                     │
    │  Output: structured JSON (assignments, warnings, metadata)          │
    └────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │              POST-GENERATION VALIDATION                             │
    │                                                                     │
    │  ┌─ HARD CONSTRAINT VALIDATOR (lib/scheduling/validator.ts) ────┐   │
    │  │  Re-checks all 5 constraints against LLM output              │   │
    │  │  Violation? → retry (up to 2x) → deterministic fallback      │   │
    │  │  This is a GATE — hard constraint violations are rejected     │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    │                                                                     │
    │  ┌─ COMPLIANCE CHECKER (❌ NOT YET BUILT) ──────────────────────┐   │
    │  │  Compare assignments against active preference rules          │   │
    │  │  Score each rule: followed / violated                         │   │
    │  │  If violated, check: was it forced by hard constraints?       │   │
    │  │  This is OBSERVATIONAL — violations become warnings,          │   │
    │  │  never block the schedule. Best fit > no fit.                 │   │
    │  │                                                               │   │
    │  │  Output feeds → REINFORCEMENT WRITER (❌ NOT YET BUILT)      │   │
    │  │    Rule followed → boost confidence, update lastReinforcedAt  │   │
    │  │    Rule violated (forced) → no change                         │   │
    │  │    Rule violated (avoidable) → flag, slight confidence drop   │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    │                                                                     │
    │  ┌─ SCORER (evals/scorers/) ────────────────────────────────────┐   │
    │  │  Coverage %, fairness (Gini coefficient), hours compliance    │   │
    │  └──────────────────────────────────────────────────────────────┘   │
    └────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
                    db.transaction() → persist 3 variations
                             │
                             ▼
                    Manager reviews in UI (Gantt, comparison, warnings)
                             │
                             ▼
                    Approves one variation → edits → finalises

  ═══════════════════════════════════════════════════════════════════════════════════
                       LEARNING LOOP (Loop 5) — THE COMPOUNDING BRAIN
  ═══════════════════════════════════════════════════════════════════════════════════

    Manager edits schedule (moves Wilson off Tuesday shift, reason: "coverage")
           │
           ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │  EXTRACT (✅ BUILT)                                                 │
    │                                                                     │
    │  recordEdit mutation → fires Inngest event →                        │
    │  extract-preferences function → LLM extracts rules:                 │
    │    "Wilson should not work Tuesday closing" (conf 0.6, soft)        │
    │                                                                     │
    │  mine-patterns function (weekly) → analyses 4+ weeks of edits →     │
    │    "Weekend AM shifts consistently understaffed" (pattern rule)      │
    │                                                                     │
    │  Relationship detection → edit patterns reveal:                      │
    │    Staff X always moved off Staff Y's shifts → candidate signal     │
    │    (needs reason text or LLM to classify as friction vs. coverage)  │
    │                                                                     │
    │  Skill extraction → "Wilson tagged 'senior_barista' prof 4"         │
    └────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │  STORE                                                              │
    │                                                                     │
    │  preferenceRule     → ruleText, ruleType, source, confidence        │
    │  staffRelationship  → staffId1↔staffId2, semantics, weight          │
    │  staffSkill         → staffId, tag, proficiency                     │
    │  knowledgePage      → wiki-style narrative context                  │
    │  shiftCompositionRule → "closing needs 1x senior_barista"           │
    └────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │  INJECT (✅ BUILT)                                                  │
    │                                                                     │
    │  Next schedule generation → assembler queries all active rules →    │
    │  prompt builder formats as MUST/PREFER → LLM sees full context      │
    └────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │  DECAY (✅ BUILT)                                                   │
    │                                                                     │
    │  lifecycle.ts runs periodically:                                    │
    │    Rules not reinforced in 6 weeks → confidence decreases           │
    │    Rules below threshold → deactivated                              │
    │    Rules expired → removed                                          │
    └────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
    ┌─────────────────────────────────────────────────────────────────────┐
    │  VERIFY & REINFORCE (❌ NOT YET BUILT — THE GAP)                   │
    │                                                                     │
    │  After generation, compliance checker would:                        │
    │    "Alice not on Tuesday" → ✅ followed → boost confidence           │
    │    "Don't pair Wilson/Ke Xin" → ❌ violated → why?                  │
    │      → hard constraint forced it (only qualified staff) → no change │
    │      → avoidable → flag for manager, slight confidence drop         │
    │                                                                     │
    │  WITHOUT THIS: extract → inject → decay → forget                   │
    │  WITH THIS:    extract → inject → verify → reinforce → compound    │
    │                                                                     │
    │  The difference between a write-only log and a compounding brain.   │
    └─────────────────────────────────────────────────────────────────────┘

  ═══════════════════════════════════════════════════════════════════════════════════
                DETERMINISTIC vs LLM BOUNDARY (cost + reliability split)
  ═══════════════════════════════════════════════════════════════════════════════════

    DETERMINISTIC (0 tokens, <1s)          LLM (tokens, 2-30s)
    ─────────────────────────────          ─────────────────────────────
    Eligibility matrix                     Schedule assignment reasoning
    Hard constraint validation             Preference rule extraction
    Skill composition checks               Pattern mining across weeks
    Confidence decay math                  Intent classification
    Channel cost routing                   Singlish NL parsing
    Webhook deduplication                  Reason text interpretation
    Availability overlap calc              Knowledge page generation
    Gini fairness scoring                  Relationship type classification
    Candidate signal detection             Ambiguous edit disambiguation
    (X separated from Y, N times)          (friction vs. coverage vs. fairness?)

  The key insight is the layering: deterministic systems handle what's possible (eligibility, constraints, decay math), the LLM handles what's optimal
  (assignment reasoning, rule extraction, pattern interpretation), and the missing compliance checker would close the loop by feeding what actually
  happened back into the knowledge systems.