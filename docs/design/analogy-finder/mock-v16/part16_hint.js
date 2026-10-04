// ---------- 今日のスタートの手がかり（展開シナリオの②の上。予想ではなく、数えた値） ----------
const HINT_SRC = [
  ["C", "このコースで"],
  ["A", "全体"],
];
// 今日の展示ST（展示後だけ出す。F は早く越えた秒数）
const EXH_ST = [
  [0.07, ""],
  [0.01, ""],
  [0.09, "F"],
  [0.05, ""],
  [0.05, ""],
  [0.21, ""],
];
const fmtST = (v) =>
  v == null ? "—" : "." + String(Math.round(v * 100)).padStart(2, "0");
function hintHtml() {
  const H = D.hint;
  if (!H || !H.example) return "";
  const S = st.scn,
    src = S.hsrc || "C",
    ex = H.example,
    vals = ex[src],
    ref = ex.E,
    hit = ex[src + "_conds"] || {},
    post = st.stage === "post";
  const pop = H.pop[src];
  const conds = H.conds.filter((c) => hit[c.id]);
  const rate = (o) => (o && o[1] ? pc(o[0] / o[1], 0) : "—");
  const condRows = conds.length
    ? conds
        .map((c) => {
          const v = c[src];
          return `<button type="button" class="hintc" data-hs="${c.form}"><span class="hl">${c.label}</span><span class="hr">→ 過去、${SLITN[c.form]}になったのは <b>${rate(v.hit)}</b>（そうでないとき ${rate(v.miss)}）</span></button>`;
        })
        .join("")
    : `<p class="foot">今日の並びは、どの条件にも当てはまらない</p>`;
  const nameRow = (lab, arr, fmt, dim) =>
    `<tr><th>${lab}</th>${arr.map((v, i) => `<td${dim && dim[i] ? ' class="dim"' : ""}>${fmt(v, i)}</td>`).join("")}</tr>`;
  const bRuns = ex.B_n || [];
  return `<div class="hint">
    <div class="hint-h"><b>今日のスタートの手がかり</b><span class="muted">平均STの並び（予想ではなく、過去の記録）</span></div>
    <div class="row"><span class="lbl">並べ方</span><div class="seg" id="hintSrc">${HINT_SRC.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${src === k}">${l}</button>`).join("")}</div></div>
    <div class="hint-pic">${slitScene(vals, 132, ref)}</div>
    <p class="foot">${src === "C" ? "各選手が、今日のコースで走ったときの平均ST（直近の走、最大30走）" : "各選手の平均ST（直近30走、コースを問わない）"}。点線は若松の各コースのふだん（全選手の平均）。点線より右にいる艇は、ふだんより早い</p>
    <div class="tbl"><table class="hint-t"><thead><tr><th></th>${[1, 2, 3, 4, 5, 6].map((b) => `<th>${bn(b)}</th>`).join("")}</tr></thead><tbody>
      ${nameRow("このコースで", ex.C, (v) => fmtST(v))}
      ${nameRow("全体", ex.A, (v) => fmtST(v))}
      ${nameRow(
        "若松で",
        ex.B,
        (v, i) =>
          `${fmtST(v)}<small>${bRuns[i] != null ? bRuns[i] + "走" : ""}</small>`,
        bRuns.map((n) => n != null && n < 10),
      )}
      ${nameRow("若松のふだん", ex.E, (v) => fmtST(v))}
      ${post ? nameRow("今日の展示", EXH_ST, ([v, f]) => (f ? `F${fmtST(v)}` : fmtST(v))) : ""}
    </tbody></table></div>
    <p class="foot">若松での平均STは参考（走数が少ない選手が多く、ぶれやすい）。${post ? "展示STは参考で、本番のSTとの関係は弱い。" : "展示STは展示の後に出る。"}</p>
    <h4>当てはまる条件（${src === "C" ? "このコースでの平均ST" : "全体の平均ST"}で判定）</h4>
    <div class="hintcs">${condRows}</div>
    <p class="foot">全国の枠なりのレース（${pop.toLocaleString()}件）で数えた。当てはまっても外れる方が多い（決め手ではなく手がかり）。押すと下の②でその形を選ぶ</p>
  </div>`;
}
function hintForms() {
  const H = D.hint;
  if (!H || !H.example) return new Set();
  const src = st.scn.hsrc || "C",
    hit = H.example[src + "_conds"] || {};
  return new Set(H.conds.filter((c) => hit[c.id]).map((c) => c.form));
}
function wireHint() {
  const seg = $("hintSrc");
  if (!seg) return;
  seg
    .querySelectorAll("button")
    .forEach(
      (b) => (b.onclick = () => ((st.scn.hsrc = b.dataset.v), renderScn())),
    );
  document
    .querySelectorAll(".hintc")
    .forEach(
      (b) =>
        (b.onclick = () => (
          (st.scn.slit = b.dataset.hs),
          (st.scn.ff = st.scn.fs = null),
          renderScn()
        )),
    );
}
