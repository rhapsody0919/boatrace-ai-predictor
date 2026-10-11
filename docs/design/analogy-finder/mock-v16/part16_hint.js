// ---------- 今日のスタートの手がかり（展開シナリオの②の上。予想ではなく、数えた値） ----------
// 第10回の統計の検証とファン評価の直し: 率は②の「数えるレース」に合わせる／札は率が上がる条件だけ・率を入れる／3桁表示／全体のときは点線を出さない
const HINT_SRC = [
  ["C", "このコース"],
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
const fmtST3 = (v) =>
  v == null ? "—" : "." + String(Math.round(v * 1000)).padStart(3, "0");
const fmtST = (v) =>
  v == null ? "—" : "." + String(Math.round(v * 100)).padStart(2, "0");
const pct = (o) => (o && o[1] ? o[0] / o[1] : null);
// 率の出どころ: ②が若松・6艇ともA1なら同じ範囲、それ以外は全国の枠なり
function hintBase() {
  const H = D.hint,
    S = st.scn;
  if (S.scope === "v20A1" && H.wakamatsu_A1x6)
    return {
      conds: H.wakamatsu_A1x6.conds,
      pop: H.wakamatsu_A1x6.pop,
      name: "若松・6艇ともA1の枠なりのレース",
      small: true,
    };
  return {
    conds: H.conds,
    pop: H.pop,
    name: "全国の枠なりのレース",
    small: false,
    other: true,
  };
}
function hintHits() {
  const H = D.hint,
    src = st.scn.hsrc || "C",
    hit = H.example[src + "_conds"] || {},
    B = hintBase();
  return B.conds
    .filter((c) => hit[c.id])
    .map((c) => {
      const v = c[src],
        ph = pct(v.hit),
        pm = pct(v.miss);
      return { c, v, ph, pm, up: ph != null && pm != null && ph > pm };
    });
}
function hintOk() {
  const S = st.scn;
  return S.entry === "all" || S.entry === "waku";
}
function hintHtml() {
  const H = D.hint;
  if (!H || !H.example) return "";
  const S = st.scn,
    src = S.hsrc || "C",
    ex = H.example,
    vals = ex[src],
    post = st.stage === "post",
    B = hintBase(),
    ok = hintOk();
  const defOf = (f) => (SLIT.find(([k]) => k === f) || [])[2] || "";
  const rows = hintHits();
  const condRows = rows.length
    ? rows
        .map(({ c, v, ph, pm, up }) => {
          const nm = SLITN[c.form];
          const res = up
            ? `過去、${nm}になったのは <b>${pc(ph, 0)}</b>（当てはまらないとき ${pc(pm, 0)}）`
            : `${nm}には、むしろなりにくい: <b>${pc(ph, 0)}</b>（当てはまらないとき ${pc(pm, 0)}）`;
          return `<button type="button" class="hintc" data-hs="${c.form}" aria-pressed="${S.slit === c.form}"><span class="hl">${c.label}</span><span class="hr">→ ${res}<small>${v.hit[1].toLocaleString()}件。${nm}＝本番で${defOf(c.form)}</small></span></button>`;
        })
        .join("")
    : `<p class="foot">今日の並びは、どの条件にも当てはまらない</p>`;
  const nameRow = (lab, arr, fmt, dim) =>
    `<tr><th>${lab}</th>${arr.map((v, i) => `<td${dim && dim[i] ? ' class="dim"' : ""}>${fmt(v, i)}</td>`).join("")}</tr>`;
  const bRuns = ex.B_n || [];
  const fewB = bRuns
    .map((n, i) => (n != null && n < 10 ? i + 1 : null))
    .filter(Boolean);
  return `<div class="hint">
    <div class="hint-h"><b>今日のスタートの手がかり</b><span class="muted">平均STの並び（予想ではなく、過去の記録）。進入が枠なりになった場合の手がかり</span></div>
    ${ok ? "" : `<p class="warn">①で枠なり以外を選んでいる。この手がかりは枠なりのときのものなので、そのまま当てはまらない（②の札も外している）</p>`}
    <div class="row"><span class="lbl">使う平均ST</span><div class="seg" id="hintSrc">${HINT_SRC.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${src === k}">${l}</button>`).join("")}</div></div>
    <p class="foot">このコース＝今日のコースに入ったときだけの平均（ふつうはこちら）。全体＝コースを問わない平均（スタートの位置の違いがまざる）</p>
    <div class="hint-pic">${slitScene(vals, 132, src === "C" ? ex.E : null)}</div>
    <p class="foot">${src === "C" ? "各選手が、今日のコースで枠なりだったときの直近30走の平均ST（期間はおよそ半年〜1年）。点線は、若松でそのコースを走った全選手の平均（級別を問わない）。点線より右＝その平均より早い。A1同士のレースでは、ほとんどの艇が右に来る。見るのは艇どうしの差" : "各選手の直近30走の平均ST（コースを問わない）。コースごとのスタートの違いがまざるので、点線は出していない。見るのは艇どうしの差"}</p>
    <div class="tbl"><table class="hint-t"><thead><tr><th></th>${[1, 2, 3, 4, 5, 6].map((b) => `<th>${bn(b)}</th>`).join("")}</tr></thead><tbody>
      ${nameRow("このコース", ex.C, (v) => fmtST3(v))}
      ${nameRow("全体", ex.A, (v) => fmtST3(v))}
      ${nameRow(
        "若松で",
        ex.B,
        (v, i) =>
          `${fmtST3(v)}<small>${bRuns[i] != null ? bRuns[i] + "走" : ""}</small>`,
        bRuns.map((n) => n != null && n < 10),
      )}
      ${nameRow("若松の全選手（コース別）", ex.E, (v) => fmtST3(v))}
      ${post ? nameRow("今日の展示", EXH_ST, ([v, f]) => (f ? `<span class="fst">F${fmtST(v)}</span>` : fmtST(v))) : ""}
    </tbody></table></div>
    <p class="foot">若松での平均STは参考（直近30走まで）。${fewB.length ? `${fewB.join("・")}号艇は若松の走数が少なく、ぶれやすい。` : ""}${post ? "展示STは参考で、本番のSTとの関係は弱い（艇ごとの相関 0.08。平均STは 0.28）。F.09＝展示でスタートラインを0.09秒早く越えた（展示なので罰則は無い）。" : "展示STは展示の後に出る。"}</p>
    <h4>当てはまる条件（${src === "C" ? "このコースの平均ST" : "全体の平均ST"}で判定）</h4>
    <div class="hintcs">${condRows}</div>
    <p class="foot">${B.name}（${B.pop[src].toLocaleString()}件。F・出遅れのあったレースなどを除く）で数えた。${B.small ? "件数が少ないので、ぶれ幅は広い。" : "下の②の「数えるレース」とは範囲が違う（全国の方が、6艇ともA1のレースより率が高めに出る）。"}当てはまっても外れる方が多い（決め手ではなく手がかり）。押すと下の②でその形を選ぶ</p>
  </div>`;
}
function hintForms() {
  const H = D.hint;
  if (!H || !H.example || !hintOk()) return new Map();
  const m = new Map();
  hintHits()
    .filter((r) => r.up)
    .forEach((r) => m.set(r.c.form, r));
  return m;
}
function wireHint() {
  const seg = $("hintSrc");
  if (!seg) return;
  seg
    .querySelectorAll("button")
    .forEach(
      (b) => (b.onclick = () => ((st.scn.hsrc = b.dataset.v), renderScn())),
    );
  document.querySelectorAll(".hintc").forEach(
    (b) =>
      (b.onclick = () => {
        st.scn.slit = b.dataset.hs;
        st.scn.ff = st.scn.fs = null;
        renderScn();
        const el = document.querySelector(`.pat[data-s="${b.dataset.hs}"]`);
        if (el) el.scrollIntoView({ block: "center", behavior: "smooth" });
      }),
  );
}
