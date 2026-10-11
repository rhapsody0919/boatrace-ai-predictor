# -*- coding: utf-8 -*-
# ファン評価 第3周の直し
import io, re
def edit(fn, pairs=(), regex=()):
    t = io.open(fn, encoding='utf-8').read()
    for a, b in pairs:
        assert t.count(a) == 1, (fn, t.count(a), a[:70]); t = t.replace(a, b)
    for a, b, n in regex:
        t, k = re.subn(a, b, t); assert k == n, (fn, a, k)
    io.open(fn, 'w', encoding='utf-8').write(t)

edit('part16_facts.js', pairs=[
 ('''  [1, 6].forEach((k) => {
    h += `<text x="${Cc[0] + 4}" y="${Cc[1] - rr(k) + 10}" fill="#e8d089" opacity=".75" font-size="13" font-family="Zen Kaku Gothic New,sans-serif">${k}位</text>`;
  });
''', ''),
 ('["series_score", "今節の平均点", "高い", "低い"],', '["series_score", "今節の平均着順点", "高い", "低い"],'),
], regex=[
 (r'i === 0 \? `一番\$\{r\.hi\}` : i === 5 \? `一番\$\{r\.lo\}` : i \+ 1', 'i === 0 ? `一番${r.hi}` : i === 5 ? `一番${r.lo}` : `${i + 1}位`', 1),
 (r'棒の上の数字は%（左ほど\$\{r\.hi\}）。', '棒の上の数字は%、下は6艇中の順位（左ほど${r.hi}）。', 1),
 (r'差がはっきりしているものから、差の大きい順に並べている（差が近い材料どうしは、入れ替わってもおかしくない）。',
  '差がはっきりしているものから、差の大きい順に並べている（差が近い材料どうしは、入れ替わってもおかしくない）。「差が大きい」は5ポイント以上の差、「差ははっきりしない」は件数が少ないなどで95%の幅が重なるもの（差の数字が大きくても、件数が少ないとこうなる）。', 1),
])
edit('part16_scn.js', pairs=[
 ('${x.n >= MIN_N ? `・1号艇1着 ${pc(x.b1_win.p, 0)}` : ""}</span></button>`;', '${x.n >= MIN_N ? `・1号艇1着 ${pc(x.b1_win.p, 0)}` : ""}</span></button>`;\n  // 進入の件数が少ないときは割合を出さない（③の扱いと合わせる）'),
], regex=[
 (r'\$\{k === "any" \? `\$\{x\.n\.toLocaleString\(\)\}件` : `\$\{share\(x\.n, inEntry\)\}（\$\{x\.n\.toLocaleString\(\)\}件）`\}',
  '${k === "any" || inEntry < MIN_N ? `${x.n.toLocaleString()}件` : `${share(x.n, inEntry)}（${x.n.toLocaleString()}件）`}', 1),
 (r'\$\{r\.race_number\}R \$\{r\.grade\}', '${r.race_number}R ${({ ippan: "一般" })[r.grade] || r.grade}', 1),
 (r'\(S\.entry = b\.dataset\.e\),', '(S.entry = b.dataset.e), (S.slit = "any"),', 1),
 (r'形の決め方は、過去率チェッカー（BOA-635）と同じ。', '形の決め方は、過去に発生した割合を見る機能と同じ。', 1),
 (r'font-size="9" text-anchor="end" fill="#ffd2b0">スリット', 'font-size="12" text-anchor="end" fill="#ffd2b0">スリット', 1),
 (r'font-size="9" fill="#e8f1ff">1艇身', 'font-size="12" fill="#e8f1ff">1艇身', 1),
])
t = io.open('make16.py', encoding='utf-8').read()
add = r'''# ファン評価 第3周
R('<tr><th>項目</th><th>今日</th><th>同じ（${N}件）</th><th>近いまで</th><th>全レース</th></tr>', '<tr><th>項目（今日の値）</th><th>同じ（${N}件）</th><th>近いまで</th><th>全レース</th></tr>')
R('<br><small class="muted">${r.it.rule}</small></td><td>${fmtT(r.it.key,K.today[r.it.key])??"—"}</td>', '<br><small>今日: ${fmtT(r.it.key,K.today[r.it.key])??"—"}</small><br><small class="muted">${cleanRule(r.it.rule)}</small></td>')
R('const fmtT=', 'const cleanRule=s=>String(s||"").replace(/120 の/g,"").replace(/MD-6 の/g,"").replace(/motor と同じ式で/g,"モーターと同じ数え方で").replace(/motor_rank（1 \\+ 1号艇より高い艇の数）/g,"順位").replace(/motor_rank/g,"順位").replace(/\\|差\\|/g,"差");\nconst fmtT=')
R('.tbl{overflow-x:auto}', '.tbl{overflow-x:auto}#likeAll td:first-child{white-space:normal;min-width:11em;max-width:18em}#likeAll td small{font-size:10.5px}')
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
'''
t = t.replace("io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", add + "io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", 1)
io.open('make16.py', 'w', encoding='utf-8').write(t)
print('fix ok')
