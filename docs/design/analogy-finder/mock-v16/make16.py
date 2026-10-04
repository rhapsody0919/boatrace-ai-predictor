# -*- coding: utf-8 -*-
# template15.html から template16.html を作る（タブ①を若松の数えた値に、タブ③を展開シナリオに）
import io
t = io.open('template15.html', encoding='utf-8').read()
def R(x, y, c=1):
    global t
    assert t.count(x) == c, ("NF", t.count(x), x[:90])
    t = t.replace(x, y)

# タブ
R('<button type="button" role="tab" data-t="res" aria-selected="false">決まり方</button>',
  '<button type="button" role="tab" data-t="scn" aria-selected="false">展開シナリオ</button>')
R('''function order(){const m={ai:"secAi",sim:"secSim",res:"secRes"};Object.entries(m).forEach(([k,id])=>$(id).hidden=st.tab!==k);''',
  '''function order(){$("secAi").hidden=st.tab!=="ai";$("secSim").hidden=$("secRes").hidden=st.tab!=="sim";$("secScn").hidden=st.tab!=="scn";''')
R('$("sharedN").hidden=st.tab==="ai";', '$("sharedN").hidden=st.tab!=="sim";')
R('<h2 id="hRes">決まり方（類似している過去レースの傾向）</h2>', '<h2 id="hRes">似たレースの決まり方（類似している過去レースの傾向）</h2>')

# タブ①: 範囲の切り替えを外し、AI の見立ては畳んだ補助にする
a = t.index('<div class="row"><span class="lbl">範囲</span><div class="seg" id="scopeSeg">')
b = t.index('</div></div>', a) + 12
t = t[:a] + '<div class="row"><span class="lbl">範囲</span><div class="seg" id="fscopeSeg"></div></div>' + t[b:]
a = t.index('<p class="foot">外側ほど6艇中の順位が上。「勝率の力関係が同じ」')
b = t.index('</p>', a) + 4
t = t[:a] + '<p class="foot">外側ほど、6艇の中で上。実線が今日、点線が選んだ範囲でこの艇番が来たときの平均</p>' + t[b:]
R('''    <div style="border-top:2px solid var(--border);margin-top:6px;padding-top:12px;display:grid;gap:10px" id="aiWrap">
      <span class="eyebrow">AI の見立て</span>''',
  '''    <details class="more" id="aiWrap"><summary>AI の見立て（補助）: ほかの材料をそろえたうえで、どの材料が効くか</summary><div style="display:grid;gap:10px;margin-top:8px">''')
R('''    <div style="border-top:1px dashed var(--border);padding-top:10px;display:grid;gap:8px">
      <h3>会場・グレード・ラウンドで比べる</h3>''', '''    <div hidden>
      <h3>会場・グレード・ラウンドで比べる</h3>''')
R('''    <div style="border-top:1px dashed var(--border);padding-top:10px;display:grid;gap:8px">
      <h3 id="hToday"></h3>''', '''    <div hidden>
      <h3 id="hToday"></h3>''')
R('''      <div id="aiPre" class="warn" hidden>展示前の AI の見立ては、出走表の時点のモデルが学習されると出る（モックの版にはまだ無い）。展示後に切り替えると見られる</div>
    </div>
  </section>''', '''      <div id="aiPre" class="warn" hidden>展示前の AI の見立ては、出走表の時点のモデルが学習されると出る（モックの版にはまだ無い）。展示後に切り替えると見られる</div>
    </div></details>
  </section>''')

# タブ③の枠
R('''  </section>
  </div>

  <details class="fold">''', '''  </section>
  <section class="block" id="secScn" aria-labelledby="hScn" hidden>
    <h2 id="hScn">展開シナリオ</h2>
    <div id="scnOut"></div>
  </section>
  </div>

  <details class="fold">''')

