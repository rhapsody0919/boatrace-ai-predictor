/**
 * 全貌動画 場面2「6艇の重ね図」の材料（試作）。/api/analogy/facts の応答から、動画が描く値と答えの文を決まった手順で作る。
 *
 * 画面（ソナー「差がつく材料」ConditionFactsTab・FactRadar・FactCard）と同じ純粋関数を使い、画面と動画で数字がずれないようにする。
 * LLM は使わない。同じ入力なら同じ出力（日時・乱数を使わない）。欠けた値はその要素を描かず omitted に記録し、全体は止めない。
 * 型の正本: ~/hq/drafts/full-picture-scene-contract.md の「全場面共通」「場面2」。
 */
import { fitFirst } from "./fit.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  FACT_ITEMS,
  boatScopeKey,
  factRows,
  hidesSeriesScoreLine,
  judgeLabelKey,
  judgeLabelParams,
  radarBoats,
  rateOf,
  seriesScoreNote,
  todayLine,
  todayValueRank,
  todayValues,
  usualOf,
} from "../../../../src/utils/analogyFacts.js";
import {
  factRankText,
  fmtCount,
  fmtFactValue,
  fmtPct,
  scopeName,
} from "../../../../src/utils/analogyFormat.js";

export const SCENE2_VERSION = "scene2-proto-0";
const BOATS = [1, 2, 3, 4, 5, 6];
/** カードの主役（型: 「1号艇の勝敗を分ける材料」） */
const CARD_BOAT = 1;
/** 着順（1着） */
const TARGET = 1;
const ROUND_NAME = { yusho: "優勝戦の日", junyu: "準優勝戦の日" };

const LOCALE = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../../../src/locales/ja/common.json", import.meta.url),
    ),
    "utf8",
  ),
);

/** i18next の t の最小版（ja の文言を {{x}} で埋める）。キーが無ければ既定値、既定値も無ければ例外 */
export function t(key, params = {}) {
  const fallback = typeof params === "string" ? params : params.defaultValue;
  const vars = typeof params === "object" ? params : {};
  const v = key.split(".").reduce((o, p) => o?.[p], LOCALE);
  if (typeof v !== "string") {
    if (fallback !== undefined) return fallback;
    throw new Error(`文言のキーが見つからない: ${key}`);
  }
  return v.replace(/\{\{(\w+)\}\}/g, (_, name) =>
    vars[name] === undefined ? `{{${name}}}` : String(vars[name]),
  );
}

const fk = "aiPredictionTab.analogy.facts";
const itemShort = (key) => t(`${fk}.items.${key}.short`);
/** 文の中の材料名。平均ST は期間を付ける（BOA-815。図の軸は画面と同じ短い名前） */
const itemSentence = (key) => (key === "st_mean30" ? t(`${fk}.items.${key}.label`) : itemShort(key));
const unitOf = (key) => t(`${fk}.units.${key}`, "");
const withUnit = (key, v) => {
  const s = fmtFactValue(key, v);
  return s === "—" || s.endsWith("%") ? s : `${s}${unitOf(key)}`;
};
const rankShort = (r) =>
  !r
    ? "—"
    : r.from === r.to
      ? t(`${fk}.stripRank`, { rank: r.from })
      : t(`${fk}.stripRankTie`, { from: r.from, to: r.to });

/** 応答の包み（{ data }）を外す */
const unwrap = (json) => (json && json.data && json.data.today ? json.data : json);

/**
 * 重ね図の1艇の比べた結果（facts）。1位の項目があればそれを、無ければ一番上の項目を選び、
 * 1位なら次点の艇、1位でなければ1位の艇と値を比べる。文はここでは作らない（templateLines・polish が作る）
 */
