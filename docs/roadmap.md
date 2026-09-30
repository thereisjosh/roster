# Roster — Product Roadmap

## Current Status (~60-65% Complete)

**What's built:**
- Full auth system (Better Auth, role-based access)
- Database schema (20+ tables, Drizzle ORM, Neon Postgres)
- tRPC API layer (46+ procedures across 7+ routers)
- Schedule generation pipeline with 3-tier LLM fallback (Claude Sonnet → Haiku → deterministic solver)
- 5 hard-constraint validators (availability, consecutive days, rest hours, coverage, duration)
- Schedule review UI: variation tabs, metrics, Gantt chart, comparison panel, approve/finalise, warning panel
- Messaging adapters (WhatsApp, Email, SMS, Telegram) with cost-aware channel router
- Preference rule storage + injection into generation prompts (MUST/PREFER formatting)
- Automatic rule extraction from manager edits (`lib/inngest/functions/extract-preferences.ts`)
- Pattern mining from edit history (`lib/inngest/functions/mine-patterns.ts`)
- Confidence decay for stale rules (`lib/relationships/lifecycle.ts`, `lib/skills/lifecycle.ts`)
- Knowledge base system — wiki-style per-staff context pages (`lib/knowledge/`)
- Relationship detection — interpersonal dynamics from edit patterns (`lib/relationships/`)
- Skill extraction and composition validation (`lib/skills/`)
- Cover request workflow — full Inngest-based candidate fan-out with atomic fill (`lib/inngest/functions/process-cover-request.ts`, 329 lines)
- Inbound webhooks with idempotency (Telegram + WhatsApp, `processedWebhookMessage` table)
- Inngest workflow orchestration (5 registered functions: extract-preferences, process-cover-request, mine-patterns, send-reminders, lint-knowledge)
- Database transactions in 5 critical paths (`generator.ts`, `schedule.ts`, `process-cover-request.ts`, `telegram/route.ts`, `submit-from-chat.ts`)
- Observability: Sentry error tracking (`lib/sentry.ts`) + Pino structured logging (`lib/logging.ts`)
- Reminder engine for availability nudges (`lib/inngest/functions/send-reminders.ts`)
- UI for staff CRUD, availability submission, settings, schedule list + detail + comparison
- Test suite (98+ unit tests, 6 Playwright E2E suites, 10+ Promptfoo eval configs)

**What's missing (critical):**
- **Preference learning feedback loop** — rules are extracted and injected but never verified as followed; reinforcement doesn't happen; all rules trend toward decay (see "The Feedback Loop Gap" in `docs/backlog.md`)
- Schedule distribution orchestrator (approved schedule → personalised messages to staff)
- Autonomous availability collection trigger (cron at T-7)

**What's missing (non-critical):** analytics dashboard, onboarding wizard, rate limiting, caching layer, voice notes, schedule export.

---

## Design Decisions (Resolved)

### 1. Messaging Provider — Telegram ✅

**Decision:** Telegram as primary messaging channel, WhatsApp as fallback.

**Rationale:** Free (no per-message fees), no 24hr conversation window restrictions, rich bot UX with inline keyboards, simple webhook setup. WhatsApp adapter already built — kept as fallback behind the messaging abstraction layer.

**Status:** Telegram adapter built (`lib/messaging/adapters/telegram.ts`). Channel router defaults to Telegram. Inbound webhook operational.

### 2. Cron Infrastructure — Inngest ✅

**Decision:** Inngest for scheduled job orchestration.

**Rationale:** Roster's loops need multi-step workflows (send → wait → check → remind → escalate). Inngest provides:
- `step.sleep()` for reminder chains (perfect for Loop 1 reminders at T-5, T-3, T-1)
- Native fan-out to N staff members
- Built-in retries with configurable policies
- 50K free runs/month (covers ~16K businesses at current volume)
- Deploys alongside Next.js on Vercel (no separate infra)
- Traces/observability dashboard included

**Status:** 5 functions registered and operational: `extract-preferences`, `process-cover-request`, `mine-patterns`, `send-reminders`, `lint-knowledge`.

