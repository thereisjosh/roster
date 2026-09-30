# Investor Technical Brief — Roster

**Audience:** VC / technical due diligence
**Date:** May 2026
**Stage:** Pre-launch, single-developer build

---

## 1. What This Is

Roster is AI-powered staff scheduling for shift-based SMBs — food & beverage, retail, healthcare. The core interaction model: staff send natural language messages (including Singlish and shorthand) via WhatsApp or Telegram to submit availability, request cover, and check schedules. The system auto-generates fair, cost-optimised weekly schedules. Managers review, edit, and publish through a web dashboard.

The product replaces WhatsApp group chat coordination + manual spreadsheet scheduling — the status quo for most SMBs in Southeast Asia.

---

## 2. Technical Moat

### Multi-model LLM orchestration with deterministic fallbacks

Most AI products call a single LLM for everything. Roster routes each task to the cheapest model that meets its quality bar, with automatic failover:

| Task | Primary model | Cost | Fallback |
|------|--------------|------|----------|
| Message classification | GPT-4.1-Nano | $0.10/1M tokens | Rule-based classifier (no LLM) |
| Availability parsing | GPT-4.1-Mini | $0.40/1M tokens | Regex + keyword parser (no LLM) |
| Preference extraction | Claude Haiku 4.5 | $1.00/1M tokens | Claude Sonnet 4.5 |
| Schedule pattern mining | Gemini 2.5 Pro | $1.25/1M tokens | Claude Sonnet 4.5 |

The highest-volume paths (classification, routing) have non-LLM fallbacks that always work. The system never goes fully down due to an LLM outage.

This is genuinely hard to replicate. It requires building and maintaining quality-calibrated routing across multiple providers, per-task evaluation suites, health monitoring, and deterministic fallback implementations.

### Singlish NLP preprocessing

A domain-specific normalisation layer handles Singapore English particles (lah, lor, leh), shorthand (tmr, tdy, avail, wrk), and colloquialisms (boleh, alr, anot). This is tested against an 82-case regression suite covering standard English, Singlish, shorthand, and typos.

This is market-specific IP. A competitor entering the Singapore/Malaysia market would need to build equivalent language handling — not available off-the-shelf from any LLM provider.

### Knowledge base and contextual intelligence

A wiki-style knowledge base system (`lib/knowledge/`) builds per-staff context pages that capture:
- **Relationship detection** (`lib/relationships/`) — interpersonal dynamics extracted from edit patterns (e.g., mentorship pairs, personality conflicts, training relationships)
- **Skill composition validation** (`lib/skills/`) — capability tags with proficiency levels, used to validate shift composition rules (e.g., "every closing shift needs at least one senior barista")
- **Pattern discovery** (`lib/inngest/functions/mine-patterns.ts`) — recurring scheduling patterns mined from weeks of manager edits

This contextual intelligence layer goes beyond simple rule storage. It builds an increasingly rich model of each team's dynamics that competitors would need months of data to replicate.

### LLM quality infrastructure

11 Promptfoo evaluation configs with golden datasets, covering availability parsing, intent classification, preference extraction, and schedule generation. An 82-case regression test suite runs against live LLM APIs to catch quality regressions. This level of LLM testing discipline is rare — most early-stage AI products ship without systematic eval.

---

## 3. Unit Economics of AI

### Per-message cost

The vast majority of messages (classification + routing) use GPT-4.1-Nano at $0.10/1M input tokens. A typical staff message is ~50 tokens.

**Cost per message classification: ~$0.00001** (effectively free)

Availability parsing uses GPT-4.1-Mini at $0.40/1M input tokens with a longer prompt (~500 tokens):

**Cost per availability parse: ~$0.0005**

### Per-schedule-generation cost

Schedule generation uses more expensive models (Gemini 2.5 Pro) with longer prompts. But it runs **once per week per business**, not per message.

Estimated cost per generation: **$0.01–$0.05** depending on team size and constraint complexity.

### Channel routing savings

The messaging channel router cascades from free to paid:

| Channel | Cost/msg | When used |
|---------|----------|-----------|
| Telegram | $0.000 | Staff has linked account |
| WhatsApp reply | $0.000 | Within 24h conversation window |
| Email (SES) | $0.0001 | Non-urgent messages |
| WhatsApp template | $0.011 | Outside conversation window |
| SMS (Plivo) | $0.052 | Last resort / critical |

By preferring free channels and tracking WhatsApp's 24-hour free-reply window, the system avoids **~$0.05/message** compared to defaulting to SMS — the industry standard for staff communication platforms.

### Per-business monthly cost profile (estimated)

For a typical SMB with 20 staff, ~200 messages/month, 4 schedule generations:

| Component | Monthly cost |
|-----------|-------------|
| LLM (classification + parsing) | ~$0.02 |
| LLM (schedule generation ×4) | ~$0.10 |
| Messaging (mostly free channels) | ~$0.50 |
| **Total variable cost** | **~$0.62** |

At a $30–50/month subscription price, **gross margin on variable costs exceeds 98%**.

Per-business LLM spend is tracked and capped by subscription tier, preventing runaway costs from any single tenant.

---

## 4. Infrastructure Cost Profile

**Fully serverless — near-zero fixed costs.**

| Service | Pricing model | Idle cost |
|---------|--------------|-----------|
| Vercel (compute) | Pay per invocation | $0 |
| Neon (database) | Pay per query | $0 (free tier) |
| Inngest (async jobs) | Pay per execution | $0 (free tier) |
| LLM APIs | Pay per token | $0 |

