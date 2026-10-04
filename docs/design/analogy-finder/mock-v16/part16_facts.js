// ---------- 来る艇の条件（若松で、何が効くか。数えた値） ----------
// [キー, 名前, 1位の言い方, 6位の言い方]
const RFM = [
  ["nat_win", "全国勝率", "高い", "低い"],
  ["loc_win", "当地勝率", "高い", "低い"],
  ["recent_win30", "直近30走の1着率", "高い", "低い"],
  ["motor_2", "モーター2連率", "高い", "低い"],
  ["boat_2", "ボート2連率", "高い", "低い"],
  ["st_mean30", "過去の平均ST", "早い", "遅い"],
  ["exh_time", "展示タイム", "速い", "遅い"],
  ["series_score", "今節の平均点", "高い", "低い"],
];
// 材料の説明（モーターとボートの違いが分かるように）
const MDESC = {
  nat_win: "全国のレースでの勝率（出走表の値。選手の成績）",
  loc_win: "この会場（若松）での勝率（出走表の値。選手の成績）",
  recent_win30: "その選手の直近30走で1着だった割合（選手の成績）",
  motor_2: "モーター＝エンジン。節ごとに抽選で割り当てられる。そのモーターがこれまで2着以内に入った割合で、エンジンの力の目安",
  boat_2: "ボート＝船体（エンジンを載せる艇）。モーターとは別に抽選で割り当てられる。そのボートがこれまで2着以内に入った割合",
  st_mean30: "その選手の直近30走のスタートタイミングの平均（小さいほど早い）",
  exh_time: "今日の展示航走で計る、直線のタイム（小さいほど速い）",
  series_score: "この節のこれまでのレースの着順を、1着10点・2着8点・3着6点・4着4点・5着2点・6着1点で平均した値（F・L・失格は0点）。公式の得点率と違い、準優勝戦も含める。節の初走は値が無い",
};
const SHORT = {
  nat_win: "全国勝率",
  loc_win: "当地勝率",
  recent_win30: "直近1着率",
  motor_2: "モーター",
  boat_2: "ボート",
  st_mean30: "平均ST",
  exh_time: "展示タイム",
  series_score: "今節",
};
const rfMats = () =>
  st.stage === "post" ? RFM : RFM.filter(([k]) => k !== "exh_time");
// 6艇中の順位を言葉にする
const rankWord = (r, hi, lo) =>
  r === 1
    ? `6艇で一番${hi}`
    : r === 6
      ? `6艇で一番${lo}`
      : `${hi}ほうから${r}番目`;
