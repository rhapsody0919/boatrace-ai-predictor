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
# ---------- ファンレビューの日本語の直し（49項目。文言と表示の書式だけ。数え方・データは変えない） ----------
# 上部
R('<span class="lbl">情報</span>', '<span class="lbl">時点</span>')
R('<div class="row"><span class="lbl">範囲</span><div class="seg" id="fscopeSeg"></div></div>', '<div class="row"><span class="lbl">数えるレース</span><div class="seg" id="fscopeSeg"></div></div>')
R('<p class="foot">外側ほど、6艇の中で上。実線が今日、点線が選んだ範囲でこの艇番が来たときの平均</p>', '<p class="foot">外側ほど6艇の中で上位。実線は今日の順位、点線は同じ艇番が来たレースでの平均の順位</p>')
R('$("hFacts").textContent=`${st.pb}号艇が${RT[st.rank]}に入ったのは、どんなとき？`;', '$("hFacts").textContent=`${st.pb}号艇が${RV(st.rank)}のは、どんなとき？`;')
R('${n}号艇と比べる</option>', '${n}号艇</option>')
R('<div class="row" style="justify-content:space-between"><span class="foot">少なく</span><span class="foot" id="pctLbl"></span><span class="foot">多く</span></div>',
  '<div class="row" style="justify-content:space-between"><span class="foot">少なく</span><span class="foot">多く</span></div><p class="foot" id="pctLbl" style="margin:2px 0 0"></p>')
# AI の見立て
R('<summary>AI の見立て（補助）: ほかの材料をそろえたうえで、どの材料が効くか</summary>', '<summary>AIの見立て（補助）: ほかの項目をそろえたうえで、どの項目が効くか</summary>')
R('<p class="sub">AI（寄与度用のモデル。AI 予想とは別）の見立て。いろいろなレースでその艇番の見込みが上下するとき、その上下をどの材料が生んでいるかの割合。枠は艇番で決まっているので入れていない</p>',
  '<p class="sub" id="aiSub">AIが「この艇番の勝ちやすさを動かしているのはどの項目か」を見た割合（AI予想とは別の分析）。大きいほど、その項目しだいで結果が動きやすい</p>')
R('aria-label="材料の割合の図"', 'aria-label="項目の割合の図"')
R('''    <details class="more"><summary>展示前の見立て</summary><p class="foot" style="margin-top:6px">本番は朝に出走表の時点の見立てを出し、展示の後にこの値へ置き換える。展示前は展示タイムと天候・水面を使わないので、その行は出さない。モックの版（2026-10-02）には出走表の時点のモデルが無いので、空にしている。</p></details>
''', '')
R('<p class="foot">上の数えた値は、ほかの材料や選手の強さが全部まざった率。AI の見立ては、それらを別に数えた後の残りなので、向きが逆になることがある（例: 級別やモーター）。AI の見立てで、原因の断定ではない。割合が大きい材料ほど、その艇番の見込みを大きく上下させているという意味で、「それがあれば勝てる」という意味ではない。</p>',
  '<p class="foot" id="aiFoot">上の数えた値には選手の強さなどが全部まざっている。AIはそれを分けて見るので、向きが逆になることがある（例: 級別・モーター）。原因の断定ではない。割合が大きい項目ほど、その艇番の結果を大きく動かしているという意味で、「それがあれば勝てる」という意味ではない。</p>')
R('<div id="aiPre" class="warn" hidden>展示前の AI の見立ては、出走表の時点のモデルが学習されると出る（モックの版にはまだ無い）。展示後に切り替えると見られる</div>',
  '<div id="aiPre" class="warn" hidden>展示前のAIの見立ては準備中。展示後に切り替えると見られる</div>')
