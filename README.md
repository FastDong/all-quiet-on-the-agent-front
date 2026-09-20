# All Quiet on the Agent Front (에이전트 이상없음)

A repeatable, cost-controlled multi-agent release audit for Claude Code. The name is a nod to
*All Quiet on the Western Front*: the skill exists so that "the agents report nothing" is a
meaningful statement — every claim has been fought over by a refuter before it reaches you.

A Claude Code **skill + saved workflow** that turns "have a bunch of agents review my code"
into a fixed, comparable, cost-controlled procedure:

1. **N read-only lenses** (one agent per area of the codebase) first verify the fixes you made
   since the last run, then hunt for defects that come with a *concrete failing input* and a
   `file:line`.
2. **Every blocker/major claim is handed to a second agent whose only job is to refute it.**
   Only claims that survive are reported.
3. A **structured JSON result** and a tiny summarizer give you a per-area score, the confirmed
   list, the rejected list, and — importantly — a verdict on whether your *previous* fixes were
   actually correct.

It was built while shipping a Win32/Direct2D desktop app to Steam, over four audit rounds in one
day. The case study below shows what it found, what it cost, and why the fixed procedure is
cheaper than ad-hoc agent fan-outs.

## Install

```
cp -r skills/all-quiet-on-the-agent-front   ~/.claude/skills/all-quiet-on-the-agent-front
cp    workflows/all-quiet-on-the-agent-front.js ~/.claude/workflows/all-quiet-on-the-agent-front.js
```

Claude Code picks up `~/.claude/skills/*/SKILL.md` at session start. The workflow is launched
through the `Workflow` tool with `scriptPath` (see below). Requires a Claude Code build with the
Workflow tool (multi-agent orchestration).

## Usage

