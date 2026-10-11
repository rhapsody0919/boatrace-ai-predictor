// ---------- ③ 攻めは決まった？（選んだスリットの形のとき、攻める艇と1号艇の着順。数えた値） ----------
// 第11回の統計の検証とファン評価の直しを反映: 件数をすべて添える／少ない範囲は全国（6艇ともA1）を並べる／差がぶれ幅に収まるときは書く
const ATT_ROLE = {
  kado: "4コース。カド",
  d3: "4コース。カド",
  dash: "4コース。カド",
  d1: "2コース。インが遅れたところを攻める",
  d2: "3コース。2コースが遅れたところを攻める",
};
const bucketOf = (rk) => (rk <= 2 ? "top" : rk <= 4 ? "mid" : "low");
const BUCKET_N = {
  top: "上位（1〜2位）",
  mid: "中位（3〜4位）",
  low: "下位（5〜6位）",
};
const SMALL_N = 50;
function markScope() {
  const s = st.scn.scope,
    has = (k) => D.mark1 && D.mark1.forms.kado.all[k];
  if (s === "v20A1") return ["wkA1", "若松・6艇ともA1", "allA1"];
  if (s === "allA1Y") return ["allA1Y", "全国・6艇ともA1の優勝戦", "allA1"];
  if (s === "allA1" && has("allA1")) return ["allA1", "全国・6艇ともA1", null];
  if ((s === "v20" || s === "v20G1") && has("wk"))
    return [
      "wk",
      "若松の全レース" + (s === "v20G1" ? "（G1だけには絞っていない）" : ""),
      "nat",
    ];
  return ["nat", "全国の全レース", null];
}
const cell = (o) => {
  if (!o || !o[1]) return "—";
  const p = pc(o[0] / o[1], 0);
  return o[1] < SMALL_N
    ? `<span class="few">${p}<small>${o[0]}/${o[1]}・少ない</small></span>`
    : `${p}<small>${o[0].toLocaleString()}/${o[1].toLocaleString()}</small>`;
};
// 上位と下位の差が、ぶれ幅（2標準誤差）に収まるか
const clearDiff = (a, b) => {
  if (!a || !b || !a[1] || !b[1]) return false;
  const p1 = a[0] / a[1],
    p2 = b[0] / b[1],
    se = Math.sqrt((p1 * (1 - p1)) / a[1] + (p2 * (1 - p2)) / b[1]);
  return Math.abs(p1 - p2) > 2 * se;
};
function markHtml() {
  const M = D.mark1;
  if (!M) return "";
  const S = st.scn,
    post = st.stage === "post",
    ex = M.example;
  const head = `<h3><span class="stepn">3</span>攻めは決まった？（攻める艇と1号艇の着順）</h3>`;
  if (!(S.entry === "all" || S.entry === "waku"))
    return `${head}<p class="foot">進入が枠なりのときだけ数えている（①で「枠なり」か「どの進入でも」を選ぶと出る）</p>`;
  if (S.slit === "any")
    return `${head}<p class="foot">②でスリットの形を選ぶと、その形のときに攻める艇が勝ちきったか、1号艇が逃げたかが出る</p>`;
  const F = M.forms[S.slit];
  if (!F) return "";
  const [sk, sname, ref] = markScope();
  const refName = ref === "allA1" ? "全国A1" : "全国";
  const att = F.attacker;
  const fmtVal = (k, i) =>
    k === "motor" ? `${ex.motor[i].toFixed(1)}%` : ex.exh[i].toFixed(2);
  const rangeOf = (k) => {
    const v = ex[k];
    return k === "motor"
      ? `${Math.min(...v).toFixed(1)}〜${Math.max(...v).toFixed(1)}%`
      : `最速 ${Math.min(...v).toFixed(2)}`;
  };
  const table = (byE, byM, keys, heads, boat, who) => {
    const sec = (by, label, rk) => {
      const b = by && by[sk];
      if (!b) return "";
      const r = ref && by[ref];
      const tb = bucketOf(rk);
      const rows = ["top", "mid", "low"]
        .map((k) => {
          const o = b[k];
          if (!o) return "";
          return `<tr${k === tb ? ' class="today"' : ""}><th>${BUCKET_N[k]}${k === tb ? "<small>今日</small>" : ""}</th>${keys.map((kk) => `<td>${cell(o[kk])}${r && r[k] ? `<em>${refName} ${pc(r[k][kk][0] / r[k][kk][1], 0)}</em>` : ""}</td>`).join("")}</tr>`;
        })
        .join("");
      const unclear = !clearDiff(
        b.top && b.top[keys[0]],
        b.low && b.low[keys[0]],
      );
      return `<tr class="grp"><th colspan="${keys.length + 1}">${label}${unclear ? `<small class="uc">この範囲では、上位と下位の差ははっきりしない</small>` : ""}</th></tr>${rows}`;
    };
    return `<div class="tbl"><table class="mk-t"><thead><tr><th>${who}の順位</th>${heads.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>
      ${post ? sec(byE, `${who}の展示タイム（${fmtVal("exh", boat - 1)}・6艇中${ex.exh_rank[boat - 1]}位・${rangeOf("exh")}）`, ex.exh_rank[boat - 1]) : ""}
      ${sec(byM, `${who}のモーター2連率（${fmtVal("motor", boat - 1)}・6艇中${ex.motor_rank[boat - 1]}位・6艇は${rangeOf("motor")}）`, ex.motor_rank[boat - 1])}
    </tbody></table></div>`;
  };
  const natDiff = (by, key) => {
    const b = by && by.nat;
    if (!b || !b.top || !b.low) return null;
    return Math.round(
      Math.abs(b.top[key][0] / b.top[key][1] - b.low[key][0] / b.low[key][1]) *
        100,
    );
  };
  const all = F.all[sk];
  let body = "";
  if (att) {
    const outer = att + 1 <= 6 ? att + 1 : null;
    const wins = all.att_win[0];
    const tk = [
      ["まくり", "att_makuri_of_win"],
      ["まくり差し", "att_makurizashi_of_win"],
      ["差し", "att_sashi_of_win"],
    ].filter(([, k]) => all[k] && all[k][0] > 0);
    const tech = tk.length
      ? wins >= 30
        ? tk.map(([n, k]) => `${n} ${pc(all[k][0] / all[k][1], 0)}`).join("・")
        : tk.map(([n, k]) => `${n} ${all[k][0]}`).join("・") + `（${wins}勝中）`
      : "";
    const dE = natDiff(F.by_exh, "att_win"),
      dM = natDiff(F.by_motor, "att_win");
    const lead =
      S.slit !== "d1" && F.att_lead && F.att_lead[1]
        ? `本番で${att}号艇が内の艇より0.05秒以上前に出たのは、この形の ${pc(F.att_lead[0] / F.att_lead[1], 0)}（全国）。`
        : "";
    body = `<p class="sub">攻める艇: <b>${bn(att)} ${att}号艇（${ATT_ROLE[S.slit]}）</b>。この形のとき、外の艇で一番1着が多い艇（必ず攻めるという意味ではない）</p>
    <div class="big1"><span>${SLITN[S.slit]}のとき（${sname}の枠なり）、${att}号艇が1着</span><b>${pc(all.att_win[0] / all.att_win[1], 0)}</b><small>${all.att_win[0].toLocaleString()}/${all.att_win[1].toLocaleString()}レース。${att}号艇の2着以内 ${pc(all.att_top2[0] / all.att_top2[1], 0)}${outer ? `・すぐ外の${outer}号艇の1着 ${pc(all.winner[outer - 1] / all.n, 0)}` : ""}・1号艇の逃げ ${pc(all.b1_nige[0] / all.b1_nige[1], 0)}</small></div>
    ${table(F.by_exh, F.by_motor, ["att_win", "b1_nige"], [`${att}号艇の1着`, "1号艇の逃げ"], att, `${att}号艇`)}
    ${tech ? `<p class="foot">${att}号艇が勝ったときの決まり手: ${tech}</p>` : ""}
    <p class="foot">${lead}${dE != null ? `全国では、この形の${att}号艇の1着率は、展示タイム上位と下位で${dE}ポイント、モーター2連率で${dM}ポイント違う。` : ""}</p>`;
  } else {
    const dE = natDiff(F.b1_by_exh, "b1_nige"),
      dM = natDiff(F.b1_by_motor, "b1_nige");
    body = `<p class="sub">${SLITN[S.slit]}は、外から攻める艇がいない形。1号艇が逃げきれたかを見る</p>
    <div class="big1"><span>${SLITN[S.slit]}のとき（${sname}の枠なり）、1号艇の逃げ</span><b>${pc(all.b1_nige[0] / all.b1_nige[1], 0)}</b><small>${all.b1_nige[0].toLocaleString()}/${all.b1_nige[1].toLocaleString()}レース。2着以内 ${pc(all.b1_top2[0] / all.b1_top2[1], 0)}</small></div>
    
    ${table(F.b1_by_exh, F.b1_by_motor, ["b1_nige", "b1_top2"], ["逃げ", "2着以内"], 1, "1号艇")}
    <p class="foot">1号艇は展示タイムで上位に入りやすい（全国で約半数）。${dE != null ? `全国では、この形の1号艇の逃げは、展示タイム上位と下位で${dE}ポイント、モーター2連率で${dM}ポイント違う。` : ""}</p>`;
  }
  const ov = F.overlap ? Object.entries(F.overlap).map(([k, v]) => [k, v[1] ? v[0] / v[1] : 0]).sort((a, b) => b[1] - a[1])[0] : null;
  return `${head}
  <p class="foot">1マークで誰が先に回ったかの記録は無いので、着順と決まり手で見ている</p>
  ${body}
  <p class="foot">件数が${SMALL_N}件未満の区分は薄く出している（ぶれやすい）。${ref ? `件数が少ないので、${refName === "全国A1" ? "全国・6艇ともA1（全国A1）" : refName}の同じ区分の率を小さく並べた。` : ""}平均STが6艇そろうレースだけで数えたので、④より件数が少し少ないことがある。同じ値の艇は上の順位にそろえている。${ov ? `形は重なる（${SLITN[S.slit]}の${pc(ov[1], 0)}は${SLITN[ov[0]]}にも当たる）。` : ""}数えた割合で、原因とは限らない</p>`;
}
