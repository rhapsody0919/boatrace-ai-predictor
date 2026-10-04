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
R('const st={tab:"ai",stage:"post",scope:"layer",', 'const st={tab:"ai",stage:"post",fscope:"wkA1",scn:{scope:"v20A1",entry:"waku",slit:"any",ff:null,fs:null},')

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
# 類似レース: 層が800件に届かないときのスライダーと文言（v16、ラウンドをそろえた版）
R('推奨: 勝率差・1号艇の級別・勝率トップは必ずそろえ、その中を似ている順', '推奨: ラウンド（優勝戦）・グレード（G1以上）・勝率差・1号艇の級別・勝率トップは必ずそろえ、その中を似ている順')
R('`3条件がそろった過去レース全体（${D.knn3layer.n.toLocaleString()}件）`', '`条件（${D.knn3layer.cond||"勝率差・1号艇の級別・勝率トップ"}）がそろった過去レース全体（${D.knn3layer.n.toLocaleString()}件）`')
R('function curNb(){const all=st.noSS?K.nb.filter(n=>!n.ss):K.nb;return all.slice(0,NS[st.ni]);}',
  'let NSd=NS;function setNS(){const L=K.nb.length;NSd=L<800?[...NS.filter(x=>x<L),L]:NS;$("nSlider").max=NSd.length-1;if(st.ni>NSd.length-1)st.ni=NSd.length-1;}\nfunction curNb(){const all=st.noSS?K.nb.filter(n=>!n.ss):K.nb;return all.slice(0,NSd[st.ni]);}')
t = t.replace('NS[st.ni]', 'NSd[st.ni]')
R('"勝率差の帯・1号艇の級別・勝率トップの艇が今日と同じ過去レースに絞り、', '`${K.pool&&K.pool.layer_cond?K.pool.layer_cond:(K.pool&&K.pool.layer_n?"ラウンド（優勝戦）・":"")+"勝率差の帯・1号艇の級別・勝率トップの艇"}が今日と同じ過去レース${K.pool&&K.pool.layer_n?`（${K.pool.layer_n}件）`:""}に絞り、`+"')
R('setK();$("nSlider").value=st.ni;', 'setK();setNS();$("nSlider").value=st.ni;')
# ファン評価 第2周
R('（${x.res.popularity_3tan}番人気）', '${x.res.popularity_3tan!=null?`（${x.res.popularity_3tan}番人気）`:""}')
R('<span class="cv">${x.t[k]??"—"}<small>', '<span class="cv">${(k==="grade"?(GN[x.t[k]]||x.t[k]):fmtT(k,x.t[k]))??"—"}<small>')
R('${natP!=null?`・全国 ${pc(natP)}`:""}', '${natP!=null?`・比べる相手 ${pc(natP)}`:""}')
R('let NSd=NS;function setNS(){const L=K.nb.length;NSd=L<800?[...NS.filter(x=>x<L),L]:NS;$("nSlider").max=NSd.length-1;if(st.ni>NSd.length-1)st.ni=NSd.length-1;}',
  'let NSd=NS;function setNS(){const L=K.nb.length;NSd=L<800?[...NS.filter(x=>x<L),L]:NS;$("nSlider").max=NSd.length-1;if(!st.niTouched)st.ni=L<800?(NSd.indexOf(30)>=0?NSd.indexOf(30):NSd.length-1):9;if(st.ni>NSd.length-1)st.ni=NSd.length-1;const lay=!!(K.pool&&K.pool.layer_n);$("ssChip").closest(".row").hidden=lay;}')
R('$("nSlider").oninput=e=>{st.ni=+e.target.value;', '$("nSlider").oninput=e=>{st.niTouched=true;st.ni=+e.target.value;')
R('<span>TARGET: 若松12R</span>', '<span>今日: 若松12R</span>')
R('$("sonarCap").textContent=`HITS: ${nb.length}`;', '$("sonarCap").textContent=`表示中: ${nb.length}件`;')
R('const main=rows.filter(r=>r.it.inDist&&!DUP[r.it.key]&&r.rate!=null&&r.n>=5);',
  'const CONDK=st.swKnn==="mix"?["win_gap_band","b1_class","top_boat",...(K.pool&&K.pool.layer_n?["round"]:[]),...(K.pool&&K.pool.layer_cond&&/グレード/.test(K.pool.layer_cond)?["grade","grade_bin"]:[])]:[];\n  const main=rows.filter(r=>r.it.inDist&&!DUP[r.it.key]&&r.rate!=null&&r.n>=5&&!CONDK.includes(r.it.key));')