# JS
a = t.index('// ---------- 来る艇の条件（数えた値） ----------')
b = t.index('// ---------- くわしく ----------')
t = t[:a] + io.open('part16_facts.js', encoding='utf-8').read() + '\n' + io.open('part16_scn.js', encoding='utf-8').read() + '\n' + t[b:]
R('order();renderSim();renderAi();renderC();renderFacts();', 'order();renderSim();renderAi();renderFacts();renderScn();')
R('$("hFacts").textContent=`${st.pb}号艇が${RT[st.rank]}に来るとき`;', '$("hFacts").textContent=`${st.pb}号艇が${RT[st.rank]}に入ったのは、どんなとき？`;')
R('["radar","themeList","cOut","aiPanel"]', '["radar","themeList"]')
R('document.querySelectorAll("#scopeSeg button").forEach(b=>b.onclick=()=>{st.scope=b.dataset.s;render();});\n', '')
R('const st={tab:"ai",stage:"post",scope:"layer",', 'const st={tab:"ai",stage:"post",fscope:"wkA1",scn:{scope:"v20",entry:"waku",slit:"any",ff:null,fs:null},')

# CSS
R('.tabs{display:grid;', '''.effs{display:grid;gap:10px}
.eff{border:1px solid var(--border);border-radius:10px;padding:10px 12px;display:grid;gap:6px;background:var(--card)}
.eff.weak{opacity:.6}
.eff .eh{display:flex;flex-wrap:wrap;align-items:baseline;gap:2px 8px;font-size:13.5px}.eff .eh .md{order:3;flex-basis:100%;font-size:11px;color:var(--muted);font-weight:400}
.eff .rkn{font-family:"JetBrains Mono",monospace;font-size:11px;color:var(--muted);border:1px solid var(--border);border-radius:50%;width:1.7em;height:1.7em;display:grid;place-items:center}
.eff .gap{margin-left:auto;font-size:12px;color:var(--accent-strong);font-weight:700}
.eff .pair{display:grid;grid-template-columns:1fr 1fr;gap:8px}.eff .pair>div{display:grid;gap:0;background:var(--sunken);border-radius:6px;padding:6px 8px;font-size:11.5px}.eff .pair b{font-family:"JetBrains Mono",monospace;font-size:20px;line-height:1.2}.eff .pair small{color:var(--muted);font-size:10.5px}
.eff .today{margin:0;font-size:12.5px;background:var(--sunken);border-radius:6px;padding:6px 8px}
.strip{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;height:96px}
.strip .col{display:grid;grid-template-rows:14px 1fr 16px;text-align:center;font-size:10.5px;color:var(--muted)}
.strip .col.on{color:var(--text)}.strip .col.on .rk{font-weight:700;color:var(--accent-strong)}
.strip .pv{font-family:"JetBrains Mono",monospace}
.strip .plot{position:relative;border-bottom:1px solid var(--border)}
.strip .bar{position:absolute;left:18%;right:18%;bottom:0;border-radius:3px 3px 0 0;opacity:.75}
.strip .col.on .bar{opacity:1;outline:2px solid var(--accent-strong);outline-offset:1px}
.strip .usual{position:absolute;left:0;right:0;border-top:2px dotted var(--hit)}
.strip .rk{white-space:nowrap;font-size:10px}
.ents{display:grid;gap:6px}
.ent{display:grid;grid-template-columns:1fr auto auto;gap:10px;align-items:center;text-align:left;border:1px solid var(--border);border-radius:8px;padding:8px 10px;background:var(--card);color:var(--text);font:inherit;font-size:13px;cursor:pointer}
.ent.sub{margin-left:18px;font-size:12.5px;padding:6px 10px}
.ent[aria-pressed="true"]{border-color:var(--accent-strong);box-shadow:inset 3px 0 0 var(--accent-strong);background:var(--sunken)}
.ent .sh{font-family:"JetBrains Mono",monospace;font-weight:700}
.ent .b1{font-size:11.5px;color:var(--muted);min-width:7.5em;text-align:right}
.todayb{margin-left:6px;font-size:10.5px;background:var(--accent-strong);color:var(--card);border-radius:4px;padding:1px 5px;font-weight:700}
.chips{display:flex;flex-wrap:wrap;gap:6px}
.chip.slit{display:grid;gap:1px;text-align:left;font-size:11px;border-radius:10px;padding:5px 10px}.chip.slit[aria-pressed="false"]{border:1px solid var(--border);color:var(--text2);text-decoration:none}.chip.slit[aria-pressed="true"]{background:var(--sunken);box-shadow:inset 0 0 0 1px var(--accent-strong)}
.chip.slit .k{font-size:12.5px;font-weight:700}
.stepn{display:inline-grid;place-items:center;width:1.5em;height:1.5em;border-radius:50%;background:var(--accent-strong);color:var(--card);font-size:12px;margin-right:6px}
table.rl{font-size:11.5px;border-collapse:collapse;white-space:nowrap}table.rl th,table.rl td{padding:4px 6px;border-bottom:1px solid var(--border);text-align:left}.mono{font-family:"JetBrains Mono",monospace}
.pats{display:grid;grid-template-columns:1fr 1fr;gap:8px}
.pat{display:grid;gap:4px;text-align:left;border:1px solid var(--border);border-radius:8px;background:var(--card);color:var(--text);padding:6px;font:inherit;font-size:11px;cursor:pointer}
.pat.any{grid-column:1/-1}
.pat .k{font-size:12.5px;font-weight:700}.pat .fq{color:var(--text2)}
.pat svg{width:100%;height:auto;display:block;border-radius:5px}
.pat[aria-pressed="true"]{border:2px solid var(--accent-strong);padding:5px;background:var(--sunken)}
@media (max-width:360px){.pats{grid-template-columns:1fr}}
.tabs{display:grid;''')
a = t.index('<div class="note"><b>モック Version 15')
b = t.index('</div>', a) + 6
t = t[:a] + '<div class="note"><b>モック Version 16（2026-10-04）</b>。3タブ: 来る艇の条件（数えた値。範囲は今日と同じ級別の組み合わせが既定）／似たレース（似たレースの決まり方も同じタブ）／展開シナリオ（進入 → スリット → 結果）。上の「展示前／展示後」で切り替わる。数字はすべて実データ（本番 DB、2019-04-01〜例のレースの前日まで）。例のレースは <b>若松 12R（2026-09-27、G1 ヤングダービー優勝戦、6艇とも A1）</b>で、発走前に見ている想定（結果は 4-1-5 差し、3連単 11,580円）。</div>' + t[b:]
a = t.index('<section class="confirm"')
b = t.index('</section>', a) + 10
t = t[:a] + '''<section class="confirm" aria-labelledby="cf">
    <h2 id="cf">見てほしい点</h2>
    <ol>
      <li>来る艇の条件: 材料ごとに「6艇で一番良いとき／一番悪いとき」の割合と、今日の艇の一文。範囲の既定は「若松・6艇とも A1」（今日と同じ級別の組み合わせ）。全レースにすると格の差の影響で勝率が強く出る</li>
      <li>来る艇の条件の判定: 番号の順位をやめ、「差が大きい／差は小さい／差ははっきりしない」の3段階にした</li>
      <li>似たレース: 今までどおり（スライダー・ソナー・何が似ているか・1件ずつ）。その下に似たレースの決まり方（サンキー図・3連単）</li>
      <li>展開シナリオ: ①進入 → ②スリットの形 → ③結果（1着・3着以内・決まり手・万舟・着順の流れ・3連単）。30件未満は1件ずつの一覧。展示後は今日の展示の進入に印</li>
    </ol>
  </section>''' + t[b:]
