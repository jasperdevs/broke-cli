# Budget-First Roadmap

Goal: make `broke-cli` the cheapest serious terminal coding assistant by cutting avoidable token waste without making the UX feel worse.

## Phase 1: Clarity

- Simplify sidebar token footer to only show:
  - lifetime session total
  - lifetime input
  - lifetime output
  - current context usage
  - percent of limit
- Remove ambiguous labels like `Next request`.

## Phase 2: Budget telemetry

- Persist per-session budget metrics:
  - turns
  - small-model routed turns
  - idle cache cliffs
  - auto-compactions
  - fresh-thread carry-forwards
  - exposed tools vs used tools
  - archetype planner cache hits
- Expose a compact `/budget` report.

## Phase 3: Cheaper turn execution

- Classify each turn into a task archetype.
- Use the archetype to:
  - choose a bounded tool subset
  - choose a tool-step cap
  - attach a compact execution scaffold
- Avoid sending full tool surfaces when the turn clearly only needs a subset.

## Phase 4: Cache-loss recovery

- Detect idle cache cliffs.
- When context is large and the idle gap is long, carry work forward into a compacted fresh thread summary instead of re-sending the full chat.

## Phase 5: Planner/executor reuse

- Reuse archetype execution scaffolds across turns.
- Track cache hits/misses so the app can prove when the cheap path is working.

## Verification

- Regression tests for footer formatting.
- Regression tests for tool selection and budget report behavior.
- Typecheck, test, and build before completion.
