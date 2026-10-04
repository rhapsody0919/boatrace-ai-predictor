// ---------- ③ 1マークはどうなる？（選んだスリットの形のとき、攻める艇が勝ちきるか・1号艇が残すか。数えた値） ----------
const ATT_ROLE = {
  kado: "カド",
  d3: "カド",
  dash: "ダッシュ勢の先頭",
  d1: "凹んだ1コースの隣",
  d2: "凹んだ2コースの外",
};
const bucketOf = (rk) => (rk <= 2 ? "top" : rk <= 4 ? "mid" : "low");
const BUCKET_N = {
  top: "上位（1〜2位）",
  mid: "中位（3〜4位）",
  low: "下位（5〜6位）",
};
function markScope() {
  const s = st.scn.scope;
  if (s === "v20A1") return ["wkA1", "若松・6艇ともA1の枠なりのレース", false];
  if (s === "allA1Y")
    return ["allA1Y", "全国・6艇ともA1の優勝戦の枠なりのレース", false];
  return ["nat", "全国の枠なりのレース", s !== "all"];
}
function markHtml() {
  const M = D.mark1;
  if (!M) return "";
  const S = st.scn,
    post = st.stage === "post",
    ex = M.example;
  const head = `<h3><span class="stepn">3</span>1マークはどうなる？</h3>`;
  if (!(S.entry === "all" || S.entry === "waku"))
    return `${head}<p class="foot">1マークの見込みは、進入が枠なりのときだけ数えている（①で「枠なり」か「どの進入でも」を選ぶと出る）</p>`;
  if (S.slit === "any")
    return `${head}<p class="foot">②でスリットの形を選ぶと、その形のときに攻める艇が勝ちきったか、1号艇が残したかが出る</p>`;
  const F = M.forms[S.slit];
  if (!F) return "";
  const [sk, sname, other] = markScope();
  const rate = (o) =>
    o && o[1] >= 30
      ? pc(o[0] / o[1], 0)
      : o && o[1]
        ? `${o[0]}/${o[1]}件`
        : "—";
  const att = F.attacker;
  const rowsOf = (by, key, todayRank, label) => {
    const b = by && by[sk];
    if (!b) return "";
    const tb = bucketOf(todayRank);
    return `<tr class="grp"><th colspan="3">${label}</th></tr>${[
      "top",
      "mid",
      "low",
    ]
      .map((k) => {
        const o = b[k];
        if (!o) return "";
        return `<tr${k === tb ? ' class="today"' : ""}><th>${BUCKET_N[k]}${k === tb ? "<small>今日</small>" : ""}</th><td>${key.map((kk) => rate(o[kk])).join("</td><td>")}</td></tr>`;
      })
      .join("")}`;
  };
  let body = "";
  if (att) {
    const all = F.all[sk];
    const mr = ex.motor_rank[att - 1],
      er = ex.exh_rank[att - 1];
    const tech =
      all && all.att_win && all.att_win[0]
        ? ["att_makuri_of_win", "att_makurizashi_of_win", "att_sashi_of_win"]
            .map(
              (k, i) =>
                `${["まくり", "まくり差し", "差し"][i]} ${pc(all[k][0] / all[k][1], 0)}`,
            )
            .join("・")
        : "";
    body = `<p class="sub">攻める艇: <b>${bn(att)} ${att}号艇（${ATT_ROLE[S.slit]}）</b>。今日はモーター2連率 6艇中${mr}位${post ? `・展示タイム 6艇中${er}位` : ""}</p>
    <div class="big1"><span>${SLITN[S.slit]}のとき（${sname}）、${att}号艇が1着</span><b>${rate(all.att_win)}</b><small>${all.att_win[0].toLocaleString()}/${all.att_win[1].toLocaleString()}レース。1号艇の逃げは ${rate(all.b1_nige)}</small></div>
    <div class="tbl"><table class="mk-t"><thead><tr><th>${att}号艇の順位</th><th>${att}号艇の1着</th><th>1号艇の逃げ</th></tr></thead><tbody>
      ${post ? rowsOf(F.by_exh, ["att_win", "b1_nige"], er, `${att}号艇の展示タイム`) : ""}
      ${rowsOf(F.by_motor, ["att_win", "b1_nige"], mr, `${att}号艇のモーター2連率`)}
    </tbody></table></div>
    ${tech ? `<p class="foot">${att}号艇が勝ったときの決まり手: ${tech}</p>` : ""}`;
  } else {
    const all = F.all[sk];
    const mr = ex.motor_rank[0],
      er = ex.exh_rank[0];
    body = `<p class="sub">${SLITN[S.slit]}は、外から攻める艇がいない形。1号艇が逃げきれるかを見る。今日の1号艇はモーター2連率 6艇中${mr}位${post ? `・展示タイム 6艇中${er}位` : ""}</p>
    <div class="big1"><span>${SLITN[S.slit]}のとき（${sname}）、1号艇の逃げ</span><b>${rate(all.b1_nige)}</b><small>${all.b1_nige[0].toLocaleString()}/${all.b1_nige[1].toLocaleString()}レース</small></div>
    <div class="tbl"><table class="mk-t"><thead><tr><th>1号艇の順位</th><th>1号艇の逃げ</th><th>1号艇の2着以内</th></tr></thead><tbody>
      ${post ? rowsOf(F.b1_by_exh, ["b1_nige", "b1_top2"], er, "1号艇の展示タイム") : ""}
      ${rowsOf(F.b1_by_motor, ["b1_nige", "b1_top2"], mr, "1号艇のモーター2連率")}
    </tbody></table></div>`;
  }
  return `${head}
  <p class="foot">1マークで誰が先に回ったかの記録は無いので、着順と決まり手で見ている。${other ? "上の「数えるレース」とは違い、全国の枠なりのレースで数えた。" : ""}</p>
  ${body}
  <p class="foot">${post ? "全国では、モーター2連率より展示タイムの順位の方が、攻める艇の1着・1号艇の逃げの差が大きい（上位と下位で9〜18ポイント。モーターは4〜8ポイント）。" : "展示タイムで分けた表は、展示の後に出る（全国ではモーター2連率より差が大きい）。"}30件未満の区分は件数で出している。同じ値の艇は上の順位にそろえている。数えた割合で、原因とは限らない</p>`;
}
