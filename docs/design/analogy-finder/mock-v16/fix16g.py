# -*- coding: utf-8 -*-
# 今日のスタートの手がかりパネルを展開シナリオに組み込む
import io, re
fn = 'part16_scn.js'
t = io.open(fn, encoding='utf-8').read()
def R(a, b):
    global t
    assert t.count(a) == 1, (t.count(a), a[:60]); t = t.replace(a, b)
R('function slitScene(stc, h = 110) {', 'function slitScene(stc, h = 110, ref = null) {')
R('const mn = Math.min(...stc), gid', 'const mn = Math.min(...stc, ...(ref || [])), gid')
i = t.index('const boats = stc', t.index('function slitScene'))
j = t.index('.join("");', i) + len('.join("");')
t = t[:j] + '\n  const refs = ref ? ref.map((v, i) => { const x = lineX - ((v - mn) / SPB) * L, y = top + lane * i + lane / 2; return `<line x1="${x}" y1="${y - lane * 0.48}" x2="${x}" y2="${y + lane * 0.48}" stroke="#e8d089" stroke-width="1.8" stroke-dasharray="3 2"/>`; }).join("") : "";' + t[j:]
k = t.index('${boats}', t.index('function slitScene'))
t = t[:k] + '${boats}${refs}' + t[k + len('${boats}'):]
R('<h3><span class="stepn">2</span>スタートはどう並ぶ？（スリットの形）</h3>', '${hintHtml()}\n  <h3><span class="stepn">2</span>スタートはどう並ぶ？（スリットの形）</h3>')
# 当てはまる形に札
R('<span class="k">${l}</span>${k === "any" ? "" : slitScene(SLIT_EX[k])}', '<span class="k">${l}${hintForms().has(k) ? `<span class="hintb">平均STから出やすい</span>` : ""}</span>${k === "any" ? "" : slitScene(SLIT_EX[k])}')
io.open(fn, 'w', encoding='utf-8').write(t)
# wireHint を renderScn の最後で呼ぶ
t = io.open(fn, encoding='utf-8').read()
m = list(re.finditer(r'\$\("scnScope"\)', t))
assert m, 'no scnScope'
t = t[:m[0].start()] + 'wireHint();\n  ' + t[m[0].start():]
io.open(fn, 'w', encoding='utf-8').write(t)

t = io.open('make16.py', encoding='utf-8').read()
a = "io.open('part16_scn.js', encoding='utf-8').read()"
assert t.count(a) == 1
t = t.replace(a, a + " + '\\n' + io.open('part16_hint.js', encoding='utf-8').read()")
add = r'''# 今日のスタートの手がかり
R('.tabs{display:grid;', '.hint{border:1px solid var(--accent-strong);border-radius:10px;padding:10px 12px;display:grid;gap:8px;background:var(--card)}.hint-h{display:grid;gap:2px}.hint-h b{font-size:14px}.hint-h .muted{font-size:11.5px}.hint-pic svg{width:100%;height:auto;border-radius:6px;display:block}.hint-t th,.hint-t td{padding:3px 4px;font-size:11.5px;text-align:center;font-family:"JetBrains Mono",monospace}.hint-t th:first-child{text-align:left;font-family:inherit;white-space:nowrap}.hint-t td small{display:block;font-size:9.5px;color:var(--muted)}.hint-t td.dim{opacity:.5}.hint h4{margin:2px 0 0;font-size:13px}.hintcs{display:grid;gap:6px}.hintc{display:grid;gap:2px;text-align:left;border:1px solid var(--border);border-radius:8px;background:var(--sunken);color:var(--text);padding:6px 8px;font:inherit;font-size:12px;cursor:pointer}.hintc .hr{color:var(--text2)}.hintc b{font-family:"JetBrains Mono",monospace}.hintb{display:inline-block;margin-left:6px;font-size:10px;font-weight:700;color:var(--card);background:var(--accent-strong);border-radius:4px;padding:1px 5px;vertical-align:1px}\n.tabs{display:grid;')
R('scn:{scope:"v20A1",', 'scn:{hsrc:"C",scope:"v20A1",')
'''
t = t.replace("io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", add + "io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", 1)
io.open('make16.py', 'w', encoding='utf-8').write(t)
t = io.open('assemble16.py', encoding='utf-8').read()
if 'D.hint' not in t:
    t = t.replace("+';\\n'", "+';\\n'+(('D.hint='+io.open('../slitpred/slitpred2_hint.json',encoding='utf-8').read()+';\\n') if __import__('os').path.exists('../slitpred/slitpred2_hint.json') else '')", 1)
    io.open('assemble16.py', 'w', encoding='utf-8').write(t)
print('ok')
