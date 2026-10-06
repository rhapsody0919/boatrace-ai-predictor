// ---------- 展開シナリオ（進入 → スリット → 結果。数えた値） ----------
const SCN_SCOPE = [["v20A1", "若松・6艇ともA1"], ["allA1", "全国・6艇ともA1"],
  ["allA1Y", "全国・6艇ともA1の優勝戦"], ["v20", "若松の全レース"], ["v20G1", "若松のG1"], ["all", "全国の全レース"]];
const ENTRY = {
  all: "どの進入でも",
  waku: "枠なり",
  mae: "前付けあり（1号艇イン）",
  mae6: "6号艇だけ前付け",
  mae5: "5号艇だけ前付け",
  mae56: "5・6号艇が前付け",
  maeOther: "その他の前付け",
  inlost: "1号艇がインを取られた",
};
const MAE_SUB = ["mae6", "mae5", "mae56", "maeOther"];
const SLIT = [
  ["any", "どの形でも", ""],
  ["flat", "横一線", "6艇のSTの差が0.06秒以内"],
  ["wall", "内3艇そろう", "1〜3コースのSTの差が0.02秒以内"],
  ["d2", "2コース凹み", "2コースが両隣（1・3コース）より0.05秒以上遅い"],
  ["d3", "カド受け凹み", "3コースが両隣（2・4コース）より0.05秒以上遅い"],
  ["kado", "カド一撃", "4コースが1〜3コースのどれよりも0.03秒以上早い"],
  ["d1", "イン凹み", "1コースが2コースより0.05秒以上遅い"],
  ["dash", "ダッシュ勢先行", "4〜6コースが1〜3コースより平均0.05秒以上早い"],
];
const SLITN = Object.fromEntries(SLIT.map(([k, l]) => [k, l]));
const MIN_N = 30;

// スリットの絵（BOA-635 のモックの SlitScene と同じ描き方。横から見た並び、1艇身≒0.13秒の実縮尺）
const SLIT_EX = {
  flat: [0, 0.01, 0, 0.02, 0.01, 0.02],
  wall: [0.01, 0, 0.01, 0.05, 0.07, 0.06],
  d2: [0, 0.05, 0, 0.01, 0.02, 0.02],
  d3: [0, 0.01, 0.05, 0, 0.02, 0.03],
  kado: [0.03, 0.04, 0.03, 0, 0.02, 0.03],
  d1: [0.05, 0, 0.01, 0.01, 0.02, 0.02],
  dash: [0.05, 0.06, 0.05, 0, 0.01, 0],
};
let sceneSeq = 0;
function slitScene(stc, h = 110, ref = null) {
  const n = stc.length, W = 260, H = h, top = 4, lane = (H - top - 14) / n, L = 64, lineX = W - 14, SPB = 0.13;
  const mn = Math.min(...stc, ...(ref || [])), gid = "wat" + ++sceneSeq;
  const boats = stc
    .map((v, i) => {
      const x = lineX - ((v - mn) / SPB) * L, y = top + lane * i + lane / 2, hh = Math.max(3, lane * 0.32), col = BC[i + 1][0];
      return `<g><path d="M${x - L} ${y - hh} L${x - L * 0.22} ${y - hh} Q${x} ${y - hh * 0.4} ${x} ${y} Q${x} ${y + hh * 0.4} ${x - L * 0.22} ${y + hh} L${x - L} ${y + hh} Z" fill="#f4f1ea" stroke="#556070" stroke-width=".8"/><path d="M${x - L - 10} ${y + hh * 0.2} q-8 -2 -16 0 q8 2 16 0" fill="#ffffff" fill-opacity=".55"/><rect x="${x - L * 0.62}" y="${y - hh * 0.75}" width="${L * 0.22}" height="${hh * 1.5}" rx="${hh * 0.5}" fill="${col}" stroke="#1f2937" stroke-width=".6"/><circle cx="${x - L * 0.38}" cy="${y}" r="${hh * 0.72}" fill="${col}" stroke="#1f2937" stroke-width=".6"/><text x="${x - L + 7}" y="${y + 3.5}" font-size="${Math.min(10, lane * 0.6)}" font-family="JetBrains Mono, monospace" font-weight="700" fill="#1f2937">${i + 1}</text></g>`;
    })
    .join("");
  const refs = ref ? ref.map((v, i) => { const x = lineX - ((v - mn) / SPB) * L, y = top + lane * i + lane / 2; return `<line x1="${x}" y1="${y - lane * 0.48}" x2="${x}" y2="${y + lane * 0.48}" stroke="#e8d089" stroke-width="1.8" stroke-dasharray="3 2"/>`; }).join("") : "";
  const waves = [...Array(n)].map((_, i) => `<path d="M0 ${top + lane * (i + 1)} q20 -2 40 0 t40 0 t40 0 t40 0 t40 0 t40 0 t40 0" stroke="#ffffff" stroke-opacity=".18" fill="none"/>`).join("");
  const scale = `<g><line x1="12" y1="${H - 6}" x2="${12 + L}" y2="${H - 6}" stroke="#e8f1ff" stroke-width="1.2"/><line x1="12" y1="${H - 9}" x2="12" y2="${H - 3}" stroke="#e8f1ff"/><line x1="${12 + L}" y1="${H - 9}" x2="${12 + L}" y2="${H - 3}" stroke="#e8f1ff"/><text x="${16 + L}" y="${H - 3}" font-size="12" fill="#e8f1ff">1艇身（約0.13秒）</text></g>`;
  return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="スリット通過の並び（横から見た図。数字はコース）"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#1d4f73"/><stop offset="1" stop-color="#123a57"/></linearGradient></defs><rect width="${W}" height="${H}" fill="url(#${gid})"/>${waves}<line x1="${lineX}" y1="0" x2="${lineX}" y2="${H}" stroke="#ff8a3d" stroke-width="1.8"/><text x="${lineX - 4}" y="${H - 4}" font-size="12" text-anchor="end" fill="#ffd2b0">スリット</text>${boats}${refs}${scale}</svg>`;
}