R('["radar","themeList"].forEach(id=>{', '["hAi","aiSub","aiFoot"].forEach(id=>$(id).hidden=pre);["radar","themeList"].forEach(id=>{')
R('$("hAi").textContent = `${A}号艇が${RT[st.rank]}に入るかを左右しやすい材料`;', '$("hAi").textContent = `${A}号艇が${st.rank === 1 ? "1着になる" : RT[st.rank] + "に入る"}かを左右しやすい項目`;')
R('["venue", "会場・R番号"],', '["venue", "会場・レース番号"],')
R('${BP.dir[m][A][g] || ""}${Bb ? `<br>${Bb}号艇: ${BP.dir[m][Bb][g] || ""}` : ""}', '${fmtDir(g, BP.dir[m][A][g])}${Bb ? `<br>${Bb}号艇: ${fmtDir(g, BP.dir[m][Bb][g])}` : ""}')
_a = t.index('`<p class="foot">割合は、その艇番の見込みが上下するうち'); _b = t.index('</p>`;', _a) + 6
t = t[:_a] + '''`<p class="foot">割合は、プラスにもマイナスにも動かした大きさを合わせて分けたもの（${fmtD(BP.period)}）。中を開くと、項目ごとの割合と、どちら向きに動くかが出る。${vb ? "2艇を重ねたときは割合の形の比較で、効き方の大きさの比較ではない。" : ""}${A === 1 ? "1号艇は、枠の有利さと選手の格がまざる分（約15%）を枠に入れているので、選手の実力が小さめに出る。" : ""}</p>`;''' + t[_b:]
R('このモデルの集計期間（約1年）では', 'AIの集計期間（約1年）では')
R('モデルの学習の揺れは入っていない', 'AIの学習の揺れは入っていない')
# 共通の関数: 項目名・基準の文・値の書式・AIの向きの文（data.js はそのまま、表示の前に置き換える）
R('const fmtT=(k,v)=>/^recent_/.test(String(k))&&typeof v==="string"?v.split("/").map(x=>x!==""&&!isNaN(+x)?Math.round(+x*100)+"%":x).join("/"):v;',
  r'''const LABEL={race_number_band:"レース番号（1〜4R／5〜8R／9〜12R）",race_number:"レース番号",n_A1:"A1の艇数",win_gap_band:"1号艇と勝率トップの勝率差（5段階）",top_boat:"勝率トップの艇",nat_win_rank_4:"6艇の勝率順位",recent_top3_30_6:"6艇の直近30走の3連率",st_mean30_6:"6艇の平均ST（直近30走）",b1_st_rank_band:"1号艇の平均ST順位（2位ごと）",b1_motor_rank_band:"1号艇のモーター2連率の順位（2位ごと）",b1_boat_rank_band:"1号艇のボート2連率の順位（2位ごと）",wind_bin:"風速",wave_bin:"波高",grade_bin:"一般戦かどうか",is_final_day:"最終日かどうか",exh_time_diff_6:"6艇の展示タイムの差（平均との差）"};
const RULE={venue:"同じ会場",race_number_band:"区分（1〜4R／5〜8R／9〜12R）が同じ",race_number:"同じ",b1_class:"同じ",class_all6:"6艇とも級別が同じ",n_A1:"同じ",win_gap_band:"1号艇と勝率トップの差が同じ区分（5段階）",top_boat:"同じ（勝率が同じなら艇番の小さいほう）",nat_win_6:"6艇の全国勝率が、平均して0.50以内の差",nat_win_rank_4:"勝率の順位が同じ艇が4艇以上",b1_nat_win:"差が0.50以内",loc_win_6:"6艇の当地勝率が、平均して0.75以内の差（当地の記録が無い選手は除く）",recent_win30_6:"6艇で、平均して10ポイント以内の差",recent_top3_30_6:"6艇で、平均して10ポイント以内の差",st_mean30_6:"6艇の平均STが、平均して0.02秒以内の差",b1_st_rank_band:"区分（1〜2位／3〜4位／5〜6位）が同じ",b1_motor_rank_band:"6艇中の順位の区分（1〜2位／3〜4位／5〜6位）が同じ",motor_2_6:"6艇で、平均して5ポイント以内の差",b1_boat_rank_band:"6艇中の順位の区分（1〜2位／3〜4位／5〜6位）が同じ",boat_2_6:"6艇で、平均して5ポイント以内の差",weather:"同じ",wind_bin:"風速の区分（0〜2m／3〜4m／5m以上）が同じ",wind_vector:"風向きと風速が近い（差1.5m以内）",wave_bin:"区分（0〜2cm／3〜5cm／6cm以上）が同じ",grade:"同じ",grade_bin:"一般戦かどうかが同じ",round:"同じ",series_day:"同じ",is_final_day:"同じ",age_6:"6艇の年齢が、平均して3歳以内の差",weight_6:"6艇の体重が、平均して2.0kg以内の差",n_local:"同じ",exh_time_diff_6:"6艇の展示タイムの差が、平均して0.03秒以内"};
const relabel=it=>({...it,label:LABEL[it.key]||it.label,rule:RULE[it.key]||cleanRule(it.rule)});
const fmtT=(k,v)=>{if(typeof v!=="string")return v;let s=v;k=String(k);
  if(/^recent_/.test(k))s=s.split("/").map(x=>x!==""&&!isNaN(+x)?Math.round(+x*100)+"%":x).join("/");
  if(k==="motor_2_6"||k==="boat_2_6"||k==="weight_6")s=s.split("/").map(x=>x!==""&&!isNaN(+x)?(+x).toFixed(1):x).join("/");
  if(k==="weather")s=s.replace(/^晴$/,"晴れ");
  if(k==="grade_bin")s=s==="一般"?"一般戦":s==="G3以上"?"一般戦ではない":s;
  if(k==="win_gap_band")s=s.replace(/（帯(\d)）/,(_,b)=>`（下から${+b+1}段階目）`);
  return s.replace(/(^|[^0-9.])-(?=\d)/g,"$1−").replace(/([^\x00-\x7f])\s+([0-9A-Za-z])/g,"$1$2").replace(/([0-9A-Za-z%])\s+([^\x00-\x7f])/g,"$1$2");};
const GORD=["SG","G1","G2","G3","一般"];
const fmtDir=(g,s)=>{s=String(s||"");if(!s)return "";
  if(g==="boat1")return "1号艇が強いかどうかで変わる（どちらに動くかは艇番・着順による）";
  if(/中くらいで見込みが上がる（まっすぐな向きではない）/.test(s))return g==="age"?"中堅の年齢で上がりやすい（若いほど・年配ほど、ではない）":g==="weight"?"中くらいの体重で上がりやすい（軽いほど・重いほど、ではない）":s;
  if(g==="grade")s=s.replace(/(上がる|下がる): ([^／]+)/g,(_,h,l)=>`${h}: ${l==="—"?l:l.split("・").sort((a,b)=>GORD.indexOf(a)-GORD.indexOf(b)).join("・")}`);
  if(g==="round")s=s.replace(/その他/g,"一般戦など");
  return s.replace(/R番号/g,"レース番号").replace(new RegExp("過去"+"の平均ST","g"),"平均ST（直近30走）");};
const fmtD2=v=>String(v??"").replace(/(\d{4})-(\d{2})(?:-(\d{2}))?/g,(_,y,m,d)=>`${y}/${+m}${d?"/"+(+d):""}`);
const gjoin=(g,s)=>`${g}${s?(/[0-9A-Za-z]$/.test(g)?"":" ")+s:""}`;
// 類似レースで必ずそろえる条件のうち、レースの種類（例: G1以上の優勝戦）
const layerKind=()=>{const L=(K.pool&&K.pool.layer_cond)||"",r=(L.match(/ラウンド（(.+?)）/)||[])[1],g=(L.match(/グレード（(.+?)）/)||[])[1];return r&&g?`${g}の${r}`:r||g||"";};
let CMPS="若松の全レース";''')
R('function setK(){K=st.stage==="post"&&D.knn4?D.knn4:(st.swKnn==="mix"&&D.knn3?D.knn3:D.knn);ITEM=',
  'function setK(){K=st.stage==="post"&&D.knn4?D.knn4:(st.swKnn==="mix"&&D.knn3?D.knn3:D.knn);K={...K,items:K.items.map(relabel)};ITEM=')