function focusFacts(b, radar, axes, values) {
  const me = radar[b - 1];
  const ranked = me.cells.map((c, i) => ({ i, r: c.rank })).filter((x) => x.r);
  if (ranked.length === 0) return { frameAxis: null, facts: { kind: "focus", boat: b, item: null } };
  const best = ranked.reduce((a, x) => (x.r.from < a.r.from ? x : a));
  const ax = axes[best.i];
  const v = values[ax.key];
  const val = withUnit(ax.key, v[b - 1]);
  const other = (o) => {
    const s = withUnit(ax.key, v[o - 1]);
    return { boat: o, value: s, sameDisplay: s === val };
  };
  const isFirst = best.r.from === 1;
  let compare;
  if (isFirst) {
    // 次点（自分より下で一番上の艇）
    const next = BOATS.filter((o) => o !== b && radar[o - 1].cells[best.i].rank)
      .map((o) => ({ o, r: radar[o - 1].cells[best.i].rank }))
      .filter((x) => x.r.from > best.r.to)
      .sort((a, c) => a.r.from - c.r.from || a.o - c.o)[0];
    compare = next ? { role: "2番手", boats: [other(next.o)] } : null;
  } else {
    compare = { role: "1位", boats: BOATS.filter((o) => radar[o - 1].cells[best.i].rank?.from === 1).map(other) };
  }
  return {
    frameAxis: best.i,
    facts: {
      kind: "focus",
      boat: b,
      item: itemSentence(ax.key),
      value: val,
      rank: rankShort(best.r),
      tie: best.r.from !== best.r.to,
      otherFirstItems: isFirst ? ranked.filter((x) => x.r.from === 1 && x.i !== best.i).map((x) => itemSentence(axes[x.i].key)) : [],
      otherFirstCount: isFirst ? ranked.filter((x) => x.r.from === 1 && x.i !== best.i).length : 0,
      compare,
      top2Count: me.top2,
      axesCount: axes.length,
    },
  };
}

/**
 * 文型の版（facts だけから決まった文型で作る。必ず出せる下限）。1行は全角22字分以内（scene2-text.mjs の MAX_WIDTH）。
 * 「項目＋値＋順位」を1文にまとめ、2行目で比べる相手を出す
 */
export function templateLines(f) {
  if (f.kind === "overview")
    return [
      `2位以内の項目が最多は${f.leaders.join("・")}号艇`,
      f.runner
        ? `${f.axesCount}項目中${f.maxTop2}、次は${f.runner.boats.join("・")}号艇の${f.runner.count}`
        : `6艇とも${f.axesCount}項目中${f.maxTop2}`,
    ];
  if (f.kind === "focus") {
    if (!f.item) return [`${f.boat}号艇は比べられる値が無い`];
    const cmp = (c) => `${c.boat}号艇の${c.sameDisplay ? "同じ" : ""}${c.value}`;
    const l1 = `${f.boat}号艇は${f.item}${f.value}で${f.rank}`;
    const l2 =
      f.compare?.role === "2番手"
        ? `2番手は${cmp(f.compare.boats[0])}${f.otherFirstCount ? `、ほか${f.otherFirstCount}項目も1位` : ""}`
        : f.compare?.role === "1位"
          ? `1位は${f.compare.boats.map(cmp).join("・")}`
          : null;
    // 1行目が入らない（平均ST（直近30走）の値など）ときは、値を2行目の頭へ移す
    // 1位が並ぶ（同じ値）なら艇番をまとめて書く
    const tie = f.compare?.role === "1位" && f.compare.boats.length > 1 && new Set(f.compare.boats.map((c) => c.value)).size === 1;
    const l2tie = tie ? `1位は${f.compare.boats.map((c) => c.boat).join("・")}号艇の${f.compare.boats[0].value}` : null;
    return fitFirst([l1, l2], [`${f.boat}号艇は${f.item}で${f.rank}`, l2 ? `${f.value}、${l2}` : f.value], ...(tie ? [[l1, l2tie], [`${f.boat}号艇は${f.item}で${f.rank}`, `${f.value}、${l2tie}`]] : []));
  }
  if (f.kind === "card") {
    if (f.todayRank !== null)
      return [
        `${f.item}${f.todayRank}位の1着率${f.todayRate}%`,
        f.usualDiffPt === null
          ? `1位${f.rate1}%・6位${f.rate6}%`
          : f.usualDiffPt < 1
            ? `全体の${f.usual}%との差は1ポイント未満`
            : `全体の${f.usual}%より${f.usualDiffPt}ポイント${f.direction}`,
      ];
    const l1 = `${f.item} 1位${f.rate1}%・6位${f.rate6}%`;
    if (f.roundDay)
      return [l1, f.todayRankRef ? `${f.boat}号艇は${f.todayRankRef}位、${f.roundDay}は枠順に近く参考` : `${f.roundDay}は点の順が枠順に近く参考`];
    return [l1, "今日の値が無く、今日の順位では比べられない"];
  }
  if (f.kind === "empty") return [`${f.boat}号艇は差が大きい材料が無い`, `${f.rowsCount}項目とも差が小さいか重なる`];
  throw new Error(`文型の無い種類: ${f.kind}`);
}