Ask Claude, in a message that **explicitly allows multi-agent work** (the skill refuses to run
otherwise, on purpose — fan-outs are expensive and should never be Claude's own idea):

> Evaluate release readiness with agents.

Claude then:

1. Builds (or reuses) the project's lens list — keep it in `.claude/audit-lenses.json` in your
   repo so scores stay comparable between runs. See `examples/stellary-lenses.json`.
2. Writes one line per lens describing what changed since the last audit (`fixes`).
3. Launches:
   ```js
   Workflow({ scriptPath: '~/.claude/workflows/all-quiet-on-the-agent-front.js', args: {
     root: '/abs/path/to/repo',
     project: 'one paragraph: stack, what ships, release target',
     guide: 'CLAUDE.md',              // read first, or ''
     lenses: [{ key: 'input', prompt: 'files/functions of this area…' }, …],
     fixes: { input: 'what changed here since last run' },
     accepted: 'known issues the agents must not report',
     since: 'HEAD~1',                 // git rev(s) to show the agents
     scope: 'full' | 'diff',          // diff = only what changed + callers
     maxClaims: 4, effort: 'medium'
   } })
   ```
4. Summarizes with `python ~/.claude/skills/all-quiet-on-the-agent-front/summarize.py <task .output file>`.

Output shape:

```json
{ "scores": [{ "lens": "input", "score": 80, "unverified": 0 }, …],
  "fix_verdicts": [{ "lens": "input", "verdicts": [{ "fix": "…", "correct": true, "note": "…" }] }],
  "confirmed": [{ "lens": "input", "title": "…", "file_line": "…", "evidence": "…",
                  "failing_input": "…", "fix": "…", "verdict": { "real": true, "severity": "major", "reason": "…" } }],
  "rejected": [{ "lens": "…", "title": "…", "reason": "…" }],
  "minors": [{ "lens": "…", "minors": ["…"] }] }
```

## Cost model

```
subagent tokens ≈ lenses × (120k–200k per audit agent) + claims × (25k–40k per refuter)
```

| Setting | Effect |
| --- | --- |
| `effort: 'medium'` instead of `'high'` | roughly −40% on the audit agents, same confirmed-finding count in our runs |
| `maxClaims: 4` per lens | caps the refutation stage; anything beyond is reported as `unverified` count, never silently dropped |
| `scope: 'diff'` right after a fix commit | agents read only the changed code and its callers: about half the cost of `full` |
| stable lens keys | scores are comparable run to run, so you can *see* whether a fix round helped |

The skill itself saves only authoring tokens (the orchestrator no longer writes a ~150-line
script each time) and keeps prompts identical between runs. The real savings come from the
defaults it enforces. Be honest with yourself about that: a skill is not a discount, it is a
policy.

## Case study: four rounds on one codebase, one day

Project: **Stellary**, a C++20 / Win32 / Direct2D desktop wallpaper (~15k lines), first paid
release on Steam. All numbers are real subagent-token counts reported by Claude Code.

| Round | Setup | Agents | Tokens | Confirmed | Rejected by refuters | Fixes from the previous round judged wrong |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 4 lenses, no refutation, ad-hoc script | 4 | 0.44M | 14 majors (3 duplicates) | — | — |
| 2 | 5 lenses, `effort: high`, up to 8 refuters per lens, ad-hoc script | 18 | 1.86M | 13 (7 major) | 0 | — |
| 3 | 5 lenses, `effort: high`, up to 5 refuters, ad-hoc script | 15 | 1.56M | 10 (5 major) | 0 | **3 of 13** |
| 4 | 5 lenses, `effort: medium`, up to 4 refuters, **this skill** | 10 | 1.09M | 5 (2 major) | 0 | 0 of 10 |

What the rounds actually caught (all confirmed by reading the code, most reproduced live):

- Round 1 (no refutation): the process had **no single-instance guard**, the autostart
  registry value still carried an old codename, the appinfo parser did an unbounded `reserve`
  on a length read from an untrusted file.
- Round 2: **secondary Steam library folders were never scanned** (a VDF parse loop searched
  the raw text for an *unescaped* value, so it stopped after the first entry), Steam tools showed
  up as owned games, a store-search row for a bundle was parsed as one game with the first
  game's id, a double-click passed straight through modal dialogs to the star field.
- Round 3 caught the orchestrator's own mistakes from round 2's fix commit: the new
  single-instance "wait" was on a **never-owned mutex** (always signalled, so it waited 0 ms and
  additionally opened a startup-gap race), the capture-loss handler had been added to one of
  two windows, and the double-click guard only covered persistent modals.
- Round 4: the wallpaper host **raised itself over every other window when activated**
  (reproduced with Notepad open: covered before the fix, on top after), and a CDATA wrapper made
  profile playtime parse as 0.

Two lessons that shaped the skill:

1. **"Verify the previous fixes first" is the highest-value instruction.** Round 3's three
   wrong-fix verdicts were the most expensive bugs to have missed, and no amount of "find new
   bugs" prompting would have surfaced them.
2. **Refuters rejected nothing in three rounds.** Either the auditors were precise (plausible:
   they were required to give a failing input and a `file:line`) or the refuters were too
   agreeable. Treat the refutation stage as a severity calibrator, not as proof. The one
   `PLAUSIBLE`-not-`CONFIRMED` finding (the z-order raise) was flagged as such by the agent and
   then reproduced by hand — keep doing that for anything about windows, input or processes.

Round 4 cost 41% less than round 2 and 30% less than round 3 while still finding two real
majors. The drop came from `effort: medium` and `maxClaims: 4`, not from the skill file — the
skill just makes those the default so nobody has to remember.

## Limitations

- Agents are **read-only**: they never build or run. Anything that depends on runtime behaviour
  is reported as plausible and must be reproduced by hand (the skill's step 6 says how).
- Scores are per-area self-assessments by an LLM. Use the *trend* between rounds, not the
  absolute number.
- Refutation with a single agent per claim is cheap but weak; if a claim would trigger an
  expensive rewrite, run two or three refuters for it (edit `maxClaims`/the `parallel` call).
- Costs scale with codebase size and with how much the lens prompts make agents read. Point
  prompts at functions, not directories.

## Files

- `skills/all-quiet-on-the-agent-front/SKILL.md` — the skill (when to run, cost, steps, report format)
- `skills/all-quiet-on-the-agent-front/summarize.py` — prints scores, wrong fixes, confirmed, rejected, minors
- `workflows/all-quiet-on-the-agent-front.js` — the Workflow script (pipeline: audit → refute per claim)
- `examples/stellary-lenses.json` — a real lens file for a Win32/Direct2D C++ app

## License

MIT — see `LICENSE`.