# 類似レース: 冒頭の説明・スライダー・何が似ている
_a = t.index('  $("simSub").textContent='); _b = t.index('\n', _a)
t = t[:_a] + r'''  {const kind=layerKind(),layered=(st.swKnn==="mix"||st.stage==="post")&&D.knn3;$("simSub").innerHTML=layered?`${kind?`今日と同じ「${kind}」で、`:""}1号艇の級別・1号艇と勝率トップの差・勝率トップの艇番が${kind?"":"今日と"}そろう過去レース${K.pool&&K.pool.layer_n?`${K.pool.layer_n}件`:""}を、出走表が似ている順に並べた。展示後は展示タイム・天候・風・波も見ている${/優勝戦/.test(kind)?`<span class="foot" style="display:block;margin-top:4px">※優勝戦以外の名前の決勝（〇〇王座決定戦など）はまだ入れていない</span>`:""}`:`出走表の数字が今日の若松12Rに近い過去レースを、似ている順に並べた。同じ会場のレースを優先して探している（会場が違うと遠く数える）。${st.stage==="post"?"展示後は展示タイム・天候・風・波も見ている":"展示前は出走表の情報だけで見ている"}`;}''' + t[_b:]
R('$("pctLbl").textContent=far?`${N}件目（いちばん遠い）でも、近さの計算に使う${fc.length}項目のうち ${fc.filter(m=>m===2).length}項目が同じ・${fc.filter(m=>m===1).length}項目が近い`:"";',
  '$("pctLbl").textContent=far?`一番遠い${N}件目でも、${fc.length}項目中${fc.filter(m=>m===2).length}項目が同じ・${fc.filter(m=>m===1).length}項目が近い`:"";')