/** カード（差が大きい）1枚分 */
function cardOf(row, today, scopeFacts, values, omitted) {
  const item = FACT_ITEMS.find((x) => x.key === row.key);
  const finalDay = row.key === "series_score" && hidesSeriesScoreLine(today);
  const note = row.key === "series_score" ? seriesScoreNote(today) : null;
  const r = values ? todayValueRank(values, item.hib, CARD_BOAT) : null;
  const ok = (values ?? []).filter((x) => typeof x === "number" && Number.isFinite(x));
  const rates = row.rates;
  const line = finalDay ? null : todayLine(row, values, CARD_BOAT, scopeFacts, TARGET);
  if (!line && !finalDay)
    omitted.push({ where: "card.todayBar", item: row.key, boat: CARD_BOAT, reason: "今日の値または件数が無い" });
  const usual = rateOf(usualOf(scopeFacts, CARD_BOAT, TARGET));
  const pct = (p) => Math.round(p * 100);
  const usualPct = usual === null ? null : Math.round(usual * 1000) / 10;
  const d = line && usualPct !== null ? pct(line.rate) - usualPct : null;
  const facts = {
    kind: "card",
    boat: CARD_BOAT,
    item: itemSentence(row.key),
    todayRank: line ? line.bucket : null,
    todayRate: line ? pct(line.rate) : null,
    rate1: pct(rates[0]),
    rate6: pct(rates[5]),
    compareRanks: [1, 6],
    spreadPt: Math.abs(pct(rates[0]) - pct(rates[5])),
    usual: usualPct,
    usualDiffPt: d === null ? null : Math.round(Math.abs(d) * 10) / 10,
    direction: d === null ? null : d > 0 ? "高い" : "低い",
    roundDay: finalDay ? (ROUND_NAME[today.round] ?? null) : null,
    // 優勝戦・準優勝戦の日の今節の着順点: 画面は今日の順位を出すが、棒の今日の位置は出さない（点の順がほぼ枠の順のため参考）
    todayRankRef: finalDay && r && r.from === r.to ? r.from : null,
    // 本文で割合に添える件数
    todayN: line ? line.hit[1] : null,
    usualN: usualOf(scopeFacts, CARD_BOAT, TARGET)?.[1] ?? null,
  };
  return {
    key: row.key,
    label: row.label,
    judge: t(`${fk}.judge.${judgeLabelKey(row.judge, row.all[0], row.all[5])}`, judgeLabelParams(row)),
    todayLine: r
      ? t(`${fk}.todayValue`, { boat: CARD_BOAT, value: withUnit(row.key, r.value), rank: factRankText(t, r, item.bad) })
      : t(`${fk}.todayValue`, { boat: CARD_BOAT, value: "—", rank: t(`${fk}.noToday${row.key === "loc_win" ? "Local" : ""}`) }),
    rangeLine: ok.length
      ? t(`${fk}.todayRangeOf6`, { range: `${fmtFactValue(row.key, Math.min(...ok))}〜${withUnit(row.key, Math.max(...ok))}` })
      : null,
    best: { word: t(`${fk}.best`, { word: t(`${fk}.words.${item.good}`) }), pct: fmtPct(rates[0]), count: row.all[0] ? `${fmtCount(row.all[0][0])}/${fmtCount(row.all[0][1])}件` : "—" },
    worst: { word: t(`${fk}.best`, { word: t(`${fk}.words.${item.bad}`) }), pct: fmtPct(rates[5]), count: row.all[5] ? `${fmtCount(row.all[5][0])}/${fmtCount(row.all[5][1])}件` : "—" },
    bars: rates.map((p, i) => ({
      rank: i + 1,
      label:
        i === 0
          ? t(`${fk}.stripTop`, { word: t(`${fk}.words.${item.good}`) })
          : i === 5
            ? t(`${fk}.stripBottom`, { word: t(`${fk}.words.${item.bad}`) })
            : t(`${fk}.stripRank`, { rank: i + 1 }),
      pct: p,
    })),
    usual,
    todayBar: line ? line.bucket - 1 : null,
    todayHit: line
      ? t(`${fk}.todayHit`, { rank: line.bucket, rate: fmtPct(line.rate), hits: fmtCount(line.hit[0]), n: fmtCount(line.hit[1]), lo: Math.round(line.lo * 100), hi: Math.round(line.hi * 100) })
      : null,
    note: note === "final" ? t(`${fk}.noteFinal`) : note === "early" ? t(`${fk}.noteEarly`) : null,
    id: `card-${row.key}`,
    facts,
    answer: templateLines(facts),
  };
}

/**
 * facts の応答 → 場面2の材料
 * @param {unknown} factsJson /api/analogy/facts の応答（{ data } で包まれていてもよい）
 */