function hexRadar(svg, labels, series) {
  const n = labels.length,
    Cc = [200, 182],
    Rr = 100,
    pt = (i, r) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / n;
      return [Cc[0] + r * Math.cos(a), Cc[1] + r * Math.sin(a)];
    };
  const rr = (rank) => (rank == null ? null : ((7 - rank) / 6) * Rr);
  let h = "";
  [1, 2, 3, 4, 5, 6].forEach(
    (k) =>
      (h += `<polygon points="${labels.map((_, i) => pt(i, rr(k)).join(",")).join(" ")}" fill="none" stroke="rgba(201,162,39,${k === 1 ? 0.5 : 0.2})"/>`),
  );
  labels.forEach((_, i) => {
    const [x, y] = pt(i, Rr);
    h += `<line x1="${Cc[0]}" y1="${Cc[1]}" x2="${x}" y2="${y}" stroke="rgba(201,162,39,.2)"/>`;
  });
  [1, 6].forEach((k) => {
    h += `<text x="${Cc[0] + 4}" y="${Cc[1] - rr(k) + 10}" fill="#e8d089" opacity=".75" font-size="13" font-family="Zen Kaku Gothic New,sans-serif">${k}位</text>`;
  });
  series.forEach((s) => {
    if (s.v.every((x) => x != null))
      h += `<polygon points="${s.v.map((x, i) => pt(i, rr(x)).join(",")).join(" ")}" fill="${s.c}" fill-opacity="${s.dash ? 0.02 : 0.18}" stroke="${s.c}" stroke-width="${s.dash ? 1.4 : 2}" ${s.dash ? 'stroke-dasharray="6 4"' : ""}/>`;
    if (!s.dash)
      s.v.forEach((x, i) => {
        if (x == null) return;
        const [px, py] = pt(i, rr(x));
        h += `<circle cx="${px}" cy="${py}" r="3.2" fill="${s.c}" stroke="#0d1b2e"/>`;
      });
  });
  labels.forEach((t, i) => {
    const [x, y] = pt(i, Rr + 20),
      dx = x - Cc[0],
      an = dx > 8 ? "start" : dx < -8 ? "end" : "middle";
    h += `<text x="${x}" y="${y}" text-anchor="${an}" fill="#f3ead0" font-size="16" font-weight="700" font-family="Zen Kaku Gothic New,sans-serif"><tspan x="${x}">${t[0]}</tspan>${t[1] ? `<tspan x="${x}" dy="1.25em" fill="#e8d089" font-size="15">${t[1]}</tspan>` : ""}</text>`;
  });
  svg.innerHTML = h;
}
// 範囲（第8回の検証の指摘1）。今日の6艇の級別がそろっていれば、それをそろえた範囲を既定にする
const FSCOPE = [
  ["wkA1", "若松・6艇ともA1"],
  ["natA1", "全国・6艇ともA1"],
  ["wk", "若松の全レース"],
];
const FSCOPE_DESC = {
  wkA1: "若松で、6艇とも A1 だったレース（今日と同じ級別の組み合わせ）",
  natA1: "全国で、6艇とも A1 だったレース（今日と同じ級別の組み合わせ）",
  wk: "若松の全レース（級別の組み合わせはそろえていない。格の差があるレースが多い）",
};
const DIR = { nat_win: 1, loc_win: 1, recent_win30: 1, motor_2: 1, boat_2: 1, st_mean30: -1, exh_time: -1, series_score: 1 };
// 今日の艇の、6艇の中での位置（同じ値の艇も数える。指摘4）
const todayVal = (b, k) => (k === "series_score" ? D.tab1.ex_series[b] : D.rf.ex[b][k]).value;
const fmtV = (k, v) => v == null ? "—" : k === "recent_win30" ? Math.round(v * 100) + "%" : k === "motor_2" || k === "boat_2" ? v.toFixed(1) + "%" : k === "st_mean30" ? v.toFixed(2) : k === "exh_time" ? v.toFixed(2) : v.toFixed(2);
function todayPos(b, k) {
  const exv = (x) => (k === "series_score" ? D.tab1.ex_series[x] : D.rf.ex[x][k]);
  const vals = [1, 2, 3, 4, 5, 6].map((x) => exv(x).value);
  const v = vals[b - 1];
  if (v == null) return null;
  const ok = vals.filter((x) => x != null);
  const best = DIR[k] > 0 ? Math.max(...ok) : Math.min(...ok),
    worst = DIR[k] > 0 ? Math.min(...ok) : Math.max(...ok);
  const same = ok.filter((x) => x === v).length;
  return { bucket: v === best ? 1 : v === worst ? 6 : exv(b).rank, same };
}
function renderFacts() {
  const RF = D.rf,
    T1 = D.tab1;
  if (!RF || !T1) return;
  const S = T1.scopes[st.fscope],
    A = st.pb,
    Bb = st.two && st.b2 !== A ? st.b2 : null,
    t = MKEY[st.rank],
    mats = rfMats(),
    ex = RF.ex[A],
    exB = Bb ? RF.ex[Bb] : null,
    sname = FSCOPE.find(([k]) => k === st.fscope)[1];
  $("fscopeSeg").innerHTML = FSCOPE.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${st.fscope === k}">${l}</button>`).join("");
  $("fscopeSeg").querySelectorAll("button").forEach((b) => (b.onclick = () => ((st.fscope = b.dataset.v), render())));
  const rate = (b, k, r) => {
    const o = ((S.by[b] || {})[k] || {})[String(r)];
    return o ? o[t] : null;
  };
  const usual = (b) => S.usual[b][t];
  const U = usual(A),
    uP = U[0] / U[1];
  const level = (b, w) => {
    const [bl, bh] = wilson(b[0], b[1]),
      [wl, wh] = wilson(w[0], w[1]),
      d = b[0] / b[1] - w[0] / w[1];
    if (bl <= wh && wl <= bh) return ["差ははっきりしない", "weak", d];
    return [Math.abs(d) >= 0.05 ? "差が大きい" : "差は小さい", "", d];
  };
  const rows = mats
    .map(([k, l, hi, lo]) => {
      const all = [1, 2, 3, 4, 5, 6].map((r) => rate(A, k, r));
      const p = all.map((x) => (x && x[1] ? x[0] / x[1] : null));
      return { k, l, hi, lo, all, p, lv: level(all[0], all[5]), spread: p[0] - p[5] };
    })
    .sort((a, b) => (a.lv[1] === "weak") - (b.lv[1] === "weak") || Math.abs(b.spread) - Math.abs(a.spread));
  const typ = mats.map(([k]) => S.typ[A][k][t]);
  const pos = (b, k) => {
    const p = todayPos(b, k);
    return p ? p.bucket : null;
  };
  hexRadar(
    $("hexFacts"),
    mats.map(([k]) => [SHORT[k], pos(A, k) != null ? `${pos(A, k)}位/6艇中` : "今日 —"]),
    [{ v: typ, c: "#cbd5e1", dash: true }, { v: mats.map(([k]) => pos(A, k)), c: LINE6[A] }, ...(exB ? [{ v: mats.map(([k]) => pos(Bb, k)), c: LINE6[Bb] }] : [])],
  );
  $("hexKey").innerHTML = `<span style="--sc:${LINE6[A]}"><i></i>今日の${A}号艇（6艇中の順位）</span>${exB ? `<span style="--sc:${LINE6[Bb]}"><i></i>今日の${Bb}号艇</span>` : ""}<span style="--sc:#cbd5e1"><i class="d"></i>${sname}で${A}号艇が${RT[st.rank]}に入ったときの平均</span>`;
  const mx = Math.max(...rows.flatMap((r) => r.p.filter((x) => x != null)), uP) * 1.12;
  const strip = (r) => {
    const today = pos(A, r.k);
    return `<div class="strip" role="img" aria-label="${r.l}が6艇で何番目かごとの割合">${r.p
      .map((p, i) => {
        const [x, n] = r.all[i] || [0, 0],
          on = today === i + 1;
        return `<div class="col${on ? " on" : ""}" title="${x}/${n}"><span class="pv">${p == null ? "—" : Math.round(p * 100)}</span><span class="plot"><span class="bar" style="height:${p == null ? 0 : (p / mx) * 100}%;background:${LINE6[A]}"></span><span class="usual" style="bottom:${(uP / mx) * 100}%"></span></span><span class="rk">${i === 0 ? `一番${r.hi}` : i === 5 ? `一番${r.lo}` : i + 1}</span></div>`;
      })
      .join("")}</div>`;
  };
  const line = (b, r, prefix) => {
    const p = todayPos(b, r.k);
    if (!p) return "";
    const x = rate(b, r.k, p.bucket);
    if (!x || !x[1]) return "";
    const [lo, hi] = wilson(x[0], x[1]);
    const where = rankWord(p.bucket, r.hi, r.lo) + (p.same > 1 ? `（${p.same}艇が同じ値）` : "");
    const vs = [1, 2, 3, 4, 5, 6].map((x) => todayVal(x, r.k)).filter((v) => v != null);
    const valTxt = vs.length ? `（今日 ${fmtV(r.k, todayVal(b, r.k))}。6艇は ${fmtV(r.k, Math.min(...vs))}〜${fmtV(r.k, Math.max(...vs))}）` : "";
    return `<p class="today"><b>${prefix}</b>は${r.l}が<b>${where}</b>${valTxt}。${sname}で、そういう${b}号艇は過去 <b>${pc(x[0] / x[1], 0)}</b> が${RT[st.rank]}（${x[0].toLocaleString()}/${x[1].toLocaleString()}、95%の幅 ${pc(lo, 0)}〜${pc(hi, 0)}）</p>`;
  };
  const card = (r) => {
    const b = r.all[0],
      w = r.all[5],
      [lab, cls, d] = r.lv;
    let bLine = "";
    if (exB) {
      const pb = [1, 6].map((rk) => rate(Bb, r.k, rk));
      bLine = `<p class="sub">${Bb}号艇なら: 一番${r.hi}とき ${pc(pb[0][0] / pb[0][1], 0)} ／ 一番${r.lo}とき ${pc(pb[1][0] / pb[1][1], 0)}（全体では ${pc(usual(Bb)[0] / usual(Bb)[1], 0)}）</p>${line(Bb, r, `今日の${Bb}号艇`)}`;
    }
    return `<div class="eff ${cls}"><div class="eh"><b>${r.l}</b><small class="md">${MDESC[r.k]}</small><span class="gap">${lab}${!cls && d < 0 ? `（一番${r.lo}ときのほうが高い）` : ""}</span></div>
      <div class="pair"><div><span>6艇で一番${r.hi}とき</span><b>${pc(r.p[0], 0)}</b><small>${b[0].toLocaleString()}/${b[1].toLocaleString()}</small></div><div><span>6艇で一番${r.lo}とき</span><b>${pc(r.p[5], 0)}</b><small>${w[0].toLocaleString()}/${w[1].toLocaleString()}</small></div></div>
      ${strip(r)}<p class="stripcap">棒の上の数字は%（左ほど${r.hi}）。点線は全体の ${pc(uP, 1)}。枠で囲んだ棒が今日の位置</p>${line(A, r, `今日の${A}号艇`)}${bLine}</div>`;
  };
  const allClass = new Set([1, 2, 3, 4, 5, 6].map((b) => RF.ex[b].class)).size === 1;
  $("factsOut").innerHTML = `<div class="big1"><span>${sname}の全体で、${A}号艇が${RT[st.rank]}に入った割合</span><b>${pc(uP, 1)}</b><small>${U[0].toLocaleString()}/${U[1].toLocaleString()}レース（${T1.period[0]}〜${T1.period[1]}）</small></div>
  <p class="sub">${FSCOPE_DESC[st.fscope]}で、${A}号艇のその材料が6艇の中で一番良かったときと一番悪かったときに、${RT[st.rank]}に入った割合を比べた。差がはっきりしているものから、差の大きい順に並べている（差が近い材料どうしは、入れ替わってもおかしくない）。材料どうしは重なっていて（全国勝率と直近の1着率は、どちらも選手の格を見ている）、どれが効いたのかは分けられない。棒の点線は、全体での割合（上の大きい数字）</p>
  <div class="effs">${rows.filter((r) => r.k !== "boat_2").map(card).join("")}${rows.filter((r) => r.k === "boat_2").map((r) => `<details class="more boatfold"><summary>ボート2連率（着順との関係が小さい材料）</summary><p class="sub">全国・6艇とも A1 のレースでは、ボート2連率が6艇で一番高いとき・低いときの差は0〜3ポイントで、モーター2連率（5〜8ポイント）より着順との関係が小さかった。気にしすぎなくてよい材料として残している</p>${card(r)}</details>`).join("")}</div>
  ${allClass ? `<p class="foot">級別: 今日は6艇とも ${ex.class} なので差がつかない</p>` : ""}
  <p class="foot">数えた割合で、原因とは限らない。「差ははっきりしない」は、一番良いときと一番悪いときの95%の幅が重なるもの。「差が大きい」は5ポイント以上。同じ値の艇は、一番良い・一番悪いの両方に含めている。${st.stage === "pre" ? "展示タイムは展示の後に出る。" : "2025-11 以前の展示タイムは結果ファイルから取っていて、取り方が違う。"}</p>`;

  const c = D.cond;
  if (st.stage === "post" && c) {
    const mk = MKEY[st.rank];
    const W = c.wkWind01.boats[A][mk];
    $("windOut").innerHTML =
      `<h3>今日の風・波では（風1m・波1cm）</h3><p class="sub">この欄だけは、6艇ともA1に絞ると件数が足りないので、若松の全レースで数えている。比べる相手（点線）も若松の全レース</p><div class="bars">${[
        1, 2, 3, 4, 5, 6,
      ]
        .map((b) => {
          const w = c.wkWind01.boats[b][mk],
            wa = c.wkAll
              ? c.wkAll.boats[b][mk]
              : D.start["20|all|all"].boats[b][mk];
          return `<div class="fr"><span>${bn(b)} ${b}号艇</span><span class="wtrk"><span class="f" style="width:${w.p * 100}%;background:${LINE6[b]}"></span><span class="w" style="left:${w.lo * 100}%;width:${(w.hi - w.lo) * 100}%"></span><span class="nt" style="left:${wa.p * 100}%"></span></span><span class="v">${pc(w.p, 0)} <small>風を問わず ${pc(wa.p, 0)}</small></span></div>`;
        })
        .join(
          "",
        )}</div><p class="foot">若松で風0〜1mだったレースで、各艇番が${RT[st.rank]}に入った割合（${W.n.toLocaleString()}レース）。点線は若松の全レース。風は速さだけで分けている（追い風・向かい風は区別していない）。過去レースの風・波は発走時の記録で、今日の値は展示時点</p>`;
  } else
    $("windOut").innerHTML =
      st.stage === "pre"
        ? `<p class="foot">今日の風・波は、展示の後に出る</p>`
        : "";
}