R('<span class="v">${pc(r.rate,0)}<small>${nr!=null&&nr>r.rate+.005?` 近いも含め ${pc(nr,0)}`:""}</small></span>', '<span class="v">${pc(r.rate,0)}<small>${nr!=null&&nr>r.rate+.005?`（近いも含め${pc(nr,0)}）`:""}</small></span>')
R('$("likeTop").innerHTML=`<p class="sub">この ${N}件のうち、その項目が今日と同じ（基準は全項目の表に）レースの割合</p>${CONDK.length?`<p class="foot">条件でそろえた項目（${CONDK.map(k=>ITEM[k]?ITEM[k].label:k).join("・")}）は、全件が今日と同じなので、ここには出していない</p>`:""}`',
  '$("likeTop").innerHTML=`<p class="sub">${N}件のうち、今日と同じだったレースの割合（何を同じとみなすかは、下の全項目の表に）</p>${CONDK.length?`<p class="foot">条件でそろえた項目（${[layerKind(),"1号艇の級別","勝率差","勝率トップの艇"].filter(Boolean).join("・")}）は全件そろっているので出していない。${/G1以上/.test((K.pool&&K.pool.layer_cond)||"")?"グレードはG1とSGが混ざる":""}</p>`:""}`')
R('$("likeMore").textContent=`全 ${K.items.length} 項目（近さの計算に使わない項目も含む）を見る`;', '$("likeMore").textContent=`全${K.items.length}項目（近さの計算に使わない項目も含む）を見る`;')
R('<thead><tr><th>項目（今日の値）</th><th>同じ（${N}件）</th><th>近いまで</th><th>全レース</th></tr></thead>', '<thead><tr><th>項目（今日の値）</th><th>同じ（${N}件中）</th><th>近いも含む</th><th>全レースで同じ割合</th></tr></thead>')
# 1件ずつ見比べる
R('<span class="nm">${x.d} ${x.v} ${x.rn}R<small>${x.g==="ippan"?"一般":x.g} ${x.res.stage||RN[x.rd]||""}', '<span class="nm"><span class="dt">${fmtD2(x.d)}</span>${x.v}${x.rn}R<small>${gjoin(x.g==="ippan"?"一般":x.g,x.res.stage||RN[x.rd]||"")}')
R('<span class="sc"><span class="up">○${s2}</span> <span class="warn2">△${s1}</span> <span class="down">×${s0}</span></span>', '<span class="sc"><span class="up">同じ${s2}</span>・<span class="warn2">近い${s1}</span>・<span class="down">違う${s0}</span></span>')
R('`　3連単 ${x.res.payout_3tan.toLocaleString()}円', '`　3連単${x.res.payout_3tan.toLocaleString()}円', 2)
R('<br><small>着: ${x.res.finish.map((f,i)=>`${i+1}号艇 ${fin(f)}`).join("・")}　ST順: ${x.res.st_rank.map(v=>v??"—").join("/")}　進入: ${x.res.course.join("")}</small>',
  '<br><small>着順: ${(x.o||[]).join("-")}（全艇: ${x.res.finish.map((f,i)=>`${i+1}号艇${fin(f)}`).join("・")}）　ST順（1号艇から）: ${x.res.st_rank.map(v=>v??"—").join("/")}　進入: ${x.res.course.slice(0,3).join("")}/${x.res.course.slice(3).join("")}</small>')
