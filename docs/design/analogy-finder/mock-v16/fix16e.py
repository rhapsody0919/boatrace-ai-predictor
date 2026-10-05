# -*- coding: utf-8 -*-
# 統計の検証 第9回の直し
import io
def edit(fn, pairs):
    t = io.open(fn, encoding='utf-8').read()
    for a, b in pairs:
        assert t.count(a) == 1, (fn, t.count(a), a[:70]); t = t.replace(a, b)
    io.open(fn, 'w', encoding='utf-8').write(t)
P = lambda x, n: f'(pb[{x}] && pb[{x}][1] ? pc(pb[{x}][0] / pb[{x}][1], 0) : "—")'
edit('part16_facts.js', [
 # 指摘2: 優勝戦の範囲では今節の点の順位がほぼ枠で決まるので出さない
 ('  const rows = mats\n    .map(([k, l, hi, lo]) => {', '  const rows = mats\n    .filter(([k]) => !(k === "series_score" && st.fscope === "natA1Y"))\n    .map(([k, l, hi, lo]) => {'),
 # 指摘7: 0件のとき NaN
 ('${pc(pb[0][0] / pb[0][1], 0)} ／ 一番${r.lo}とき ${pc(pb[1][0] / pb[1][1], 0)}', '${' + P(0,0) + '} ／ 一番${r.lo}とき ${' + P(1,0) + '}'),
 # 指摘6: ボートの根拠の数字
 ('全国・6艇とも A1 のレースでは、ボート2連率が6艇で一番高いとき・低いときの差は0〜3ポイントで、モーター2連率（5〜8ポイント）より着順との関係が小さかった。',
  '全国・6艇とも A1 のレースで、2着以内・3着以内に入る割合を見ると、ボート2連率が6艇で一番高いとき・低いときの差は0〜3ポイントで、モーター2連率（4〜8ポイント）より着順との関係が小さかった（1着で見るとモーターも差が小さい艇番がある）。'),
 # 指摘3・2・9: 脚注
 ('<p class="foot">数えた割合で、原因とは限らない。', '<p class="foot">${st.fscope === "natA1Y" ? "優勝戦の範囲では、今節の平均着順点を出していない（優勝戦の枠は準優までの成績で決まるので、点の順位がほぼ枠と同じになり、比べる意味が無い）。この範囲の件数（566）は、展開シナリオ（556、返還艇のレースを除く）と違う。" : ""}今節の平均着順点は、節の序盤（1〜2走）の値も含めて数えている（1レース分の着順で決まるので同じ値が多く、差が小さめに出る）。数えた割合で、原因とは限らない。'),
])
edit('part16_scn.js', [
 ('スリットの形は、今日の展示からは選べない。展示の形は本番の形の手がかりにならなかった（展示で2コース凹みだったレースのうち、本番も2コース凹みは38%。全体の32%とほとんど変わらない。2026-04 以降の 2,280 レース）',
  'スリットの形は、今日の展示からは選べない。展示の形は本番の形を少しだけ当てるが、決め手にはならない（展示で2コース凹み → 本番も2コース凹み 38%、展示が別の形 → 27%。2026-04 以降の 2,280 レース）。参考: 今日の展示の形は2コース凹み・イン凹み（3号艇は展示でフライング）'),
])
t = io.open('make16.py', encoding='utf-8').read()
add = r'''# 統計の検証 第9回
R('(N<100?`<div class="warn">${N}件だと割合はぶれやすい（ひげが長い）。棒をタップすると ${all8.n}件での割合も出る</div>`:"")', '(N<100?`<div class="warn">${N}件だと割合はぶれやすい（ひげが長い）。${all8.n!==N?`棒をタップすると ${all8.n}件での割合も出る`:"条件がそろった過去レースの全件を出している"}</div>`:"")')
R("const c=D.scn.scopes.allA1Y.cells.all.forms.any,bf={};for(let b=1;b<=6;b++){const w=c.first_boat[b-1],s=c.second_boat[b-1],th=c.third_boat[b-1];bf[b]={win:w,top2:w+s,top3:w+s+th};}return {n:c.n,boat_finish:bf,technique:c.technique,name:`全国・6艇ともA1の優勝戦（${c.n.toLocaleString()}件。類似レースは条件がそろった全件なので、ひとつ広い範囲と比べる）`};",
  "if(D.knn5layer)return {...D.knn5layer,name:`グレードを問わない優勝戦（勝率の3条件はそろえる）${D.knn5layer.n}件。類似レース${K.nb.length}件はこの中に入る、ひとつ広い範囲`};const c=D.scn.scopes.allA1Y.cells.all.forms.any,bf={};for(let b=1;b<=6;b++){const w=c.first_boat[b-1],s=c.second_boat[b-1],th=c.third_boat[b-1];bf[b]={win:w,top2:w+s,top3:w+s+th};}return {n:c.n,boat_finish:bf,technique:c.technique,name:`全国・6艇ともA1の優勝戦（${c.n.toLocaleString()}件。類似レースとは条件が違う）`};")
R('に絞り、`+"', 'に絞り、${K.pool&&K.pool.layer_cond&&/グレード/.test(K.pool.layer_cond)?"（名前の違う決勝＝王座決定戦・賞金女王決定戦・決勝戦などは、まだ含めていない）":""}`+"')
'''
t = t.replace("io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", add + "io.open('template16.html', 'w', encoding='utf-8').write(t)\nprint('ok')", 1)
io.open('make16.py', 'w', encoding='utf-8').write(t)
# build-data: knn5 の層（76件）を比べる相手として持つ
t = io.open('build-data.mjs', encoding='utf-8').read()
a = 'const k3l = '
assert t.count(a) == 1
t = t.replace(a, 'const k5 = fs.existsSync(SP + "knn/knn5.json") ? rd("knn/knn5.json") : null;\nconst k5l = k5 && k5.pool && k5.pool.layer_n === k5.neighbors.length ? layerOf(k5) : null;\nconst k3l = ', 1)
a = '  knn3layer: k3l,'
assert t.count(a) == 1
t = t.replace(a, '  knn3layer: k3l,\n  knn5layer: k5l,', 1)
io.open('build-data.mjs', 'w', encoding='utf-8').write(t)
print('fix ok')