R('${col[p][b]||""}</text>`;}});', '${col[p][b]?col[p][b].toLocaleString()+"件":""}</text>`;}});')
# 「似たレース」→「類似レース」（ユーザー指示 2026-10-04）
t = t.replace('類似レース（類似している過去レース）', '類似レース').replace('似たレース（類似している過去レース）', '類似レース')
t = t.replace('似たレースの決まり方（類似している過去レースの傾向）', '類似レースの決まり方')
t = t.replace('似たレース', '類似レース')
# 第1周のファン評価の直し
import re as _re
R('.lk .lkb{display:block}', '.lk .lkb{display:block}.lk .lkb .wtrk{display:block}')
R('@media (max-width:480px){.br{grid-template-columns:5em 1fr 5.6em}', '@media (max-width:480px){.br{grid-template-columns:5em 1fr auto}.pats{grid-template-columns:1fr}')
R('.br{display:grid;grid-template-columns:5.8em 1fr 6.2em;', '.br{display:grid;grid-template-columns:5.8em 1fr auto;')
R('$("sharedN").hidden=st.tab!=="sim";', '$("sharedN").hidden=st.tab!=="sim";$("rankSeg").closest(".row").hidden=st.tab==="scn";')
R('$("pctLbl").textContent=far?`${N}件目のレースでも ○${fc.filter(m=>m===2).length} △${fc.filter(m=>m===1).length} ×${fc.filter(m=>m===0).length}`:"";',
  '$("pctLbl").textContent=far?`${N}件目（いちばん遠い）でも、${fc.length}項目のうち ${fc.filter(m=>m===2).length}項目が同じ・${fc.filter(m=>m===1).length}項目が近い`:"";')