R('function sonarTipHtml(x){return `<b>${x.r}番目に似ている</b><br>${x.d} ${x.v} ${x.rn}R ${GN[x.g]||x.g||""} ${RN[x.rd]||x.rd||""}<br>', 'function sonarTipHtml(x){return `<b>${x.r}番目に似ている</b><br><span class="dt">${fmtD2(x.d)}</span>${x.v}${x.rn}R ${gjoin(GN[x.g]||x.g||"",RN[x.rd]||x.rd||"")}<br>')
# 類似レースの決まり方
R('<span>ひげ＝95%の幅。棒をタップ</span>', '<span>棒の横線＝件数が少ないときのぶれ幅（だいたいこの間に入る）。棒をタップ</span>')
R('data-tip="${x}/${n}件・95%の幅 ${pc(lo)}〜${pc(hi)}${extra}${natP!=null?`・比べる相手 ${pc(natP)}`:""}"',
  'data-lab="${String(lab).replace(/<span class="bn"[^>]*>\\d<\\/span>\\s*/g,"").replace(/<[^>]+>/g,"")}" data-tip="${n}件中${x}件（${pc(p,0)}、ぶれ幅${Math.round(lo*100)}〜${pc(hi,0)}）。${(extra+(natP!=null?`・${CMPS}${pc(natP,0)}`:"")).replace(/^・/,"")}"')
R('tipEl.textContent=b.querySelector("span").textContent+": "+b.dataset.tip;', 'tipEl.textContent=(b.dataset.lab||b.querySelector("span").textContent)+": "+b.dataset.tip;')
R('$("resT").textContent=`似ている順の ${N}件で（同じ節を${st.noSS?"除く":"含む"}）`;', '$("resT").textContent=`似ている順の${N}件で${K.pool&&K.pool.layer_n?"":st.noSS?"（今日と同じ節のレースは除く）":"（今日と同じ節のレースも含む）"}`;')
R('height:12px"></i>${cmpLayer()?cmpLayer().name:"若松の全レース（似ているかを問わない）"}`;', 'height:12px"></i>点線: ${cmpLayer()?cmpLayer().name:"若松の全レース（似ているかを問わない）"}`;')
R('  const LY=cmpLayer();\n', '  const LY=cmpLayer();CMPS=LY?LY.short:"若松の全レース";\n')
R('`${all8.n!==N?`・${all8.n}件では ${pc(all8.hit[t][b-1]/all8.n)}`:""}・全国 ${pc(NAT.n_hit[b][RK[t]]/NAT.n)}`', '`${all8.n!==N?`・${all8.n}件では${pc(all8.hit[t][b-1]/all8.n,0)}`:""}・全国${pc(NAT.n_hit[b][RK[t]]/NAT.n,0)}`')
R('${N}件だと割合はぶれやすい（ひげが長い）。${all8.n!==N?`棒をタップすると ${all8.n}件での割合も出る`', '${N}件だと割合はぶれやすい（ぶれ幅が広い）。${all8.n!==N?`棒をタップすると${all8.n}件での割合も出る`')
R('`・全国 ${pc(NAT.technique[k]/NAT.n)}`', '`・全国${pc(NAT.technique[k]/NAT.n,0)}`')
R('if(D.knn5layer)return {...D.knn5layer,name:`グレードを問わない優勝戦（勝率の3条件はそろえる）${D.knn5layer.n}件。類似レース${K.nb.length}件はこの中に入る、ひとつ広い範囲`};',
  'if(D.knn5layer)return {...D.knn5layer,name:`グレードを問わない優勝戦（ほかの条件は同じ）${D.knn5layer.n}件`,short:"グレードを問わない優勝戦"};')
