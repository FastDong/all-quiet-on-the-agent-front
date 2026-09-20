export const meta = {
  name: 'code-audit',
  description: 'Project-agnostic release audit: N read-only code lenses verify recent fixes, hunt defects, and each blocker/major is adversarially refuted',
  phases: [{ title: 'Audit', detail: 'one agent per lens' }, { title: 'Verify', detail: 'one refuter per claim' }],
}
// args: { root, project, guide, lenses: [{key, prompt}], fixes: {key: text}, accepted: text,
//         since: 'rev', scope: 'full'|'diff', maxClaims: 4, effort: 'medium'|'high' }
const root = args.root
const project = args.project || ''
const guide = args.guide || ''
const lenses = args.lenses || []
const fixes = args.fixes || {}
const accepted = args.accepted || '(none)'
const since = args.since || 'HEAD~1'
const scope = args.scope || 'full'
const maxClaims = args.maxClaims || 4
const effort = args.effort || 'medium'
if (!lenses.length) throw new Error('code-audit: args.lenses is required')
const ISSUE = { type: 'object', properties: { title: { type: 'string' }, file_line: { type: 'string' }, evidence: { type: 'string' }, failing_input: { type: 'string' }, fix: { type: 'string' } }, required: ['title', 'file_line', 'evidence', 'failing_input', 'fix'] }
const SCHEMA = { type: 'object', properties: {
  score: { type: 'number', description: '0-100 readiness of THIS area for the stated target' },
  fix_verdicts: { type: 'array', items: { type: 'object', properties: { fix: { type: 'string' }, correct: { type: 'boolean' }, note: { type: 'string' } }, required: ['fix', 'correct', 'note'] } },
  blockers: { type: 'array', items: ISSUE }, majors: { type: 'array', items: ISSUE },
  minors: { type: 'array', items: { type: 'string' } } }, required: ['score', 'fix_verdicts', 'blockers', 'majors', 'minors'] }
const VERDICT = { type: 'object', properties: { real: { type: 'boolean' }, severity: { type: 'string', enum: ['blocker', 'major', 'minor', 'not_a_bug'] }, reason: { type: 'string' } }, required: ['real', 'severity', 'reason'] }
const common = `You are auditing the source at ${root}. PROJECT: ${project}
READ-ONLY: never edit, build or run anything. ${guide ? `Read ${guide} first.` : ''} Navigate large files with grep, but read whole functions you judge.
Run "git show ${since} --stat" and "git show ${since} -- <file>" to see the latest changes. ${scope === 'diff' ? 'SCOPE: only the code touched by those commits and what calls it.' : 'SCOPE: your whole area, latest changes first.'}
Known and accepted, do not report: ${accepted}
Report only defects with a concrete failing input/state and file:line. Blocker = ship-stopping; major = fix before release; minor = later. Style is not a finding. An empty list is a valid answer. Score honestly.`
const refute = (issue, lens) => `An auditor claimed this defect in area "${lens.key}" of ${root}:\nTITLE: ${issue.title}\nWHERE: ${issue.file_line}\nEVIDENCE: ${issue.evidence}\nFAILING INPUT: ${issue.failing_input}\nFIX: ${issue.fix}\nOpen the cited code (READ-ONLY) and try to REFUTE it: reachable? does the input produce the effect? existing guard missed? Give honest severity (blocker / major / minor / not_a_bug). Default real=false if you cannot confirm from the code.`
const results = await pipeline(lenses,
  l => agent(`${common}\nAREA: ${l.prompt}\nFIXES IN YOUR AREA TO VERIFY FIRST: ${fixes[l.key] || '(none listed)'}`, { label: `audit:${l.key}`, phase: 'Audit', schema: SCHEMA, effort }),
  (r, l) => {
    if (!r) return null
    const claims = [...r.blockers.map(i => ({ ...i, claimed: 'blocker' })), ...r.majors.map(i => ({ ...i, claimed: 'major' }))].slice(0, maxClaims)
    return parallel(claims.map(c => () => agent(refute(c, l), { label: `verify:${l.key}`, phase: 'Verify', schema: VERDICT, effort: 'medium' }).then(v => ({ ...c, verdict: v }))))
      .then(vs => ({ lens: l.key, score: r.score, fix_verdicts: r.fix_verdicts, minors: r.minors, claims: vs.filter(Boolean), unverified: Math.max(0, r.blockers.length + r.majors.length - maxClaims) }))
  })
const ok = results.filter(Boolean)
const confirmed = ok.flatMap(r => r.claims.filter(c => c.verdict && c.verdict.real && c.verdict.severity !== 'not_a_bug').map(c => ({ lens: r.lens, ...c })))
log(`confirmed ${confirmed.length}; fixes judged wrong: ${ok.reduce((n, r) => n + r.fix_verdicts.filter(f => !f.correct).length, 0)}`)
return { scores: ok.map(r => ({ lens: r.lens, score: r.score, unverified: r.unverified })), fix_verdicts: ok.map(r => ({ lens: r.lens, verdicts: r.fix_verdicts })), confirmed, rejected: ok.flatMap(r => r.claims.filter(c => !c.verdict || !c.verdict.real || c.verdict.severity === 'not_a_bug').map(c => ({ lens: r.lens, title: c.title, reason: c.verdict ? c.verdict.reason : '' }))), minors: ok.map(r => ({ lens: r.lens, minors: r.minors })) }