No servers to manage. No DevOps hire needed at current scale. The infrastructure scales to zero when there's no traffic and scales up automatically under load.

**What this means:** The burn rate for infrastructure is near-zero until meaningful traction. No fixed $500–2000/month server bills while finding product-market fit.

---

## 5. Production Readiness

### Shipping-ready

- **Chat flow:** Staff message → normalise → classify → execute → respond. End-to-end functional across WhatsApp, Telegram, SMS, and email.
- **Availability collection:** Natural language availability parsing with structured output and confirmation flow. Reminder engine built (`send-reminders.ts` Inngest function).
- **Schedule generation:** Three-variation pipeline (cost/fairness/balanced) with constraint validation, Gini-based fairness scoring, and preference learning from manager edits. Atomic persistence via `db.transaction()`.
- **Schedule review:** Variation tabs, Gantt chart, comparison panel, metrics display, approval flow, warning panel — all built.
- **Cover requests:** Staff request cover → system identifies eligible candidates → fan-out offers via Inngest → candidate accepts/declines → atomic fill with `db.transaction()` (prevents double-booking) → timeout + escalation.
- **Preference learning:** Automatic rule extraction from edits (`extract-preferences.ts`), pattern mining (`mine-patterns.ts`), confidence decay (`lifecycle.ts`), rule management UI, knowledge base with relationship/skill systems.
- **Webhook idempotency:** `processedWebhookMessage` table deduplicates incoming messages from Telegram and WhatsApp.
- **Auth and multi-tenancy:** Better Auth with session management. Business-scoped data access across 7+ tRPC API routers.
- **Observability:** Sentry error tracking + Pino structured logging.
- **5-channel messaging:** Cost-optimised dispatch with WhatsApp conversation window tracking.
- **Testing:** 17 unit test files, 6 E2E test suites, 11 LLM eval configs, 82-case regression suite.

### Not yet production-ready

| Gap | Risk | Fix complexity |
|-----|------|---------------|
| Feedback loop incomplete | Preference rules injected but never verified as followed; all rules trend toward decay regardless of relevance | Medium — add compliance checker + reinforcement writer |
| No schedule distribution orchestrator | Approved schedules can't be sent to staff automatically | Medium — messaging infra is fully built, needs orchestration logic |
| No rate limiting | Abuse / runaway costs | Low — add middleware |
| No caching layer | Database pressure at scale | Medium — add Redis |
| In-memory health tracking | Resets on serverless cold starts | Medium — move to Redis |
| No message retry / DLQ | Lost messages on send failure | Medium — add retry queue |
| No load testing | Unknown performance limits | Medium — run benchmarks |
| Schedule gen is synchronous | Timeout risk for complex inputs | Medium — move to Inngest |
| No row-level DB security | Data leak risk if code bug | Medium — add Postgres RLS |
| Structured output not enforced for most LLM tasks | Parsing failures handled by fallback but adds fragility | Low — enable native JSON mode in LLM client |
| Alerting pipeline not configured | Sentry captures errors but no alert notifications | Low — configure Sentry alerts |

None of these are architectural problems. They're standard scaling and hardening work.

---

## 6. Scale Path

### Current state → 100 businesses

Works as-is. Add alerting rules to Sentry. Estimated infrastructure cost: **<$50/month**.

### 100 → 1,000 businesses

- Add Redis for caching (business config, roster data) and persistent health state
- Add queue between webhook ingress and message processing
- Move schedule generation to background job (Inngest)
- Configure alerting pipeline

These are standard, well-understood scaling moves. No architectural rewrites. Estimated infrastructure cost: **$200–500/month**.

### 1,000 → 10,000 businesses

- Database read replicas or connection pooling
- Row-level security for tenant isolation
- Per-tenant rate limiting
- Reserved LLM API capacity
- Multi-region if expanding beyond Singapore

Requires a small infrastructure team (1–2 engineers). Estimated infrastructure cost: **$2,000–5,000/month**.

**Key point:** The architecture is serverless and stateless by design. Scaling is additive (add caching, add queues, add replicas) — not a rewrite.

---

## 7. Risk Assessment

### Technical risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| LLM provider outage | Medium | Three-tier fallback with deterministic last resort on critical paths |
| LLM quality regression | Medium | 82-case regression suite + Promptfoo eval pipeline catches regressions before deploy |
| LLM cost spike | Low | Per-call tracking, per-business monthly caps, cheapest-model routing |
| Data leak across tenants | High | Currently application-layer only. Needs Postgres RLS before scale |
| Preference learning degradation | Medium | Rules decay without reinforcement — compliance checking + reinforcement writer needed to close the feedback loop. Without this, the system forgets learned preferences over time. |
| Concurrent operation integrity | Medium | Mitigated by `db.transaction()` in 5 critical paths (schedule generation, cover fill, webhook processing, availability submission). Remaining risk in non-transactional paths. |
| Message delivery failure | Medium | No retry/DLQ currently. Needs retry queue before scale |
| Single developer | High | Clean codebase with tests, but bus factor = 1 |

### What's not a risk

- **Vendor lock-in on LLMs:** Multi-provider from day one (OpenAI, Anthropic, Google). Can shift traffic between providers in the routing table without code changes.
- **Infrastructure lock-in:** Serverless stack (Vercel, Neon, Inngest) but no proprietary APIs beyond hosting. Database is standard Postgres. Could migrate to any Postgres host + any Node.js runtime.
- **Technical debt:** Codebase is clean and well-structured for its stage. Separation of concerns is solid. No shortcuts that would require rewrites.

---

*Based on static code review of the Roster codebase, May 2026. No production traffic data available.*