**Why not Vercel Cron:** No retry, no fan-out, no sleep/delay, 60s timeout too limiting for multi-staff contact loops.
**Why not Trigger.dev:** Only 10 schedules on free tier (need 5-7 per business), separate compute.

### 3. Database Hosting — Neon Postgres ✅

**Decision:** Neon Postgres (serverless) confirmed as production database.

Suitable for current scale. Revisit if connection pooling or read replicas become necessary.

---

## Phased Roadmap

All 5 loops progress in parallel across phases. Checkboxes track completion.

### Phase 1: Foundation

Infrastructure and abstraction layers that unblock all loops.

- [x] **Messaging abstraction layer**
  - [x] Build Telegram bot adapter (`lib/messaging/adapters/telegram.ts`)
  - [x] Wrap existing WhatsApp adapter behind interface (fallback channel)
  - [x] Wrap Email + SMS adapters behind interface
  - [x] Channel router updated to use abstraction, Telegram as default
- [x] **Cron / workflow infrastructure (Inngest)**
  - [x] Install Inngest SDK, configure `/api/inngest` route
  - [x] Define Inngest functions (5 registered: extract-preferences, process-cover-request, mine-patterns, send-reminders, lint-knowledge)
  - [x] Implement reminder chains with `step.sleep()` (`send-reminders.ts`)
  - [x] Fan-out patterns for multi-staff messaging (`process-cover-request.ts`)
- [x] **Inbound webhook infrastructure**
  - [x] `POST /api/webhook/telegram` endpoint (Telegram bot webhook)
  - [x] `POST /api/webhook/whatsapp` endpoint (WhatsApp webhook)
  - [x] Signature verification (Telegram bot token, WhatsApp webhook verification)
  - [x] Message routing: parse inbound → classify intent → dispatch to handler
  - [x] Webhook idempotency (`processedWebhookMessage` table)
- [x] **Resolve open design decisions** (Telegram, Inngest, Neon Postgres — all confirmed)
- [ ] **Remaining Phase 1 items:**
  - [ ] Redis for persistent health state (currently in-memory, resets on cold starts)
  - [ ] Queue between webhook ingress and processing (currently synchronous)

---

### Phase 2: Core Loops

Build out all 5 loops to autonomous operation.

#### Loop 1 — Availability Collection (autonomous)
- [x] Inbound reply parser: NL text → availability via chat (LLM classification + execution)
- [x] Reminder engine: chase non-responders (`send-reminders.ts` Inngest function)
- [ ] Cron job: send availability requests at T-7 days per business
- [ ] Message template builder (personalised per staff member)
- [ ] Deadline enforcement: auto-close collection, mark non-responders
- [ ] Auto-trigger Loop 2 when collection closes

#### Loop 2 — Schedule Generation (UI complete)
- [x] Schedule detail view: assignments table per variation
- [x] Variation tabs: compare variations with metrics (cost, fairness, balanced)
- [x] Metrics display per variation (total cost, shifts filled, fairness/cost/preference scores, constraint metrics)
- [x] Approve variation UI (button → `approveVariation` mutation)
- [x] Finalise schedule flow (lock approved variation, trigger Loop 3)
- [x] Gantt chart view (staff × days grid, color-coded shifts, tooltips)
- [x] Variation comparison panel (side-by-side cost/coverage overview)
- [x] Warning panel (coverage warnings, supervision gaps, hours budget)
- [ ] Historical context: query last 8 weeks for stability scoring
- [ ] Real stability scoring (replace hardcoded 0.7)
- [ ] Real preference scoring (replace hardcoded 0.7)
- [ ] Tier 2 error recovery (constraint relaxation between Tier 1 retries and Tier 3 deterministic)

#### Loop 3 — Schedule Distribution (orchestrator needed)
- [ ] Distribution orchestrator service
  - [ ] Iterate approved variation assignments
  - [ ] Build personalised message per staff member (shifts, location, notes)
  - [ ] Send via channel router (cheapest viable channel)
  - [ ] Persist to `communicationLog`
