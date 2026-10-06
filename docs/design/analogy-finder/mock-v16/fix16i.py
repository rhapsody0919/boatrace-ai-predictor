# -*- coding: utf-8 -*-
import io, re
t = io.open('part16_scn.js', encoding='utf-8').read()
m = re.search(r'<h3><span class="stepn">3</span>([^<]*)</h3>', t)
assert m, 'no step3'
t = t[:m.start()] + '${markHtml()}\n  <h3><span class="stepn">4</span>' + m.group(1) + '</h3>' + t[m.end():]
io.open('part16_scn.js', 'w', encoding='utf-8').write(t)
t = io.open('make16.py', encoding='utf-8').read()
a = "io.open('part16_hint.js', encoding='utf-8').read()"
assert t.count(a) == 1
t = t.replace(a, a + " + '\\n' + io.open('part16_mark.js', encoding='utf-8').read()")
add = r'''# ③ 1マークはどうなる？
R('.tabs{display:grid;', '.mk-t th,.mk-t td{padding:4px 6px;font-size:12px}.mk-t td{font-family:"JetBrains Mono",monospace;text-align:right}.mk-t tr.grp th{font-size:11.5px;color:var(--text2);padding-top:8px}.mk-t tr.today{background:var(--sunken)}.mk-t tr.today th{font-weight:700}.mk-t th small{display:inline-block;margin-left:4px;font-size:10px;color:var(--card);background:var(--accent-strong);border-radius:3px;padding:0 4px}\n.tabs{display:grid;')
'''
t = t.replace("io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", add + "io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", 1)
io.open('make16.py', 'w', encoding='utf-8').write(t)
t = io.open('assemble16.py', encoding='utf-8').read()
if 'D.mark1' not in t:
    t = t.replace("+';\\n'", "+';\\n'+'D.mark1='+io.open('../slitpred/mark1.json',encoding='utf-8').read()+';\\n'", 1)
    io.open('assemble16.py', 'w', encoding='utf-8').write(t)
print('ok')