export function buildScene2(factsJson) {
  const data = unwrap(factsJson);
  if (!data?.today) throw new Error("facts の応答に today が無い（場面2を作れない）");
  const { today, facts = {}, exhibition = null } = data;
  const omitted = [];
  const exhibitionStage = Boolean(exhibition?.exh_time);
  const values = todayValues(today, exhibition);
  const finalDay = hidesSeriesScoreLine(today);
  const firstDay = seriesScoreNote(today) === "first";

  // 軸: 画面と同じ（ボート2連率は入れない。優勝戦・準優勝戦・初日は今節の着順点を入れない）。6艇とも値が無い項目は外して記録
  const axesItems = FACT_ITEMS.filter(
    (it) =>
      it.key !== "boat_2" &&
      (exhibitionStage || it.key !== "exh_time") &&
      !((finalDay || firstDay) && it.key === "series_score"),
  ).filter((it) => {
    const v = values[it.key];
    const has = Array.isArray(v) && v.some((x) => typeof x === "number" && Number.isFinite(x));
    if (!has) omitted.push({ where: "radar.axis", item: it.key, reason: "6艇とも今日の値が無い" });
    return has;
  });
  const axes = axesItems.map((it) => ({ key: it.key, hib: it.hib, label: itemShort(it.key) }));
  const radar = radarBoats(today, facts, values, axesItems, TARGET, null);
  for (const b of radar)
    b.cells.forEach((c, i) => {
      if (!c.bucket) omitted.push({ where: "radar.vertex", item: axes[i].key, boat: b.boat, reason: "今日の値が無い（その頂点を飛ばして結ぶ）" });
    });
  const maxTop2 = Math.max(...radar.map((b) => b.top2));
  const leaders = BOATS.filter((b) => radar[b - 1].top2 === maxTop2);
  const runner = [...new Set(radar.map((b) => b.top2))].sort((a, c) => c - a)[1];
  const overviewFacts = {
    kind: "overview",
    leaders,
    maxTop2,
    axesCount: axes.length,
    withinRank: 2,
    runner: runner === undefined ? null : { boats: BOATS.filter((b) => radar[b - 1].top2 === runner), count: runner },
  };

  // カード: 1号艇・1着・既定の集めたレース。差がはっきりしている順で「差が大きい」だけ
  const countOf = (key) => facts?.[key]?.n ?? null;
  const { key: scopeKey } = boatScopeKey(today.scope_keys?.[String(CARD_BOAT)] ?? {}, countOf, null);
  const scopeFacts = facts[scopeKey] ?? null;
  if (!scopeFacts) omitted.push({ where: "cards", boat: CARD_BOAT, reason: `集めたレース ${scopeKey} の集計が無い` });
  const rows = scopeFacts
    ? factRows(scopeFacts, CARD_BOAT, TARGET, exhibitionStage)
        .filter((r) => r.key !== "boat_2" && !(firstDay && r.key === "series_score"))
        .map((r) => ({ ...r, label: t(`${fk}.items.${r.key}.label`) }))
    : [];
  const large = rows.filter((r) => r.judge.level === "large");
  const usual = rateOf(usualOf(scopeFacts, CARD_BOAT, TARGET));

  return {
    version: SCENE2_VERSION,
    race: { raceId: today.race_id, venueCode: today.venue_code, round: today.round, stage: exhibitionStage ? "exhibition" : "racecard" },
    radar: {
      axes,
      boats: radar.map((b) => ({
        boat: b.boat,
        cls: b.cls,
        buckets: b.cells.map((c) => c.bucket),
        ranks: b.cells.map((c) => (c.rank ? rankShort(c.rank) : null)),
        rankFrom: b.cells.map((c) => c.rank?.from ?? null),
        typical: b.typical,
        top2: b.top2,
      })),
      overview: { id: "overview", frameBoats: leaders, facts: overviewFacts, lines: templateLines(overviewFacts) },
      focus: BOATS.map((b) => {
        const { frameAxis, facts: f } = focusFacts(b, radar, axes, values);
        return { id: `focus-${b}`, boat: b, frameAxis, facts: f, lines: templateLines(f) };
      }),
    },
    cards: {
      boat: CARD_BOAT,
      scope: scopeName(scopeKey, t, { short: true }),
      usual: usual === null ? null : fmtPct(usual, 1),
      items: large.map((r) => cardOf(r, today, scopeFacts, values[r.key] ?? null, omitted)),
      empty:
        large.length === 0
          ? (() => {
              const f = { kind: "empty", boat: CARD_BOAT, rowsCount: rows.length };
              return { id: "empty", facts: f, lines: templateLines(f) };
            })()
          : null,
    },
    omitted,
  };
}