R('name:`全国・6艇ともA1の優勝戦（${c.n.toLocaleString()}件。類似レースとは条件が違う）`};', 'name:`全国・6艇ともA1の優勝戦（${c.n.toLocaleString()}件。類似レースとは条件が違う）`,short:"全国・6艇ともA1の優勝戦"};')
R('name:`条件（${D.knn3layer.cond||"勝率差・1号艇の級別・勝率トップ"}）がそろった過去レース全体（${D.knn3layer.n.toLocaleString()}件）`}:null;}', 'name:`条件（${D.knn3layer.cond||"勝率差・1号艇の級別・勝率トップ"}）がそろった過去レース全体（${D.knn3layer.n.toLocaleString()}件）`,short:"条件がそろった過去レース全体"}:null;}')
R('<div class="card">艇（扇・棒・下の艇ボタン）を選ぶと、「その艇が勝ったとき、ほかの艇はどうだった？」が出る</div>', '<div class="card">上の棒かソナーの扇を押すと、その艇が勝ったとき、ほかの艇はどうだったかが出る</div>')
R('b1s:"1号艇の ST が4番手以下",st1_tie:`${k}号艇の ST がトップ（同タイム含む）`', 'b1s:"1号艇のSTが4番手以下",st1_tie:`${k}号艇のSTがトップ（同タイム含む）`')
R('<h3>${bn(k)} ${k}号艇が勝った ${hitR.length}件、ほかの艇は？</h3>', '<h3>${bn(k)} ${k}号艇が勝った${hitR.length}件、ほかの艇は？</h3>')
R('くらべる相手: ${cmpName}（${C1.length}件）', '比べる相手: ${cmpName}（${C1.length}件）')
R('<div class="warn">この ${nb.length}件では ${k}号艇が勝ったレースは0件。', '<div class="warn">この${nb.length}件では${k}号艇が勝ったレースは0件。')
R('"2着→3着の帯は、1着の艇を問わずに数えている。1着の箱をタップすると、その艇が勝ったレースだけで 1→2→3 の流れを描き直す"', '"2着→3着の帯は、1着の艇を問わずに数えている。1着の四角をタップすると、その艇が勝ったレースだけで1→2→3の流れを描き直す"')
R('`${b}号艇が勝った ${a.win[b-1]}件だけで描いている（1→2→3 の本当の流れ）。上の一覧でも色を付けている`', '`${b}号艇が勝った${a.win[b-1]}件だけで、1着→2着→3着をつないで描いている。上の一覧でも色を付けている`')
R('`${p?"2着":"1着"} ${x}号艇 → ${p?"3着":"2着"} ${y}号艇: ${c}件（${tot}件中）。上の一覧でも色を付けている`', '`${p?"2着":"1着"}の${x}号艇 → ${p?"3着":"2着"}の${y}号艇: ${c}件（${tot}件中）。上の一覧でも色を付けている`')
R('$("triMore").textContent=`ほかの ${Math.max(0,all.length-topN)} 通りも見る（出た組み合わせは全 ${all.length} 通り。件数が同じものはまとめて上に出している）`;', '$("triMore").textContent=`残り${Math.max(0,all.length-topN)}通りを見る（全${all.length}通り）`;')
# 使っている項目
_a = t.index('  const notUsed=K.items.filter(it=>!it.inDist).map(it=>it.label);'); _b = t.index('$("detail").innerHTML=', _a)
t = t[:_a] + '''  const pre=st.stage==="pre",PREH={weather:1,wind_bin:1,wind_vector:1,wave_bin:1,exh_time_diff_6:1};
  const notUsed=K.items.filter(it=>!it.inDist&&!(pre&&PREH[it.key])).map(it=>it.label);
  const layered=(st.swKnn==="mix"||st.stage==="post")&&K.pool&&K.pool.layer_cond;
  const cond=layered?[layerKind(),"1号艇の級別","1号艇と勝率トップの差","勝率トップの艇番"].filter(Boolean).join("・"):"なし（全部の項目で似ている順に並べる）";
  ''' + t[_b:]
