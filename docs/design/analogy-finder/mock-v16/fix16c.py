# -*- coding: utf-8 -*-
# ファン評価 第2周の直し
import io, re
def edit(fn, pairs, regex=()):
    t = io.open(fn, encoding='utf-8').read()
    for a, b in pairs:
        assert t.count(a) == 1, (fn, t.count(a), a[:70]); t = t.replace(a, b)
    for a, b, n in regex:
        t, k = re.subn(a, b, t); assert k == n, (fn, a, k)
    io.open(fn, 'w', encoding='utf-8').write(t)

edit('part16_facts.js', [
 ('const where = rankWord(p.bucket, r.hi, r.lo) + (p.same > 1 ? `（${p.same}艇が同じ値）` : "");',
  'const where = rankWord(p.bucket, r.hi, r.lo) + (p.same > 1 ? `（${p.same}艇が同じ値）` : "");\n    const vs = [1, 2, 3, 4, 5, 6].map((x) => todayVal(x, r.k)).filter((v) => v != null);\n    const valTxt = vs.length ? `（今日 ${fmtV(r.k, todayVal(b, r.k))}。6艇は ${fmtV(r.k, Math.min(...vs))}〜${fmtV(r.k, Math.max(...vs))}）` : "";'),
 ('<b>${prefix}</b>は${r.l}が<b>${where}</b>。${sname}で',
  '<b>${prefix}</b>は${r.l}が<b>${where}</b>${valTxt}。${sname}で'),
 ('点線は全体の ${pc(uP, 1)}</p>', '点線は全体の ${pc(uP, 1)}。枠で囲んだ棒が今日の位置</p>'),
 ('`<h3>今日の風・波では（風1m・波1cm）</h3>', '`<h3>今日の風・波では（風1m・波1cm）</h3><p class="sub">この欄だけは、6艇ともA1に絞ると件数が足りないので、若松の全レースで数えている。比べる相手（点線）も若松の全レース</p>'),
 ('Rr = 118,', 'Rr = 100,'),
], regex=[
 (r'opacity="\.75" font-size="9"', 'opacity=".75" font-size="13"', 1),
 (r'fill="#f3ead0" font-size="11" font-weight="700"', 'fill="#f3ead0" font-size="16" font-weight="700"', 1),
 (r'fill="#e8d089" font-size="10\.5"', 'fill="#e8d089" font-size="15"', 1),
 (r'<small>若松全体 ', '<small>風を問わず ', 1),
])
# 今日の値と書式
t = io.open('part16_facts.js', encoding='utf-8').read()
t = t.replace('function todayPos(b, k) {', '''const todayVal = (b, k) => (k === "series_score" ? D.tab1.ex_series[b] : D.rf.ex[b][k]).value;
const fmtV = (k, v) => v == null ? "—" : k === "recent_win30" ? Math.round(v * 100) + "%" : k === "motor_2" || k === "boat_2" ? v.toFixed(1) + "%" : k === "st_mean30" ? v.toFixed(2) : k === "exh_time" ? v.toFixed(2) : v.toFixed(2);
function todayPos(b, k) {''', 1)
io.open('part16_facts.js', 'w', encoding='utf-8').write(t)

edit('part16_scn.js', [], regex=[
 (r'カド＝4コース（内の3艇より後ろから助走をとる、最初の艇）。カド受け＝3コース。', 'カド＝ダッシュ勢（助走を長くとる艇）の一番内。枠なりなら4コースで、7形の判定は4コースで見ている。カド受け＝その1つ内（枠なりなら3コース）。', 1),
])

# テンプレート側の直しは make16.py に足す
t = io.open('make16.py', encoding='utf-8').read()
add = r'''# ファン評価 第2周
R('（${x.res.popularity_3tan}番人気）', '${x.res.popularity_3tan!=null?`（${x.res.popularity_3tan}番人気）`:""}')
R('<span class="cv">${x.t[k]??"—"}<small>', '<span class="cv">${(k==="grade"?(GN[x.t[k]]||x.t[k]):fmtT(k,x.t[k]))??"—"}<small>')
R('${natP!=null?`・全国 ${pc(natP)}`:""}', '${natP!=null?`・比べる相手 ${pc(natP)}`:""}')
R('let NSd=NS;function setNS(){const L=K.nb.length;NSd=L<800?[...NS.filter(x=>x<L),L]:NS;$("nSlider").max=NSd.length-1;if(st.ni>NSd.length-1)st.ni=NSd.length-1;}',
  'let NSd=NS;function setNS(){const L=K.nb.length;NSd=L<800?[...NS.filter(x=>x<L),L]:NS;$("nSlider").max=NSd.length-1;if(!st.niTouched)st.ni=L<800?Math.max(0,NSd.indexOf(30)):9;if(st.ni>NSd.length-1)st.ni=NSd.length-1;const lay=!!(K.pool&&K.pool.layer_n);$("ssChip").closest(".row").hidden=lay;}')
R('$("nSlider").oninput=e=>{st.ni=+e.target.value;', '$("nSlider").oninput=e=>{st.niTouched=true;st.ni=+e.target.value;')
R('<span>TARGET: 若松12R</span>', '<span>今日: 若松12R</span>')
R('$("sonarCap").textContent=`HITS: ${nb.length}`;', '$("sonarCap").textContent=`表示中: ${nb.length}件`;')
R('const main=rows.filter(r=>r.it.inDist&&!DUP[r.it.key]&&r.rate!=null&&r.n>=5);',
  'const CONDK=st.swKnn==="mix"?["win_gap_band","b1_class","top_boat",...(K.pool&&K.pool.layer_n?["round"]:[])]:[];\n  const main=rows.filter(r=>r.it.inDist&&!DUP[r.it.key]&&r.rate!=null&&r.n>=5&&!CONDK.includes(r.it.key));')
R('$("likeTop").innerHTML=`<p class="sub">この ${N}件のうち、その項目が今日と同じ（基準は全項目の表に）レースの割合</p>`',
  '$("likeTop").innerHTML=`<p class="sub">この ${N}件のうち、その項目が今日と同じ（基準は全項目の表に）レースの割合</p>${CONDK.length?`<p class="foot">条件でそろえた項目（${CONDK.map(k=>ITEM[k]?ITEM[k].label:k).join("・")}）は、全件が今日と同じなので、ここには出していない</p>`:""}`')
R('<span class="v">${c}/${tot}件</span>', '<span class="v">${pc(c/tot,1)} <small>${c}件</small></span>')
'''
t = t.replace("io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", add + "io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", 1)
io.open('make16.py', 'w', encoding='utf-8').write(t)
print('fix ok')