const yen = (v) => (v == null ? "—" : v.toLocaleString() + "円");
function renderFlowX(a, o, S) {
  const svg = $(o.svg);
  const tri = Object.entries(a.tri)
    .map(([k, c]) => [k.split("-").map(Number), c])
    .filter(([x]) => !S.ff || x[0] === S.ff);
  const tot = tri.reduce((s, [, c]) => s + c, 0);
  const X = [44, 188, 332],
    W = 22,
    H = 340,
    top = 30,
    gap = 8;
  const col = [0, 1, 2].map((p) => {
    const m = {};
    for (let b = 1; b <= 6; b++) m[b] = 0;
    tri.forEach(([x, c]) => (m[x[p]] += c));
    return m;
  });
  const scale = tot ? (H - gap * 5) / tot : 0;
  const pos = col.map((m) => {
    let y = top;
    const r = {};
    for (let b = 1; b <= 6; b++) {
      r[b] = { y, h: Math.max(m[b] * scale, m[b] ? 1.5 : 0) };
      y += r[b].h + gap;
    }
    return r;
  });
  const link = (p) => {
    const m = {};
    tri.forEach(([x, c]) => {
      const k = x[p] + "-" + x[p + 1];
      m[k] = (m[k] || 0) + c;
    });
    return Object.entries(m).map(([k, c]) => [k.split("-").map(Number), c]);
  };
  let h = "";
  const outY = pos.map((r) =>
      Object.fromEntries(Object.entries(r).map(([b, v]) => [b, v.y])),
    ),
    inY = pos.map((r) =>
      Object.fromEntries(Object.entries(r).map(([b, v]) => [b, v.y])),
    );
  [0, 1].forEach((p) => {
    link(p)
      .sort((u, v) => u[0][0] - v[0][0] || u[0][1] - v[0][1])
      .forEach(([[x, y], c]) => {
        const w = Math.max(c * scale, 1);
        const y0 = outY[p][x] + w / 2,
          y1 = inY[p + 1][y] + w / 2;
        outY[p][x] += c * scale;
        inY[p + 1][y] += c * scale;
        const x0 = X[p] + W,
          x1 = X[p + 1],
          mx = (x0 + x1) / 2;
        const sel = S.fs && S.fs.p === p && S.fs.a === x && S.fs.b === y;
        const op = sel
          ? 0.95
          : S.fs
            ? 0.12
            : 0.25 + 0.6 * Math.min(1, c / (tot * 0.08 || 1));
        h += `<path d="M${x0},${y0}C${mx},${y0} ${mx},${y1} ${x1},${y1}" stroke="${FLOW[x]}" stroke-width="${w}" fill="none" stroke-opacity="${op}" data-l="${p},${x},${y},${c}" style="cursor:pointer"/>`;
      });
  });
  pos.forEach((r, p) => {
    for (let b = 1; b <= 6; b++) {
      if (!r[b].h) continue;
      const on = p === 0 && S.ff === b;
      h += `<rect x="${X[p]}" y="${r[b].y}" width="${W}" height="${r[b].h}" fill="${BC[b][0]}" stroke="${on ? "#fff" : "#94a3b8"}" stroke-width="${on ? 2 : 0.8}" ${p === 0 ? `data-first="${b}" style="cursor:pointer"` : ""}/>`;
      if (r[b].h >= 11)
        h += `<text x="${X[p] + W / 2}" y="${r[b].y + r[b].h / 2 + 4}" text-anchor="middle" font-size="11" font-weight="700" fill="${BC[b][1]}" font-family="JetBrains Mono,monospace">${b}</text>`;
      h += `<text x="${p === 2 ? X[p] + W + 6 : p === 0 ? X[p] - 6 : X[p] + W + 4}" y="${r[b].y + r[b].h / 2 + 4}" text-anchor="${p === 0 ? "end" : "start"}" font-size="12" fill="#e8d089" font-family="JetBrains Mono,monospace">${col[p][b] ? col[p][b].toLocaleString() + "件" : ""}</text>`;
    }
  });
  ["1着", "2着", "3着"].forEach(
    (tx, p) =>
      (h += `<text x="${X[p] + W / 2}" y="18" text-anchor="middle" font-size="14" font-weight="700" fill="#f3ead0" font-family="Zen Kaku Gothic New,sans-serif">${tx}</text>`),
  );
  svg.innerHTML = h;
  $(o.note).textContent = S.ff
    ? ""
    : "2着→3着の帯は、1着の艇を問わずに数えている。1着の四角をタップすると、その艇が勝ったレースだけで描き直す";
  svg.querySelectorAll("[data-first]").forEach(
    (e) =>
      (e.onclick = () => {
        const b = +e.dataset.first;
        S.ff = S.ff === b ? null : b;
        S.fs = null;
        renderScn();
      }),
  );
  svg.querySelectorAll("[data-l]").forEach(
    (e) =>
      (e.onclick = () => {
        const [p, x, y, c] = e.dataset.l.split(",").map(Number);
        S.fs =
          S.fs && S.fs.p === p && S.fs.a === x && S.fs.b === y
            ? null
            : { p, a: x, b: y, c };
        $(o.tip).textContent = S.fs
          ? `${p ? "2着" : "1着"}の${x}号艇 → ${p ? "3着" : "2着"}の${y}号艇: ${c}件（${tot}件中）`
          : "帯をタップすると件数が出る";
        renderFlowX(a, o, S);
      }),
  );
  const all = tri.sort((u, v) => v[1] - u[1]);
  const row = ([x, c]) =>
    `<div class="br" style="cursor:default"><span class="bnrow">${x.map(bn).join("")}</span><span class="wtrk"><span class="f" style="width:${(c / all[0][1]) * 100}%"></span></span><span class="v">${pc(c / tot, 1)} <small>${c.toLocaleString()}件</small></span></div>`;
  $(o.tri).innerHTML =
    all.slice(0, 5).map(row).join("") || `<p class="foot">0件</p>`;
}
function renderScn() {
  const P = D.scn;
  if (!P) return;
  const S = st.scn,
    SC = P.scopes[S.scope],
    cell = (e, s) => SC.cells[e].forms[s],
    whole = cell("all", "any"),
    // 比べる相手（指摘6）: スリットを選んだら「選んだ進入の型・どの形でも」、選ばなければ範囲の全レース
    base = S.slit !== "any" ? cell(S.entry, "any") : whole,
    post = st.stage === "post";
  const c = cell(S.entry, S.slit);
  const share = (x, n) => (n ? pc(x / n, 0) : "—");
  const exEntry = P.example.entry_type; // 今日の展示の進入の型
  const entryRow = (e, sub) => {
    const x = cell(e, "any"),
      tot = whole.n,
      on = S.entry === e,
      today =
        post && (e === exEntry || (e === "mae" && MAE_SUB.includes(exEntry)));
    return `<button type="button" class="ent${sub ? " sub" : ""}" data-e="${e}" aria-pressed="${on}"><span class="nm">${ENTRY[e]}${today ? `<span class="todayb">今日の展示</span>` : ""}</span><span class="sh">${share(x.n, tot)}</span><span class="b1">${x.n >= MIN_N ? `1号艇の1着率${pc(x.b1_win.p, 0)}` : `${x.n}件（少ないので1着率は出さない）`}</span></button>`;
  };
  const openMae = S.entry === "mae" || MAE_SUB.includes(S.entry);
  const chips = SLIT.map(([k, l]) => {
    const x = cell(S.entry, k),
      inEntry = cell(S.entry, "any").n;
    return `<button type="button" class="pat${k === "any" ? " any" : ""}" data-s="${k}" aria-pressed="${S.slit === k}"><span class="k">${l}${((r) => (r ? `<span class="hintb">平均STが当てはまる ${pc(r.ph, 0)}（当てはまらないとき${pc(r.pm, 0)}）</span>` : ""))(hintForms().get(k))}</span>${k === "any" ? "" : slitScene(SLIT_EX[k])}<span class="fq">${k === "any" || inEntry < MIN_N ? `${x.n.toLocaleString()}件` : `${share(x.n, inEntry)}（${x.n.toLocaleString()}件）`}${x.n >= MIN_N ? `・1号艇の1着率${pc(x.b1_win.p, 0)}` : ""}</span></button>`;
  // 進入の件数が少ないときは割合を出さない（③の扱いと合わせる）
  }).join("");
  const def = SLIT.find(([k]) => k === S.slit)[2];
  const scopeName = SCN_SCOPE.find(([k]) => k === S.scope)[1];
  const allOf = (n) => (/全レース$/.test(n) ? n : n + "の全レース");
  // [単独のとき, スリットとつなぐとき, 添え書き, 「〇〇のレース」]
  const EPH = {
    waku: ["進入が枠なりだった", "進入が枠なりで", "", "枠なりのレース"],
    mae: ["前付けがあった", "前付けがあって", "1号艇はイン", "前付けがあったレース"],
    mae6: ["6号艇だけが前付けした", "6号艇だけが前付けして", "", "6号艇だけが前付けしたレース"],
    mae5: ["5号艇だけが前付けした", "5号艇だけが前付けして", "", "5号艇だけが前付けしたレース"],
    mae56: ["5・6号艇が前付けした", "5・6号艇が前付けして", "", "5・6号艇が前付けしたレース"],
    maeOther: ["そのほかの前付けがあった", "そのほかの前付けがあって", "", "そのほかの前付けがあったレース"],
    inlost: ["1号艇がインを取られた", "1号艇がインを取られて", "", "1号艇がインを取られたレース"],
  };
  const E = S.entry !== "all" ? EPH[S.entry] : null,
    sl = S.slit !== "any";
  const core = E
    ? sl
      ? `<b>${E[1]}</b>、スリットが<b>${SLITN[S.slit]}</b>だったレース`
      : `<b>${E[0]}</b>レース`
    : sl
      ? `スリットが<b>${SLITN[S.slit]}</b>だったレース`
      : `<b>${allOf(scopeName)}</b>`;
  const baseName = sl && E ? `${ENTRY[S.entry].replace(/（.*）$/, "")}全体（どの形でも）` : allOf(scopeName);
  const EXCL = { v20: 293, v20G1: 11, all: 7480, v20A1: 17, allA1: 411, allA1Y: 18 };
  const head = E || sl ? `${scopeName}で、${core}${E && E[2] ? `（${E[2]}）` : ""}` : core;
  const paren = [E && E[2], ...(E && sl ? [`${E[3]}の${share(c.n, base.n)}`] : []), ...(E || sl ? [`${allOf(scopeName)}の${share(c.n, whole.n)}`] : [])].filter(Boolean).join("、").replace(/^(1号艇はイン)、/, "$1。");
  const heroT = `${core}${paren ? `（${paren}）` : ""}`;
  let res = "";
  if (!c.n) res = `<p class="warn">${head}は、過去に1件も無い</p>`;
  else if (c.n < MIN_N) {
    const sum = (arr) =>
      arr
        .map((v, i) => (v ? `${i + 1}号艇${v}件` : ""))
        .filter(Boolean)
        .join("・");
    res = `<div class="hero"><span class="n">${c.n}<small>件</small></span><span class="t">${head}は少ないので、割合ではなく1件ずつ並べる</span></div>
    <p class="sub">1着: ${sum(c.first_boat)}。万舟${c.manshu}件</p>
    <div class="rlist">${(c.races || [])
      .map((r) => {
        const byCourse = [1, 2, 3, 4, 5, 6].map((cs) => r.course_by_boat.indexOf(cs) + 1);
        const gname = ({ ippan: "一般" })[r.grade] || r.grade;
        return `<div class="rc"><div class="rc1"><b class="dt">${fmtD(r.date)}</b>${r.venue}${r.race_number}R ${gname}${r.stage ? (/[0-9A-Za-z]$/.test(gname) ? "" : " ") + r.stage : ""}</div><div class="rc2"><span class="bnrow">${r.finish_1_2_3.split("-").map((b) => bn(+b)).join("")}</span> ${r.technique}　3連単<b class="mono">${yen(r.payout_3tan)}</b></div><div class="rc3">進入 <span class="mono">${byCourse.slice(0, 3).join("")}/${byCourse.slice(3).join("")}</span>　スリット: ${r.forms.length ? r.forms.map((f) => SLITN[f]).join("・") : "どの形にも当てはまらない"}</div></div>`;
      })
      .join("")}</div>`;
  } else {
    const bar = (lab, x, n, ref, color) => {
      const p = x / n,
        [lo, hi] = wilson(x, n);
      return `<div class="br" style="cursor:default"><span>${lab}</span><span class="wtrk"><span class="f" style="width:${p * 100}%${color ? `;background:${color}` : ""}"></span><span class="w" style="left:${lo * 100}%;width:${(hi - lo) * 100}%"></span>${ref != null ? `<span class="nt" style="left:${ref * 100}%"></span>` : ""}</span><span class="v">${pc(p, 0)} <small>${x.toLocaleString()}件</small></span></div>`;
    };
    const tq = Object.entries(c.technique).filter(
      ([k, v]) => v || k !== "その他",
    );
    const bt = base.technique;
    const hit3 = (b) =>
      c.first_boat[b - 1] + c.second_boat[b - 1] + c.third_boat[b - 1];
    res = `<div class="hero"><span class="n">${c.n.toLocaleString()}<small>件</small></span><span class="t">${heroT}</span></div>
    <div class="key"><span><i style="background:var(--bar)"></i>このシナリオ</span><span><i style="border-left:2px dotted var(--hit);width:2px;height:12px"></i>${baseName}</span><span>棒の横線＝件数が少ないときのぶれ幅（だいたいこの間に入る）</span></div>
    <h3>1着になった艇</h3><div class="bars">${[1, 2, 3, 4, 5, 6].map((b) => bar(`${bn(b)} ${b}号艇`, c.first_boat[b - 1], c.n, base.first_boat[b - 1] / base.n, LINE6[b])).join("")}</div>
    <h3>3着以内に入った艇</h3><div class="bars">${[1, 2, 3, 4, 5, 6].map((b) => bar(`${bn(b)} ${b}号艇`, hit3(b), c.n, (base.first_boat[b - 1] + base.second_boat[b - 1] + base.third_boat[b - 1]) / base.n, LINE6[b])).join("")}</div>
    <h3>どう決まった？</h3><div class="bars">${tq.map(([k, v]) => bar(k, v, c.n, (bt[k] || 0) / base.n)).join("")}</div>
    <div class="big1"><span>万舟（3連単1万円以上）</span><b>${pc(c.manshu / c.payout_known, 0)}</b><small>${c.manshu.toLocaleString()}/${c.payout_known.toLocaleString()}レース。${baseName}は${pc(base.manshu / base.payout_known, 0)}</small></div>
    ${
      c.tri
        ? `<h3>着順の流れ</h3><div class="scope" style="background:var(--navy-900)"><svg id="scnSankey" viewBox="0 0 400 400" role="img" aria-label="このシナリオの1着→2着→3着の流れ"></svg></div><div class="tip" id="scnTip">帯をタップすると件数が出る</div><p class="foot" id="scnNote"></p><h3>よく出た3連単</h3><div class="bars" id="scnTri"></div>`
        : `<p class="foot">着順の流れ（サンキー図）と3連単の組み合わせは集計中</p>`
    }`;
  }
  $("scnOut").innerHTML =
    `<p class="sub">「もし進入がこうなって、スタートがこう並んだら」を、過去レースで数える。上から順に選ぶと、下の結果が変わる</p>
  <div class="row"><span class="lbl">数えるレース</span><div class="seg" id="scnScope">${SCN_SCOPE.map(([k, l]) => `<button type="button" data-v="${k}" aria-pressed="${S.scope === k}">${l}</button>`).join("")}</div></div>
  <h3><span class="stepn">1</span>進入はどうなる？</h3>
  <div class="ents">${entryRow("all")}${entryRow("waku")}${entryRow("mae")}${openMae ? MAE_SUB.map((e) => entryRow(e, true)).join("") : ""}${entryRow("inlost")}</div>
  <p class="foot">${post ? `今日の展示は、6艇とも枠なりだった。展示が枠なりだったレースの93%は、本番も枠なりだった（全国、2026/4以降の2,023レース）。` : "展示の後は、今日の展示の進入に当てはまる型に印が付く。"}割合は、${allOf(scopeName)}の中での割合。スロー・ダッシュの別は記録が無いので分けていない</p>
  ${hintHtml()}
  <h3><span class="stepn">2</span>スタートはどう並ぶ？（スリットの形）</h3>
  <div class="pats">${chips}</div><p class="foot">カド＝ダッシュ勢（助走を長くとる艇）の一番内。7つの形は、枠なりのときのカド（4コース）を基準に決めている。カド受け＝その1つ内（枠なりなら3コース）。絵は横から見た並びの例（数字はコース、右の線がスリット。縮尺は1艇身≒0.13秒）</p>
  <p class="foot">${def ? `${SLITN[S.slit]}: ${def}。` : ""}1つのレースが2つ以上の形に当てはまることがある（足すと100%を超える）。割合は、選んだ進入の中での割合。スリットの形は、今日の展示からは選べない。展示で2コース凹みだったとき、本番も2コース凹みになったのは38%。展示が別の形でも27%は本番で2コース凹みになった。展示の形は少し参考になる程度（2026/4以降の2,280レース）。${post ? "参考: 今日の展示の形は2コース凹み・イン凹み（3号艇は展示でフライング）" : "展示の後に、今日の展示のスリットの形を参考に出す"}</p>
  <div class="mark">${markHtml()}</div>
  <h3><span class="stepn">4</span>②の形のとき、どう決まった？<small class="muted">（③の順位では分けていない）</small></h3>
  ${res}
  <p class="foot">数えた割合で、原因とは限らない。スリットの形はレース後に分かるもので、「もしこうなったら」の参考。返還（F・L・欠場）があったレース${EXCL[S.scope].toLocaleString()}件を除くので、「来る艇の条件」の件数とは合わない</p>`;
  wireHint();
  $("scnScope")
    .querySelectorAll("button")
    .forEach(
      (b) =>
        (b.onclick = () => (
          (S.scope = b.dataset.v),
          (S.ff = S.fs = null),
          renderScn()
        )),
    );
  $("scnOut")
    .querySelectorAll(".ent")
    .forEach(
      (b) =>
        (b.onclick = () => (
          (S.entry = b.dataset.e), (S.slit = "any"),
          (S.ff = S.fs = null),
          renderScn()
        )),
    );
  $("scnOut")
    .querySelectorAll(".pat")
    .forEach(
      (b) =>
        (b.onclick = () => (
          (S.slit = b.dataset.s),
          (S.ff = S.fs = null),
          renderScn()
        )),
    );
  if (c.n >= MIN_N && c.tri)
    renderFlowX(
      c,
      { svg: "scnSankey", note: "scnNote", tip: "scnTip", tri: "scnTri" },
      S,
    );
}