R('` △込み ${pc(nr,0)}`', '` 近いも含め ${pc(nr,0)}`')
R('展示タイム・天候・風・波は、出走表の時点では分からないので近さの計算に入れていない</li>', '${st.stage==="post"?"展示後は、展示タイム・天候・風・波も近さの計算に入れている":"展示前は、展示タイム・天候・風・波は分からないので近さの計算に入れていない"}</li>')
R('点線は全国の全レース</li>', '点線は、棒の上の凡例に書いた比べる相手（類似レースのタブでは、条件がそろった過去レース全体）</li>')
R('pb:4,', 'pb:1,')
t = _re.sub(r'K\.today\[([^\]]+)\]', r'fmtT(\1,K.today[\1])', t)
R('const isBad=', 'const fmtT=(k,v)=>/^recent_/.test(String(k))&&typeof v==="string"?v.split("/").map(x=>x!==""&&!isNaN(+x)?Math.round(+x*100)+"%":x).join("/"):v;\nconst isBad=')
# タブ②のサンキー図も小さい画面で読めるように
R('<svg id="sankey" viewBox="0 0 640 400"', '<svg id="sankey" viewBox="0 0 400 400"')
R('const X=[40,300,560],W=26,', 'const X=[44,188,332],W=22,')
R('font-size="10" fill="#e8d089" font-family="JetBrains Mono,monospace">${col[p][b]', 'font-size="12" fill="#e8d089" font-family="JetBrains Mono,monospace">${col[p][b]')
R('text-anchor="middle" font-size="12" font-weight="700" fill="#f3ead0" font-family="Zen Kaku Gothic New,sans-serif">${tx}', 'text-anchor="middle" font-size="14" font-weight="700" fill="#f3ead0" font-family="Zen Kaku Gothic New,sans-serif">${tx}')
R('.eff.weak{opacity:.6}', '.eff.weak .pair,.eff.weak .strip,.eff.weak .eh b,.eff.weak .gap{opacity:.6}')
R('.hero .n{', '.hero .n small{font-size:14px;margin-left:2px}.hero .n{')
R('.tabs{display:grid;', '.stripcap{margin:0;font-size:11px;color:var(--muted)}.rlist{display:grid;gap:6px}.rc{border:1px solid var(--border);border-radius:8px;padding:6px 8px;display:grid;gap:2px;font-size:12px}.rc .bnrow{display:inline-flex;gap:2px;vertical-align:middle}.rc3{color:var(--text2);font-size:11.5px}\n.tabs{display:grid;')
io.open('template16.html', 'w', encoding='utf-8').write(t)
print('ok')