R('<ul><li>材料: 今節の平均着順点・全国勝率・当地勝率・直近30走の1着率・モーター2連率・ボート2連率・過去30走の平均ST・展示タイム（展示の後だけ）。全国勝率・当地勝率・モーター2連率・ボート2連率は出走表の値、展示タイムは直前情報の値。直近30走の1着率・過去30走の平均ST・今節の平均着順点は、',
  '<ul><li>項目: 今節の平均着順点・全国勝率・当地勝率・直近30走の1着率・モーター2連率・ボート2連率・平均ST（直近30走）・展示タイム（展示の後だけ）。全国勝率・当地勝率・モーター2連率・ボート2連率は出走表の値、展示タイムは直前情報の値。直近30走の1着率・平均ST（直近30走）・今節の平均着順点は、')
R('<li>${st.stage==="post"?"展示後は、展示タイム・天候・風・波も近さに入れている":"展示前は、展示タイム・天候・風・波はまだ分からないので使っていない"}</li></ul>', '<li>${st.stage==="post"?"展示後は、展示タイム・天候・風・波も近さに入れている":"展示前は天候・風・波・展示タイムを使わず、見比べにも出さない"}</li></ul>')
R('<p class="foot">期間はどれも 2019-04-01〜2026-09-26（例のレースの前日まで）。棒のひげ（95%の幅）は、レースどうしが独立だとして計算している。類似レースは会場や同じ節に固まることがあるので、実際の幅はやや広い</p>',
  '<p class="foot">数えた値は2019/4/1〜2026/9/26。AIの見立ては2025/10〜2026/9のデータで作った。ぶれ幅は1レースずつ別々に起きたとみなした計算。似たレースは同じ会場・同じ節に偏るので、実際はもう少し広い</p>')
# 冒頭の説明（モックの注記）の書式
R('本番 DB、2019-04-01〜例のレースの前日まで', '本番DB、2019/4/1〜例のレースの前日まで')
R('<b>若松 12R（2026-09-27、G1 ヤングダービー優勝戦、6艇とも A1）</b>', '<b>若松12R（2026/9/27、G1ヤングダービー優勝戦、6艇ともA1）</b>')
R('結果は 4-1-5 差し、3連単 11,580円', '結果は4-1-5差し、3連単11,580円')
R('<small>今日 ${String(fmtT(k,K.today[k])??"—")', '<small>今日: ${String(fmtT(k,K.today[k])??"—")')
R('ib:`${k}号艇より内の艇に F・出遅れ・失格`', 'ib:`${k}号艇より内の艇にF・出遅れ・失格`')
R('（${fmtD(BP.period)}）', r'（${fmtD(BP.period).replace(/([0-9]) (?=[^\x00-\x7f])/g,"$1").replace(/（(.*)）$/,"。$1")}）')
R('.tabs{display:grid;', '.dt{margin-right:.45em}\n.tabs{display:grid;')
R('<span class="eyebrow">アナロジー・ファインダー · 若松 12R</span>', '<span class="eyebrow">アナロジー・ファインダー · 若松12R</span>')
R('範囲の既定は「若松・6艇とも A1」', '数えるレースの既定は「若松・6艇ともA1」')
# 表示の書式（CSS）: 棒の下の順位を2行に、件数の少ない進入の行を折り返す
R('.strip{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;height:96px}', '.strip{display:grid;grid-template-columns:repeat(6,1fr);gap:4px;height:112px}')
R('.strip .col{display:grid;grid-template-rows:14px 1fr 16px;', '.strip .col{display:grid;grid-template-rows:14px 1fr 28px;')
R('.strip .rk{white-space:nowrap;font-size:10px}', '.strip .rk{white-space:nowrap;font-size:10px;line-height:1.3}')
R('.ent .b1{font-size:11.5px;color:var(--muted);min-width:7.5em;text-align:right}', '.ent .b1{font-size:11.5px;color:var(--muted);min-width:7.5em;max-width:10em;text-align:right}')
# 語の統一（材料・要素 → 項目、AI の後ろの空白）
t = t.replace('材料', '項目').replace('他艇の要素', '他艇の項目').replace('要素ごとの割合', '項目ごとの割合')
t = t.replace('AI の', 'AIの').replace('AI が', 'AIが').replace('AI 予想', 'AI予想')
t = t.replace('過去の平均ST', '平均ST（直近30走）').replace('過去30走の平均ST', '平均ST（直近30走）')
io.open('template16.html', 'w', encoding='utf-8').write(t)
print('ok')