R('$("likeTop").innerHTML=`<p class="sub">この ${N}件のうち、その項目が今日と同じ（基準は全項目の表に）レースの割合</p>`',
  '$("likeTop").innerHTML=`<p class="sub">この ${N}件のうち、その項目が今日と同じ（基準は全項目の表に）レースの割合</p>${CONDK.length?`<p class="foot">条件でそろえた項目（${CONDK.map(k=>ITEM[k]?ITEM[k].label:k).join("・")}）は、全件が今日と同じなので、ここには出していない</p>`:""}`')
R('<span class="v">${c}/${tot}件</span>', '<span class="v">${pc(c/tot,1)} <small>${c}件</small></span>')
# ソナー: 層が少ないときは件数に合わせた目盛りにする
R('rOf=rk=>18+(R-24)*Math.log10(Math.max(1,rk))/Math.log10(800);', 'LM=K.nb.length<800?K.nb.length:800,lin=LM<100,rOf=rk=>lin?18+(R-24)*Math.max(1,rk)/LM:18+(R-24)*Math.log10(Math.max(1,rk))/Math.log10(800);')
R('[10,100,800].forEach(k=>{h+=`<circle', '(lin?[...new Set([5,10,LM].filter(x=>x<=LM))]:[10,100,800]).forEach(k=>{h+=`<circle')
R('輪は10・100・800番目）', '輪は何番目かの目安）')
# ファン評価 第3周
R('<tr><th>項目</th><th>今日</th><th>同じ（${N}件）</th><th>近いまで</th><th>全レース</th></tr>', '<tr><th>項目（今日の値）</th><th>同じ（${N}件）</th><th>近いまで</th><th>全レース</th></tr>')
R('<br><small class="muted">${r.it.rule}</small></td><td>${fmtT(r.it.key,K.today[r.it.key])??"—"}</td>', '<br><small>今日: ${fmtT(r.it.key,K.today[r.it.key])??"—"}</small><br><small class="muted">${cleanRule(r.it.rule)}</small></td>')
R('const fmtT=', 'const cleanRule=s=>String(s||"").replace(/120 の/g,"").replace(/MD-6 の/g,"").replace(/motor と同じ式で/g,"モーターと同じ数え方で").replace(/motor_rank（1 \\+ 1号艇より高い艇の数）/g,"順位").replace(/motor_rank/g,"順位").replace(/\\|差\\|/g,"差");\nconst fmtT=')
R('.tbl{overflow-x:auto}', '.tbl{overflow-x:auto}#likeAll td:first-child{white-space:normal;min-width:7.5em;max-width:18em;overflow-wrap:anywhere}#likeAll th,#likeAll td{padding:5px 4px;font-size:11.5px}#likeAll td:not(:first-child) small{display:block}#likeAll td small{font-size:10.5px}')
R('`・${all8.n}件では ${pc(all8.hit[t][b-1]/all8.n)}・全国 ${pc(NAT.n_hit[b][RK[t]]/NAT.n)}`', '`${all8.n!==N?`・${all8.n}件では ${pc(all8.hit[t][b-1]/all8.n)}`:""}・全国 ${pc(NAT.n_hit[b][RK[t]]/NAT.n)}`')
R('const LY=st.swKnn==="mix"&&D.knn3layer?D.knn3layer:null;', 'const LY=cmpLayer();')
R('${st.swKnn==="mix"&&D.knn3layer?`条件（${D.knn3layer.cond||"勝率差・1号艇の級別・勝率トップ"}）がそろった過去レース全体（${D.knn3layer.n.toLocaleString()}件）`:"若松の全レース（似ているかを問わない）"}', '${cmpLayer()?cmpLayer().name:"若松の全レース（似ているかを問わない）"}')
R('function renderSonar(nb){', """// 比べる相手: 層の全件を並べている（層＝類似レース全体）ときは、層と同じになるので、全国・6艇ともA1の優勝戦を置く
function cmpLayer(){if(st.swKnn!=="mix")return null;const P=K.pool||{};if(P.layer_n&&P.layer_n===K.nb.length&&D.scn&&D.scn.scopes.allA1Y){const c=D.scn.scopes.allA1Y.cells.all.forms.any,bf={};for(let b=1;b<=6;b++){const w=c.first_boat[b-1],s=c.second_boat[b-1],th=c.third_boat[b-1];bf[b]={win:w,top2:w+s,top3:w+s+th};}return {n:c.n,boat_finish:bf,technique:c.technique,name:`全国・6艇ともA1の優勝戦（${c.n.toLocaleString()}件。類似レースは条件がそろった全件なので、ひとつ広い範囲と比べる）`};}return D.knn3layer?{...D.knn3layer,name:`条件（${D.knn3layer.cond||"勝率差・1号艇の級別・勝率トップ"}）がそろった過去レース全体（${D.knn3layer.n.toLocaleString()}件）`}:null;}
function renderSonar(nb){""")
R('font-size="9.5" opacity=".8" font-family="JetBrains Mono,monospace">${k}番目</text>', 'font-size="14" opacity=".9" font-family="JetBrains Mono,monospace">${k}番目</text>')
R('$("pctLbl").textContent=far?`${N}件目（いちばん遠い）でも、${fc.length}項目のうち', '$("pctLbl").textContent=far?`${N}件目（いちばん遠い）でも、近さの計算に使う${fc.length}項目のうち')
R('$("likeMore").textContent=`全 ${K.items.length} 項目を見る`;', '$("likeMore").textContent=`全 ${K.items.length} 項目（近さの計算に使わない項目も含む）を見る`;')
R('（10・100・800番目の輪）', '（件数に合わせた輪。数字は似ている順の何番目か）')
R('推奨の選び方では、勝率差の帯・1号艇の級別・勝率トップの艇の3つが同じレースだけに絞り、その中を似ている順に並べる（当てはまりへの影響が大きい3つを必ずそろえるため）', '推奨の選び方では、${K.pool&&K.pool.layer_cond?K.pool.layer_cond:"勝率差の帯・1号艇の級別・勝率トップの艇"}が同じレースだけに絞り、その中を似ている順に並べる（優勝戦・準優勝戦はラウンド、G1・SG はグレードもそろえる）')
R('を、今日のレースと比べて近い順に並べた（k近傍）。', 'を、今日のレースと比べて近い順に並べた。')
R('<li>同じ節を除くと、保存している800件から除くので、800件より少なくなる（本番では除いた後に800件をそろえる）</li>', '')
R('.ci .cv{font-family:"JetBrains Mono",monospace;font-size:11.5px;word-break:break-all}', '.ci .cv{font-family:"JetBrains Mono",monospace;font-size:11.5px;word-break:normal;overflow-wrap:anywhere}')
R('<span class="cv">${(k==="grade"?(GN[x.t[k]]||x.t[k]):fmtT(k,x.t[k]))??"—"}<small>今日 ${fmtT(k,K.today[k])??"—"}</small>', '<span class="cv">${String((k==="grade"?(GN[x.t[k]]||x.t[k]):fmtT(k,x.t[k]))??"—").replace(/\\//g,"/\\u200b")}<small>今日 ${String(fmtT(k,K.today[k])??"—").replace(/\\//g,"/\\u200b")}</small>')
# 統計の検証 第9回
R('(N<100?`<div class="warn">${N}件だと割合はぶれやすい（ひげが長い）。棒をタップすると ${all8.n}件での割合も出る</div>`:"")', '(N<100?`<div class="warn">${N}件だと割合はぶれやすい（ひげが長い）。${all8.n!==N?`棒をタップすると ${all8.n}件での割合も出る`:"条件がそろった過去レースの全件を出している"}</div>`:"")')
R("const c=D.scn.scopes.allA1Y.cells.all.forms.any,bf={};for(let b=1;b<=6;b++){const w=c.first_boat[b-1],s=c.second_boat[b-1],th=c.third_boat[b-1];bf[b]={win:w,top2:w+s,top3:w+s+th};}return {n:c.n,boat_finish:bf,technique:c.technique,name:`全国・6艇ともA1の優勝戦（${c.n.toLocaleString()}件。類似レースは条件がそろった全件なので、ひとつ広い範囲と比べる）`};",
  "if(D.knn5layer)return {...D.knn5layer,name:`グレードを問わない優勝戦（勝率の3条件はそろえる）${D.knn5layer.n}件。類似レース${K.nb.length}件はこの中に入る、ひとつ広い範囲`};const c=D.scn.scopes.allA1Y.cells.all.forms.any,bf={};for(let b=1;b<=6;b++){const w=c.first_boat[b-1],s=c.second_boat[b-1],th=c.third_boat[b-1];bf[b]={win:w,top2:w+s,top3:w+s+th};}return {n:c.n,boat_finish:bf,technique:c.technique,name:`全国・6艇ともA1の優勝戦（${c.n.toLocaleString()}件。類似レースとは条件が違う）`};")