- [ ] Acknowledgement tracking
  - [ ] Inbound webhook handler for ack replies
  - [ ] Ack status per staff member per schedule
  - [ ] Reminder for non-acknowledgers (T+4hr, T+12hr)
- [ ] Manager alert: escalate if critical-role staff haven't acknowledged within threshold
- [ ] API endpoint: `POST /api/schedule/[id]/distribute`

#### Loop 4 — Last-Minute Cover (workflow built)
- [x] Cover request UI (manager view)
- [x] Eligibility engine: query staff qualified for the role, filter by availability
- [x] Candidate ranking by configurable priority
- [x] Outbound cover request messaging (fan-out via Inngest)
- [x] Accept/decline handling via inbound webhook
- [x] Timeout + escalation: if no response within window, try next candidate; if pool exhausted, escalate to manager
- [x] Atomic cover fill with `db.transaction()` (prevents double-booking)
- [ ] Schedule patching: update approved variation when cover is filled

#### Loop 5 — Preference Learning (feedback loop incomplete)
- [x] Automatic rule extraction: LLM call on edit + reason → extract preference rules (`extract-preferences.ts`)
- [x] Pattern mining job: analyse edit history for recurring patterns (`mine-patterns.ts`)
- [x] Confidence decay: stale rules lose confidence over time (`lib/relationships/lifecycle.ts`, `lib/skills/lifecycle.ts`)
- [x] Rule management UI: list active rules, confirm/reject, toggle active (`settings/` page)
- [x] Knowledge base: wiki-style per-staff context pages (`lib/knowledge/`)
- [x] Relationship detection: interpersonal dynamics from edit patterns (`lib/relationships/detect.ts`)
- [x] Skill extraction: capability tags for team composition (`lib/skills/`)
- [ ] **Compliance checking** (verify generated schedules follow injected rules)
- [ ] **Reinforcement mechanism** (update `lastReinforcedAt`, boost confidence for followed rules)
- [ ] **Confidence-based filtering** (weight rules in assembler by confidence score)
- [ ] Schedule edit UI (drag-and-drop shift reassignment with reason micro-prompt)
- [ ] Voice note transcription (Whisper API + S3)

**Design considerations:**
- Loop 1 inbound parsing should use GPT-4.1-mini for cost efficiency (classification task)
- Loop 3 uses Telegram by default (no conversation window limits); WhatsApp fallback must respect 24hr window with templates
- Loop 4 candidate pool should be configurable (max candidates to contact simultaneously)
- Loop 5 compliance checking should run post-generation, before manager review — flag violations
- Loop 5 reinforcement is the prerequisite for active learning (Phase 3)

---

### Phase 3: Intelligence

Advanced features that improve scheduling quality over time.

- [x] **Pattern mining job** (built — `mine-patterns.ts`)
  - [x] Aggregate edits across weeks → identify recurring patterns
  - [x] LLM analysis → propose new preference rules
  - [ ] Surface proposed rules in management UI for explicit approval
- [ ] **Active learning** (prerequisite: feedback loop must be closed — P0 items)
  - [ ] Track which rules improved schedule acceptance (fewer edits)
  - [ ] A/B test rule inclusion vs exclusion across schedule variations
  - [ ] Auto-promote high-confidence rules to hard constraints
- [ ] **Natural language parsing improvements**
  - [ ] Support complex availability expressions ("every other Tuesday", "not before 10am")
  - [ ] Context-aware parsing (staff history, typical patterns)
  - [ ] Multi-turn clarification for ambiguous replies
- [ ] **Voice notes**
  - [ ] Whisper API integration for audio → text transcription
  - [ ] S3/R2 storage for audio files
  - [ ] Transcription → availability/preference parsing pipeline
- [ ] **Schedule quality metrics**
  - [ ] Week-over-week edit reduction tracking (target: 40% reduction by week 8)
  - [ ] Staff satisfaction proxy (preference adherence rate)
  - [ ] Cost efficiency trending

---

### Phase 4: Production

Hardening, onboarding, and operational readiness.

