 1. Rule adherence rate (automated, per-generation)
                                                                                                                                                           
  You already have the data. After each generation, programmatically check: of the N active preference rules, how many did the LLM follow? This is the
  compliance checker running as a scorer, not a gate. Track this over time. If you add relationship context and adherence doesn't improve, the context     
  isn't helping.                                                                                                                                         
                                                                                                     
  2. Manager edit rate (the real signal)

  The BRD's target is 40% edit reduction by week 8. This is the ultimate eval. If enriched context is working:
  - Week 1: manager makes 12 edits
  - Week 4: manager makes 8 edits (rules being followed)
  - Week 8: manager makes 7 edits (relationships + skills reducing friction-based edits)

  If the edit rate doesn't decrease, the enriched prompt isn't producing better schedules regardless of what rule adherence says.

  3. A/B within variations (built-in)

  You generate 3 variations per run. You could generate a 4th "baseline" variation with only hard constraints and eligibility — no preferences, no
  knowledge context, no relationships. Compare:
  - Baseline: X edits before approval
  - Enriched: Y edits before approval

  If Y ≥ X consistently, the enrichment is noise.

  4. Edit classification (which context type prevents which edits)

  When a manager edits, you already record the reason. Classify edits by what would have prevented them:
  - "Moved Wilson off Ke Xin's shift" → relationship context should have prevented this
  - "Alice can't do Tuesdays" → preference rule should have prevented this
  - "Need a senior barista on closing" → skill composition should have prevented this
  - "Understaffed Saturday morning" → pattern context should have prevented this

  If 80% of edits are "understaffing" and 0% are "friction pairing," then relationship context isn't buying you much yet but pattern context is high value.

  5. Promptfoo eval with golden datasets (what you already have)

  Your existing eval suite tests schedule generation quality. Extend it:
  - Same input scenario, generate with and without preference rules → score difference
  - Same scenario, add relationship edges → does output respect separations?
  - Same scenario, add skill composition rules → does output satisfy them?

  This tells you whether the LLM can use the context, not whether it does in production.

  The eval order before building the loop:

  Start here (cheapest, fastest signal):
    → Promptfoo: does enriched prompt produce different/better output?
    → Automated rule adherence scoring on existing schedule runs

  Then (requires production data):
    → Edit rate trending week over week
    → Edit classification by prevention type
    → A/B baseline vs enriched variation

  The compliance checker you'd build for the feedback loop is the automated eval. It's the same code — compare assignments against rules, score adherence.
  The only difference is whether you use the output for reinforcement (the loop) or just for measurement (the eval). Build it as a scorer first, validate
  it's measuring something meaningful, then wire in reinforcement.