R('に絞り、`+"', 'に絞り、${K.pool&&K.pool.layer_cond&&/グレード/.test(K.pool.layer_cond)?"（名前の違う決勝＝王座決定戦・賞金女王決定戦・決勝戦などは、まだ含めていない）":""}`+"')
# ユーザー要望（2026-10-04）: ソナーの点は長押しでレース情報、何が似ているは折りたたみ
R('<span>今日: 若松12R</span>', '<span>今日: 若松12R</span>')
R('<div class="scope-cap"><span>今日: 若松12R</span>', '<div class="sonar-tip" id="sonarTip" hidden></div><div class="scope-cap"><span>今日: 若松12R</span>')
R("""    <div class="likes">
      <h3>何が似ている？</h3>
      <div id="likeTop"></div>""", """    <details class="more likes"><summary>何が似ている？（項目ごとに、今日と同じだった割合）</summary>
      <div id="likeTop" style="margin-top:6px"></div>""")
R("""<table id="likeAll"></table></div></details>
    </div>""", """<table id="likeAll"></table></div></details>
    </details>""")
R('<p class="foot">中心に近い点ほど、今日のレースと出走表の数字が近い（似ている順の何番目かで置いている。輪は何番目かの目安）。扇は1着になった艇。点を押すとそのレースを今日と見比べる</p>',
  '<p class="foot">中心に近い点ほど、今日のレースと出走表の数字が近い（似ている順の何番目かで置いている。輪は何番目かの目安）。扇は1着になった艇。点を長押し（パソコンはマウスを重ねる）とレースの情報、タップするとそのレースを今日と見比べる</p>')
