---
name: all-quiet-on-the-agent-front
description: Project-agnostic multi-agent release-readiness audit — N read-only code lenses verify the latest fixes first, hunt for defects with concrete failing inputs, and every blocker/major claim is adversarially refuted before it counts. Use when the user asks to evaluate/audit/review code readiness AND explicitly allows multi-agent work in the same message ("멀티에이전틱", "에이전트 써도 됨", "use agents"). Never run it unasked.
---

# All Quiet on the Agent Front (에이전트 이상없음)

A saved workflow (`<repo>/.claude/workflows/all-quiet-on-the-agent-front.js` — the Workflow tool only
accepts script paths under the working directory, so copy it into each repo; the canonical copy is
`~/.claude/workflows/all-quiet-on-the-agent-front.js`) plus a summarizer. Lenses are passed
in, so it works for any repo; scores stay comparable run to run as long as the lens list is
kept stable for that project.

## Opt-in rule
Only when the user explicitly allows multi-agent work in the same message. Otherwise offer a
solo review. Never launch it to double-check your own work unasked.

## Cost (say it before launching)
`subagent tokens ≈ lenses × (audit 120–200k) + claims × 25–40k`. Typical 5 lenses, 4 claims
each, effort medium: 0.9–1.3M. `scope: 'diff'` right after a fix commit: 0.4–0.8M. `effort:
'high'` adds ~40%. The skill itself saves only authoring and stabilizes prompts; real savings
come from `diff` scope, `effort: 'medium'`, and a small `maxClaims`.

## Inputs
- `root`: absolute repo path.
- `project`: one paragraph: language/stack, what ships, target (e.g. "paid v1.0 on Steam").
- `guide`: file the agents must read first (e.g. `CLAUDE.md`), or ''.
- `lenses`: array of `{ key, prompt }` — each prompt names the files/functions of that area.
  Keep 4–6. Reuse the same keys every run for comparable scores.
- `fixes`: `{ key: 'what changed in this area since the last audit' }` — verified first.
- `accepted`: known/accepted issues the agents must not report.
- `since`: git rev(s) to `git show`. `scope`: `'full' | 'diff'`. `maxClaims` (default 4).
  `effort` (default `'medium'`).

## Steps
1. Build the lens list for the project (or reuse the one saved in the project's
   `.claude/audit-lenses.json` if present; create it on first use).
2. Write `fixes` from the last commit message(s), one line per lens.
3. Launch:
   ```
   Workflow({ scriptPath: '<repo>/.claude/workflows/all-quiet-on-the-agent-front.js', args: { root, project, guide, lenses, fixes, accepted, since, scope, maxClaims, effort } })
   ```
   Tell the user it is running with the token estimate; wait for the notification.
4. `python <home>/.claude/skills/all-quiet-on-the-agent-front/summarize.py <task .output file>`
5. Report short, in the user's language: mean score, per-lens table (with previous scores
   if known), fixes judged wrong (own them explicitly), confirmed majors one line each,
   minors count, rejected count, actual token usage.
6. If asked to fix: one patch script, build, project gate, and a **real reproduction**
   for anything input/window/instance related (send real input, assert on log markers or
   window state). Record, commit, push. Then offer a `diff`-scope re-audit.
