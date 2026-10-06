# -*- coding: utf-8 -*-
# template13.html から template14.html を作る（AI タブを「艇番ごとの材料」に置き換える）
import io
t = io.open('template13.html', encoding='utf-8').read()


def R(x, y):
    global t
    assert t.count(x) == 1, ("NF", t.count(x), x[:80])
    t = t.replace(x, y)


a = t.index('  <section class="block" id="secAi"')
b = t.index('</section>', a) + 10
t = t[:a] + io.open('part14_ai.html', encoding='utf-8').read() + t[b:]
R('data-t="ai" aria-selected="true">AIの見立て</button>', 'data-t="ai" aria-selected="true">艇番ごとの材料</button>')
a = t.index('function renderAi(){')
b = t.index('// ---------- くわしく ----------')
t = t[:a] + io.open('part14_ai.js', encoding='utf-8').read() + t[b:]
R('const st={tab:"ai",', 'const st={tab:"ai",pb:1,')
R('$("two").onchange=e=>{st.two=e.target.checked;render();};',
  '$("two").onchange=e=>{st.two=e.target.checked;if(st.two&&st.b2===st.pb)st.b2=st.pb===6?5:st.pb+1;render();};')
R('.tabs{display:grid;', '''.pbar{display:grid;gap:0;grid-template-columns:1fr}
.pbar .v{font-family:"JetBrains Mono",monospace;font-size:11.5px;text-align:right}
.pg{display:grid;grid-template-columns:minmax(0,1fr) 4.5em;gap:2px 8px;font-size:12px;padding:3px 0;border-top:1px dotted var(--border)}
.pg .v{font-family:"JetBrains Mono",monospace;text-align:right}.pg .muted{grid-column:1/-1;font-size:11.5px}
.tabs{display:grid;''')
R('const FLOW=', 'const LINE6={1:"#e8d089",2:"#94a3b8",3:"#ef5350",4:"#42a5f5",5:"#f0c419",6:"#4caf50"};\nconst FLOW=')
io.open('template14.html', 'w', encoding='utf-8').write(t)
print('ok')
