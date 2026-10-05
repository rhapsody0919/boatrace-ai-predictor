const ck=(v,g,r)=>`${v}|${g}|${r}`;
const cname=(v,g,r)=>`${v==="0"?"全国":VEN[+v-1]}×${GN[g]}×${RN[r]}`;
const PTH = [
  ["racerRecord", "選手の実力"],
  ["startExhibition", "スタート・展示"],
  ["machine", "モーター・ボート"],
  ["racerProfile", "体重・年齢・地元"],
  ["venue", "会場・R番号"],
  ["weatherWater", "天候・水面"],
  ["raceFormat", "レースの条件"],
];
const PGR = {
  racerRecord: [
    ["class", "級別"],
    ["national", "全国勝率・2連率"],
    ["local", "当地勝率・2連率"],
    ["recent", "直近30走の成績"],
    ["boat1", "1号艇の級別・勝率", 1],
  ],
  startExhibition: [
    ["exhibitionTime", "展示タイム"],
    ["pastSt", "過去の平均ST"],
  ],
  machine: [
    ["motor", "モーター2連率"],
    ["boat", "ボート2連率"],
  ],
  racerProfile: [
    ["age", "年齢"],
    ["weight", "体重"],
    ["branch", "支部・地元"],
  ],
  venue: [
    ["venue", "会場"],
    ["raceNumber", "レース番号"],
  ],
  weatherWater: [
    ["weather", "天候"],
    ["wind", "風"],
    ["wave", "波"],
  ],
  raceFormat: [
    ["grade", "グレード"],
    ["round", "ラウンド"],
    ["seriesDay", "節の日目"],
  ],
};
const MKEY = { 1: "win", 2: "top2", 3: "top3" };
function renderAi() {
  const BP = D.bp,
    m = MKEY[st.rank];
  const A = st.pb,
    Bb = st.two && st.b2 !== A ? st.b2 : null;
  $("hAi").textContent = `${A}号艇が${RT[st.rank]}に入るかを左右しやすい材料`;
  $("pbSeg").innerHTML = [1, 2, 3, 4, 5, 6]
    .map(
      (n) =>
        `<button type="button" data-b="${n}" aria-pressed="${A === n}">${bn(n)}</button>`,
    )
    .join("");
  $("pbSeg")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => {
          st.pb = +b.dataset.b;
          render();
        }),
    );
  $("boatB").innerHTML = [1, 2, 3, 4, 5, 6]
    .map(
      (n) =>
        `<option value="${n}" ${n === st.b2 ? "selected" : ""}>${n}号艇と比べる</option>`,
    )
    .join("");
  $("boatB").disabled = !st.two;
  const sa = BP.nat[m][A].t,
    sb = Bb ? BP.nat[m][Bb].t : null;
  const va = PTH.map(([k]) => sa[k][0]),
    vb = sb ? PTH.map(([k]) => sb[k][0]) : null;
  const hi = Math.max(0.1, Math.ceil(Math.max(...va, ...(vb || [])) * 10) / 10);
  const lab = to100(va),
    labB = vb ? to100(vb) : null;
  radar(
    $("radar"),
    PTH.map((t) => t[1]),
    [{ v: va, c: LINE6[A] }, ...(vb ? [{ v: vb, c: LINE6[Bb] }] : [])],
    {
      hi,
      vals: vb
        ? PTH.map((_, i) => `${lab[i]}% / ${labB[i]}%`)
        : lab.map((x) => x + "%"),
    },
  );
  $("legendA").innerHTML = vb
    ? `<span style="--sc:${LINE6[A]}"><i></i>${A}号艇</span><span style="--sc:${LINE6[Bb]}"><i></i>${Bb}号艇</span>`
    : "";
  const mx = Math.max(...va, ...(vb || []));
  const ga = BP.nat[m][A].g,
    gb = Bb ? BP.nat[m][Bb].g : null;
  $("themeList").innerHTML =
    PTH.map(
      (
        [k, n],
        i,
      ) => `<details class="th"><summary><span class="arr flat">▸</span><span>${n}</span><span class="pbar"><span class="wtrk" style="height:9px"><span class="f" style="width:${(va[i] / mx) * 100}%;background:${LINE6[A]}"></span></span>${vb ? `<span class="wtrk" style="height:6px;margin-top:2px"><span class="f" style="width:${(vb[i] / mx) * 100}%;background:${LINE6[Bb]}"></span></span>` : ""}<span class="v">${lab[i]}%${vb ? ` / ${labB[i]}%` : ""}</span></span></summary>
    <div class="els"><div class="muted" style="font-size:11.5px">AI の見立てでは:</div>${PGR[k].filter(([g]) => !(g === "boat1" && A === 1)).map(([g, l, o]) => `<div class="pg"><span>${g === "national" && A === 1 ? "全国勝率・2連率（1号艇の格を含む）" : l}${o && A !== 1 ? `<span class="oth">他艇の要素</span>` : ""}</span><span class="v">${(ga[g] * 100).toFixed(0)}%${gb ? ` / ${(gb[g] * 100).toFixed(0)}%` : ""}</span><span class="muted">${BP.dir[m][A][g] || ""}${Bb ? `<br>${Bb}号艇: ${BP.dir[m][Bb][g] || ""}` : ""}${g === "wind" ? "（追い風・向かい風は区別していない）" : ""}</span></div>`).join("")}</div></details>`,
    ).join("") +
    `<p class="foot">割合は、その艇番の見込みが上下するうち、どの材料からの上下がどれだけかを、プラスもマイナスも大きさとして数えて分けたもの（${BP.period}）。中を開くと、要素ごとの割合と、AI の見立てでどちら向きに見込みが動くかが出る。${vb ? "2艇を重ねたときは割合の形の比較で、効き方の大きさの比較ではない。" : ""}${A === 1 ? "1号艇は、枠と選手の格・会場の組み合わせの分（材料全体の約15%）が枠のほうに入っていて、ここには出ない（選手の実力が小さめに出る）。" : ""}</p>`;
  renderToday();
}
function renderToday() {
  const BP = D.bp,
    m = MKEY[st.rank],
    A = st.pb,
    E = BP.ex[m][A];
  $("hToday").textContent =
    `今日の${A}号艇（若松12R）は、ふつうの${A}号艇と比べて`;
  const sumAbs = PTH.reduce((s, [k]) => s + Math.abs(E.t[k]), 0);
  const ar = (v) =>
    Math.abs(v) < Math.max(EPS, 0.1 * sumAbs)
      ? `<span class="arr flat">・</span>`
      : arrow(v);
  const ord = [...PTH].sort(
    (x, y) => Math.abs(E.t[y[0]]) - Math.abs(E.t[x[0]]),
  );
  const NMX = {
    weatherWater: "天候・水面（西北西1m・波1cm）",
    raceFormat: "レースの条件（G1・優勝戦・6日目）",
  };
  $("aiPanel").innerHTML =
    `<div class="card" style="display:grid;gap:4px">${ord.map(([k, n]) => `<details class="th"><summary>${ar(E.t[k])}<span>${NMX[k] || n}</span><span></span></summary><div class="els">${PGR[k].filter(([g]) => !(g === "boat1" && A === 1)).map(([g, l]) => `<div class="el">${ar(E.g[g])}<span>${l}${D.facts[g] ? `: ${D.facts[g][A - 1]}` : ""}</span></div>`).join("")}</div></details>`).join("")}
  <p class="foot">↑ はふつうの${A}号艇より見込みが上がる向き、↓ は下がる向き（AI の見立て）。材料全体の1割に満たないものは「・」。合わせると、ふつうの${A}号艇より${E.sum > 0 ? "上" : "下"}。見立てと実際の着順は違うことがある</p></div>`;
}
function renderC() {
  const BP = D.bp,
    m = MKEY[st.rank],
    A = String(st.pb),
    key = ck(st.v, st.g, st.r);
  const C = BP.cube[key],
    N0 = BP.nat[m][A].t;
  if (key === "0|all|all") {
    $("cOut").innerHTML =
      `<p class="foot">会場・グレード・ラウンドを選ぶと、${A}号艇の材料の割合を全国と比べる</p>`;
    return;
  }
  if (!C || !C.s) {
    $("cOut").innerHTML =
      `<div class="warn">${cname(st.v, st.g, st.r)}は、このモデルの集計期間（約1年）では ${C ? C.n : 0}レースしかなく、300レース未満なので出さない</div>`;
    return;
  }
  const a = C.s[m][A];
  const mx = Math.max(...PTH.flatMap(([k]) => [a[k][0], N0[k][0]]));
  $("cOut").innerHTML =
    `<p class="sub">${cname(st.v, st.g, st.r)}（${C.n.toLocaleString()}レース）の${A}号艇・${RT[st.rank]}。点線は全国</p>` +
    PTH.map(([k, n]) => {
      const [s, sd] = a[k],
        nz = N0[k][0],
        d = s - nz,
        same = !(
          nz > 0 &&
          Math.abs(d) / nz >= 0.2 &&
          Math.abs(d) >= 0.005 &&
          Math.abs(d) >= 2 * sd
        ),
        fixed = (k === "venue" && st.v !== "0") || (k === "raceFormat" && (st.g !== "all" || st.r !== "all"));
      return `<div class="sb"${fixed ? ' style="opacity:.45"' : ""}><span>${n}${fixed ? "（条件で固定）" : ""}${k === "racerRecord" && !fixed && (st.g === "G1" || st.g === "SG" || st.g === "G2" || st.r === "yusho" || st.r === "junyu") ? `<br><small class="muted">選手の格がそろうので小さく出る</small>` : ""}</span><span class="wtrk"><span class="f" style="width:${(s / mx) * 100}%"></span><span class="nt" style="left:${(nz / mx) * 100}%"></span></span><span class="v">${(s * 100).toFixed(0)}%　${fixed ? `<span class="muted">比べない</span>` : same ? `<span class="muted">ほぼ同じ</span>` : `${d > 0 ? "+" : ""}${(d * 100).toFixed(1)}pt`}</span></div>`;
    }).join("") +
    `<p class="foot">選んだ条件（会場を選べば会場など）は、その中では条件の値が同じになるので比べない。数字が動いても、その条件で何かが「効かない／効く」という意味ではない。</p><details class="more"><summary>この比べ方について</summary><p class="foot" style="margin-top:4px">割合は合わせて100%なので、どれかが増えると他は減る。その条件で選手の値（勝率など）が近いと、そのテーマは小さく出る。全国との差が全国の値の2割以上・0.5pt以上で、かつ揺れの2倍以上のときだけ差を書き、それ以外は「ほぼ同じ」（仮の基準。揺れは日の選び方だけで、モデルの学習の揺れは入っていない）。300レース未満の条件は出さない（仮の基準）</p></details>`;
}