R('svg.querySelectorAll("[data-race]").forEach(e=>e.onclick=ev=>{ev.stopPropagation();', 'wireSonarTip(svg,nb);svg.querySelectorAll("[data-race]").forEach(e=>e.onclick=ev=>{ev.stopPropagation();if(lpFired){lpFired=false;return;}')
R('function renderSonar(nb){', """// ソナーの点の長押し（スマホ）・マウスを重ねる（パソコン）で、レースの情報を出す
let lpFired=false,lpTimer=null;
function sonarTipHtml(x){return `<b>${x.r}番目に似ている</b><br>${x.d} ${x.v} ${x.rn}R ${GN[x.g]||x.g||""} ${RN[x.rd]||x.rd||""}<br><span class="bnrow">${(x.o||[]).map(bn).join("")}</span> ${x.res&&x.res.technique||""}${x.res&&x.res.payout_3tan?`　3連単 ${x.res.payout_3tan.toLocaleString()}円`:""}`;}
function wireSonarTip(svg,nb){const tip=$("sonarTip"),box=svg.closest(".scope");const show=(e)=>{const x=nb[+e.dataset.race];if(!x)return;tip.innerHTML=sonarTipHtml(x);tip.hidden=false;const br=box.getBoundingClientRect(),er=e.getBoundingClientRect();tip.style.left=Math.max(4,Math.min(br.width-224,er.left-br.left-100))+"px";tip.style.top=(er.top-br.top+14)+"px";};const hide=()=>{tip.hidden=true;};
  svg.querySelectorAll("[data-race]").forEach(e=>{e.addEventListener("pointerdown",ev=>{if(ev.pointerType==="mouse")return;clearTimeout(lpTimer);lpTimer=setTimeout(()=>{lpFired=true;show(e);},450);});["pointerup","pointercancel","pointerleave"].forEach(k=>e.addEventListener(k,ev=>{if(ev.pointerType!=="mouse")clearTimeout(lpTimer);}));e.addEventListener("mouseenter",()=>show(e));e.addEventListener("mouseleave",hide);e.addEventListener("contextmenu",ev=>ev.preventDefault());});
  document.addEventListener("pointerdown",ev=>{if(!ev.target.closest||!ev.target.closest("#sonar [data-race]"))hide();},{once:true});}
function renderSonar(nb){""")
R('.tabs{display:grid;', '.scope{position:relative}.sonar-tip{position:absolute;z-index:3;width:220px;background:var(--card);color:var(--text);border:1px solid var(--accent-strong);border-radius:8px;padding:6px 8px;font-size:12px;line-height:1.5;box-shadow:0 4px 14px rgba(0,0,0,.35);pointer-events:none}.sonar-tip .bnrow{display:inline-flex;gap:2px;vertical-align:middle}#sonar [data-race]{stroke:transparent;stroke-width:16px}#sonar{-webkit-touch-callout:none;-webkit-user-select:none;user-select:none;touch-action:manipulation}\n.tabs{display:grid;')
# 「くわしく」→「使っている項目」（ユーザー指示 2026-10-04: 何の項目で算出しているかは残す、重みは不要）
R('<details class="fold"><summary>くわしく</summary>', '<details class="fold"><summary>使っている項目（どの数字から出しているか）</summary>')
_i = t.index('function renderDetail'); _j = t.index('function order', _i)
t = t[:_i] + """function renderDetail(){
  const grp=[["レースの条件",["venue","race_number_band","race_number","grade","grade_bin","round","series_day","is_final_day"]],["選手の力関係",["class_all6","n_A1","b1_class","win_gap_band","top_boat","nat_win_6","nat_win_rank_4","b1_nat_win","loc_win_6","recent_win30_6","recent_top3_30_6"]],["スタート",["st_mean30_6","b1_st_rank_band"]],["モーター・ボート",["motor_2_6","b1_motor_rank_band","boat_2_6","b1_boat_rank_band"]],["体重・年齢・地元",["age_6","weight_6","n_local"]],["天候・水面",["weather","wind_bin","wind_vector","wave_bin"]],["展示",["exh_time_diff_6"]]];
  const lab=k=>ITEM[k]?ITEM[k].label:null;
  const used=grp.map(([g,ks])=>[g,ks.filter(k=>ITEM[k]&&ITEM[k].inDist).map(lab)]).filter(([,l])=>l.length);
  const notUsed=K.items.filter(it=>!it.inDist).map(it=>it.label);
  const cond=K.pool&&K.pool.layer_cond?K.pool.layer_cond:"勝率差の帯・1号艇の級別・勝率トップの艇";
  $("detail").innerHTML=`<h3>来る艇の条件</h3>
  <ul><li>材料: 今節の平均着順点・全国勝率・当地勝率・直近30走の1着率・モーター2連率・ボート2連率・過去30走の平均ST・展示タイム（展示の後だけ）。全国勝率・当地勝率・モーター2連率・ボート2連率は出走表の値、展示タイムは直前情報の値。直近30走の1着率・過去30走の平均ST・今節の平均着順点は、その選手の過去のレース結果から計算している</li>
  <li>着順: 1着・2着以内・3着以内。過去レースの結果を数えている</li>
  <li>今日の風・波: 風速と波高（展示の時点の値）</li></ul>
  <h3>類似レース</h3>
  <ul><li>必ずそろえる条件: ${cond}</li>
  <li>近さを測る項目（${st.stage==="post"?"展示後":"展示前"}）:<ul>${used.map(([g,l])=>`<li>${g}: ${l.join("・")}</li>`).join("")}</ul></li>
  ${notUsed.length?`<li>見比べには出すが、近さには使っていない項目: ${notUsed.join("・")}</li>`:""}
  <li>${st.stage==="post"?"展示後は、展示タイム・天候・風・波も近さに入れている":"展示前は、展示タイム・天候・風・波はまだ分からないので使っていない"}</li></ul>
  <h3>展開シナリオ</h3>
  <ul><li>進入: 過去レースの本番の進入コース（どの艇が何コースに入ったか）</li>
  <li>スリットの形: 過去レースの本番のスタートタイミングを、コース順に並べて判定</li>
  <li>結果: 1〜3着の艇・決まり手・3連単の払戻</li></ul>
  <p class="foot">期間はどれも 2019-04-01〜2026-09-26（例のレースの前日まで）。棒のひげ（95%の幅）は、レースどうしが独立だとして計算している。類似レースは会場や同じ節に固まることがあるので、実際の幅はやや広い</p>`;
}
""" + t[_j:]
io.open('template16.html', 'w', encoding='utf-8').write(t)
print('ok')
