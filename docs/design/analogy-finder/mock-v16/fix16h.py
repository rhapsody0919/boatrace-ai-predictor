# -*- coding: utf-8 -*-
import io
fn = 'part16_scn.js'
t = io.open(fn, encoding='utf-8').read()
a = '${hintForms().has(k) ? `<span class="hintb">平均STから出やすい</span>` : ""}'
assert t.count(a) == 1, t.count(a)
t = t.replace(a, '${((r) => (r ? `<span class="hintb">平均STが当てはまる ${pc(r.ph, 0)}（当てはまらないとき${pc(r.pm, 0)}）</span>` : ""))(hintForms().get(k))}')
io.open(fn, 'w', encoding='utf-8').write(t)
t = io.open('make16.py', encoding='utf-8').read()
add = r'''# 手がかりパネル 第10回・ファン評価の直し
R('.tabs{display:grid;', '.hint-pic{max-width:520px}.hint-t td .fst{color:var(--warn)}.hintc[aria-pressed="true"]{border:2px solid var(--accent-strong);padding:5px 7px}.hintc small{display:block;font-size:10.5px;color:var(--muted);margin-top:2px}.hintb{white-space:normal}\n.tabs{display:grid;')
'''
t = t.replace("io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", add + "io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", 1)
io.open('make16.py', 'w', encoding='utf-8').write(t)
print('ok')