- [ ] **Onboarding wizard**
  - [ ] Guided setup: business details → staff import (CSV) → operating hours → coverage rules
  - [ ] First availability collection trigger
  - [ ] Sample schedule generation with demo data
- [ ] **Analytics dashboard**
  - [ ] Weekly summary: schedules generated, edits made, cover requests, staff response rates
  - [ ] LLM cost tracking dashboard (per-run and cumulative)
  - [ ] Preference learning progress (rules active, confidence distribution, edit reduction trend)
- [ ] **Billing & subscription**
  - [ ] Tier enforcement (free/starter/pro/enterprise — schema already has `subscriptionTier` enum)
  - [ ] Usage metering (schedules generated, messages sent, LLM calls)
  - [ ] Stripe integration
- [ ] **Hardening**
  - [ ] Rate limiting on all API routes
  - [ ] Webhook queue between ingress and processing
  - [x] Error tracking (Sentry — `lib/sentry.ts`)
  - [x] Structured logging (Pino — `lib/logging.ts`)
  - [ ] Alerting pipeline (Sentry alerts not configured)
  - [ ] Database connection pooling review
  - [ ] Load testing for concurrent schedule generation
- [ ] **CI/CD**
  - [ ] Promptfoo eval integration in PR checks
  - [ ] E2E test suite in CI pipeline
  - [ ] Preview deployments with seeded test data
- [ ] **Multi-location support**
  - [ ] Schema extension for multiple locations per business
  - [ ] Location-scoped staff, schedules, and coverage rules

---

## Dependency Graph

```
┌─────────────────────────────────────────────────────────────┐
│                    DESIGN DECISIONS (ALL RESOLVED)          │
│  ✅ Telegram (primary)  ─┐                                  │
│  ✅ Inngest (cron)       ─┼──▶ Phase 1 Foundation ✅        │
│  ✅ Neon Postgres (DB)   ─┘    (messaging + webhooks +      │
│                                 Inngest all operational)     │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│                  PHASE 2: CORE LOOPS                        │
│                                                             │
│  Loop 2 (schedule UI)    ✅ complete                        │
│  Loop 4 (cover workflow) ✅ ~80% complete                   │
│  Loop 5 (learning)       ⚠️  extraction built,             │
│                              feedback loop missing          │
│  Loop 1 (autonomous)     ⚠️  reminders built,              │
│                              trigger missing                │
│  Loop 3 (distribution)   ❌ orchestrator missing            │
└─────────────────────────────────────────────────────────────┘
                          │
                          ▼
┌─────────────────────────────────────────────────────────────┐
│              CRITICAL PATH TO COMPLETION                     │
│                                                             │
│  P0: Feedback loop ──────▶ compliance → reinforcement       │
│                            → confidence filtering           │
│                                                             │
│  P1: Distribution ───────▶ orchestrator → ack tracking      │
│      + autonomy             → collection trigger            │
│                                                             │
│  Then: End-to-end weekly cycle runs autonomously            │
│        with self-sustaining preference learning             │
└─────────────────────────────────────────────────────────────┘
```

### Critical Path

```
Feedback loop (compliance → reinforcement → filtering)  ← #1 priority
  → enables active learning (Phase 3)
  → prevents rule decay from erasing all learned preferences

Distribution orchestrator (approved → send to staff)     ← #2 priority
  → enables full weekly cycle
  → unblocks autonomous operation
```

**The feedback loop is the single most important missing piece.** Without it, the system's core differentiator (learning from manager edits) degrades over time as rules decay without reinforcement.

---

## Summary of Blocking Dependencies

| Blocked Item | Blocked By |
|---|---|
| Active learning (Phase 3) | Feedback loop (compliance + reinforcement) |
| Autonomous weekly cycle | Distribution orchestrator + collection trigger |
| Loop 3 (distribution) | Distribution orchestrator (messaging infra is ready) |
| Loop 1 (autonomous) | Collection trigger cron (Inngest + messaging ready) |
| Pattern mining UI | Pattern mining is built; needs UI for proposed rules |
| Onboarding wizard | Loops 1-3 functional |
| Analytics dashboard | Feedback loop data flowing |
