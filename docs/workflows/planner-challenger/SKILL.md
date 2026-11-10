---
name: planner-challenger
description: Use when the user requests a native Codex planner/challenger pair, two-agent planning, or an independent challenge of a proposed coding plan without external agent CLIs. Not for routine implementation or ordinary single-agent planning.
---

# Native planner and challenger

Use two native Codex subagents, with the host coordinating. This workflow requires no WSL, Linux distribution, other-vendor CLI, MCP agent server, API key, or shell-launched agent session.

## Scope and coordination

- Verify native spawning and follow-up/messaging tools are available. If they are not, report that limitation; do not install a substitute or present solo reasoning as independent review.
- Create exactly two agents for this invocation: a planner, then a separate challenger after the draft exists. Neither creates additional agents. Reuse these agents for revisions.
- Give each a fresh context when supported (`fork_turns: "none"`) and a compact, self-contained brief: the user's objective, constraints, relevant paths, verified evidence, and output contract. Follow current model instructions; do not hardcode a model or claim different models were used unless verified.
- Target at most 600 words for the planner and 400 for the challenger; use one initial response and at most one follow-up per role. These are instructions, not runtime-enforced token caps. Do not omit a material blocker to fit a length target.
- Both agents inspect relevant files without modifying application code, dependencies, configuration, databases, or external state. This is a behavioral instruction, not a separately enforced read-only sandbox; do not describe it as a security guarantee.
- Planning does not authorize implementation, commits, deployments, installations, or cleanup. Preserve any implementation authorization the user separately supplied; return to the host's normal implementation workflow only after planning finishes.

## Planner brief

Ask the planner for a concise draft containing:
1. Goal and explicit scope; assumptions and genuinely blocking questions.
2. Source-backed current behavior and affected files when verified.
3. Ordered changes with dependencies and important failure cases.
4. Acceptance criteria and specific validation cases, including expected results.
5. Risks, tradeoffs, and unresolved decisions.

Request a plan only. Label proposed commands as unexecuted; cite files/lines only when actually inspected. Prefer supplied facts over repeating broad repository discovery.

## Independent challenger brief

Send the challenger the original objective and constraints, relevant evidence, and the planner's draft. Ask it to independently inspect the reasoning rather than approve it. Check missing requirements, incorrect assumptions, unnecessary scope, dependencies, concurrency/partial failure when applicable, authorization, and whether the proposed tests detect the actual failure.

Return `READY`, `REVISE`, or `BLOCKED`, followed by prioritized findings. Each finding must identify a plan step or verified source location, a concrete failure scenario, and an actionable correction. Distinguish confirmed defects from assumptions/questions. Omit praise and cosmetic objections. Do not implement or expand the user's product requirements.

## Reconcile and finish

The host checks each finding against the requirements and evidence, then accepts it, takes a simpler correction, defers it, or rejects it with a reason. A peer verdict is evidence, not permission or proof of correctness.

Allow one revision and one recheck using the same planner and challenger. The planner receives accepted findings; the challenger checks the revised parts and remaining blockers. Stop after that recheck, or earlier if ready. Report unresolved blockers candidly instead of claiming consensus. More rounds require the user's request or a materially changed task.

Deliver the consolidated plan, meaningful validation, material assumptions, and unresolved decisions. Summarize the actual two-agent participation and state whether implementation has started. Save plan/review artifacts only when requested or already within the authorized task. Never claim tests or commands ran without their results.

Invocation example: `$planner-challenger Plan the requested stock adjustment fix and challenge the plan before implementation.`
