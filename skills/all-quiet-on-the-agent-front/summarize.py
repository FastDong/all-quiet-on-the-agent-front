# -*- coding: utf-8 -*-
# release-audit 워크플로 결과(.output JSON)를 짧은 요약으로. 사용: python summarize.py <output-file>
import json, io, sys
d = json.load(io.open(sys.argv[1], encoding='utf-8'))['result']
scores = [(x['lens'], x['score']) for x in d['scores']]
print('scores', scores, 'mean', round(sum(s for _, s in scores) / max(1, len(scores))))
wrong = [(fv['lens'], v) for fv in d['fix_verdicts'] for v in fv['verdicts'] if not v['correct']]
print('\n== FIXES JUDGED WRONG/INCOMPLETE', len(wrong))
for lens, v in wrong:
    print(f" ({lens}) {v['fix'][:80]}\n    {v['note'][:500]}\n")
print('== CONFIRMED', len(d['confirmed']))
for c in d['confirmed']:
    v = c['verdict']
    print(f"[{v['severity']}] ({c['lens']}) {c['title']}\n   at {c['file_line'][:110]}\n   ev: {c['evidence'][:400]}\n   fix: {c['fix'][:300]}\n")
print('== REJECTED', len(d['rejected']))
for r in d['rejected']:
    print(f" - ({r['lens']}) {r['title'][:100]}: {r['reason'][:160]}")
print('== MINORS')
for m in d['minors']:
    for x in m['minors']:
        print(f" - ({m['lens']}) {x[:160]}")
