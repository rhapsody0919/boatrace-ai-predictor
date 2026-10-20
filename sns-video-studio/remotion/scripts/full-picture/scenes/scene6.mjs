/**
 * 場面6「機力と調子」の材料（型: 契約「場面6 機力と調子」）。
 * ① /race/{raceId}?tab=motor のモーターの表: 場面4の展開の鍵の艇の行を囲う（例: カド一撃なら4号艇と1号艇）。機力指数は使わない
 * ② 今節展示情報の前走・平均: 金枠（6艇で一番速い）の艇を囲う（bestOf と同じ: 小数2桁で一番小さい値、同じ値はすべて）
 * ③ 思考アシストの深掘り（2〜6号艇すべて同じ形）: 「差がつく材料」の先頭カード＋札（最近よく勝つ 等）を囲う
 * 画面との違い: モーターの表は、出走表の公式2連率・前検・会場のモーター成績（1着率・優出数）の列に絞った（期間の再計算の2連率・3連率は出さない）
 */
import { factChips, factsScope, featChips, b1Usual } from "../../../../../src/utils/assistSummary.js";
import { ASSIST_COPY as C } from "../../../../../src/data/thinkingAssistCopy.js";
import { deepBox, tableRowBox } from "../../../src/fullPicture/pageLayout.js";
import { keyBoatsOf } from "./scene4.mjs";
import { BOATS, venueName } from "./common.mjs";
import { fitFirst } from "../fit.mjs";

const Q = "機力と調子は？";
const latestBy = (rows, key, dateKey) => {
  const m = new Map();
  for (const r of rows ?? []) {
    const cur = m.get(r[key]);
    if (!cur || r[dateKey] > cur[dateKey]) m.set(r[key], r);
  }
  return m;
};
const f2 = (v) => (v === null || v === undefined ? "—" : Number(v).toFixed(2));

/** @param {object} m 材料 JSON */
export function buildScene6(m) {
  const omitted = [];
  const steps = [];
  const race = (m.api.races ?? []).find((r) => r.raceId === m.raceId);
  const entries = BOATS.map((b) => race?.entries?.find((e) => e.number === b) ?? null);
  const { form, boats: keys } = keyBoatsOf(m);
  const db = m.db?.motor ?? null;
  const venue = venueName(m.venueCode);

  // ① モーターの表
  if (race && db) {
    const pre = latestBy(db.pretest, "motor_number", "race_date");
    const stats = latestBy(db.stats, "motor_number", "scraped_date");
    const rows = entries.map((e, i) => {
      const st = e ? stats.get(e.motorNumber) : null;
      const firstRate = st?.race_count ? (st.first_place_count / st.race_count) * 100 : null;
      return {
        boat: i + 1,
        motor: e?.motorNumber ?? null,
        rate2: e?.motor2Rate != null ? Number(e.motor2Rate) : null,
        pretest: e ? (pre.get(e.motorNumber)?.pretest_time ?? null) : null,
        first: firstRate,
        finals: st?.final_count ?? null,
      };
    });
    for (const r of rows) if (r.pretest === null) omitted.push({ where: "scene6.motor", boat: r.boat, reason: "前検タイムが無い" });
    const k0 = rows[keys[0] - 1];
    const k1 = keys[1] ? rows[keys[1] - 1] : null;
    // 2連率の無い艇には順位を付けない（null を 0 と比べない）
    const rank2 = (b) => (rows[b - 1].rate2 === null ? null : 1 + rows.filter((x) => x.rate2 !== null && x.rate2 > rows[b - 1].rate2).length);
    const ok = (r) => r && r.motor !== null && r.rate2 !== null;
    for (const r of [k0, k1].filter(Boolean)) if (!ok(r)) omitted.push({ where: "scene6.motor", boat: r.boat, reason: "機番か公式2連率が無い（答えから外した）" });
    const f = {
      kind: "motor",
      boats: keys,
      form: form ? C.factNames?.[form] ?? null : null,
      a: ok(k0) ? { boat: k0.boat, motor: k0.motor, rate2: k0.rate2.toFixed(1), rank: `${rank2(k0.boat)}位` } : null,
      b: ok(k1) ? { boat: k1.boat, motor: k1.motor, rate2: k1.rate2.toFixed(1), rank: `${rank2(k1.boat)}位` } : null,
    };
    steps.push({
      id: "s6-motor",
      question: Q,
      page: {
        kind: "table",
        title: "モーター",
        sub: `${venue}・公式2連率は節の時点`,
        cols: ["機番", "2連率", "前検", "1着率"],
        rows: rows.map((r) => ({
          boat: r.boat,
          cells: [r.motor ?? "—", r.rate2 === null ? "—" : `${r.rate2.toFixed(1)}%`, f2(r.pretest), r.first === null ? "—" : `${r.first.toFixed(1)}%`].map(String),
        })),
      },
      press: null,
      frames: keys.map((b) => tableRowBox(b - 1)),
      facts: f,
      lines: [
        f.a ? `${f.a.boat}号艇の${f.a.motor}号機は2連率${f.a.rate2}%で${f.a.rank}` : null,
        f.b ? `${f.b.boat}号艇の${f.b.motor}号機は${f.a ? "" : "2連率"}${f.b.rate2}%で${f.b.rank}` : null,
      ].filter(Boolean),
    });
  } else omitted.push({ where: "scene6.motor", reason: "モーターの材料が無い" });

  // ② 今節展示の前走・平均（金枠）
  if (race && db?.meetEntries?.length) {
    const ex = (b) => {
      const racer = entries[b - 1]?.racerId;
      const runs = db.meetEntries.filter((e) => e.racer_id === racer).sort((a, c) => a.race_id.localeCompare(c.race_id));
      const times = runs
        .map((e) => db.exhibition.find((x) => x.race_id === e.race_id && x.boat_number === e.boat_number)?.exhibition_time ?? null)
        .filter((v) => v !== null && v > 0);
      return { last: times.length ? times[times.length - 1] : null, avg: times.length ? times.reduce((a, c) => a + c, 0) / times.length : null, n: times.length };
    };
    const rows = BOATS.map(ex);
    const best = (k) => {
      const vals = rows.map((r) => (r[k] === null ? null : Math.round(r[k] * 100) / 100));
      const min = Math.min(...vals.filter((v) => v !== null));
      return BOATS.filter((b) => vals[b - 1] === min);
    };
    const gold = [...new Set([...best("last"), ...best("avg")])].sort((a, c) => a - c);
    const bl = best("last");
    if (!bl.length || !best("avg").length) {
      omitted.push({ where: "scene6.exhibit", reason: "今節の展示タイムの値が無い（取り込み前など）" });
    } else {
    const f = { kind: "exhibit", boats: gold, last: { boats: bl, time: f2(rows[bl[0] - 1].last) }, avg: { boats: best("avg"), time: f2(rows[best("avg")[0] - 1].avg) } };
    steps.push({
      id: "s6-exhibit",
      question: Q,
      page: {
        kind: "table",
        title: "今節の展示タイム",
        sub: `${db.meetStart}からこのレースの前まで`,
        cols: ["前走", "平均", "走"],
        rows: rows.map((r, i) => ({ boat: i + 1, cells: [f2(r.last), f2(r.avg), String(r.n)] })),
      },
      press: null,
      frames: gold.map((b) => tableRowBox(b - 1)),
      framesTogether: true,
      facts: f,
      lines: [`前走の展示が最速は${bl.join("・")}号艇の${f.last.time}`, `今節の平均の最速は${f.avg.boats.join("・")}号艇の${f.avg.time}`],
    });
    }
  } else omitted.push({ where: "scene6.exhibit", reason: "今節の展示タイムの材料が無い（節の初日など）" });

  // ③ 深掘り（2〜6号艇）
  const facts = m.api.facts;
  const today = facts?.today;
  const round = ["yusho", "junyu"].includes(today?.round) ? today.round : null;
  for (const b of [2, 3, 4, 5, 6]) {
    const scope = factsScope(facts?.facts, today, b, round);
    const chips = factChips({ scope, today, boat: b, post: false, finalRound: Boolean(round) });
    const top = chips.find((c) => c.hit) ?? null;
    const u = b1Usual(scope, b, 1);
    // 集計が無ければ比べる値を出さない（「全体0.0%」と書かない）
    const base = u?.n ? ((u.k / u.n) * 100).toFixed(1) : null;
    const feats = featChips({ boat: b, today, finalRound: Boolean(round) }).map((x) => (x.id === "locTop" ? C.feat.locTop(venue) : C.feat[x.id])).filter((x) => typeof x === "string");
    const word = top ? C.factWords[top.bucket === 6 ? top.bad : top.good] : null;
    const f = {
      kind: "deep",
      boat: b,
      item: top ? C.factNames[top.key] : null,
      word,
      rate: top ? String(Math.round(top.rate * 100)) : null,
      n: top ? top.pair[1] : null,
      base,
      feats,
    };
    steps.push({
      id: `s6-deep-${b}`,
      question: Q,
      page: {
        kind: "deep",
        title: C.factsHeading(b),
        sub: "▲＝今日6艇で一番上か一番下",
        card: top ? { name: C.factNames[top.key], text: C.factHit(word, f.rate, top.pair[1], base ?? "—", 1), level: C.factLevel[top.level] ?? null } : null,
        chips: feats,
      },
      press: null,
      frames: [deepBox(feats.length ? 1 : 0)],
      facts: f,
      lines: top
        ? (() => {
            // 2行目は過去のレースの集計（その艇がそう並んだレース）と分かるように（2026-10-20 オーナー）
            const l2 = fitFirst(
              [base === null ? `そう並んだ過去のレースで1着${f.rate}%` : `そう並んだ過去のレースで1着${f.rate}%（全体${base}%）`],
              [base === null ? `そのとき1着${f.rate}%` : `そのとき1着${f.rate}%、全体${base}%`],
            )[0];
            return fitFirst([`${b}号艇は${f.item}が6艇で一番${word}`, l2], [`${f.item}が6艇で一番${word}${b}号艇`, l2], [`${f.item}が一番${word}${b}号艇`, l2]);
          })()
        : [`${b}号艇は▲の付いた材料が無い`, feats.length ? `札は${feats.join("・")}` : "札も無い"],
    });
    if (!top) omitted.push({ where: "scene6.deep", boat: b, reason: "▲の付いた材料が無い（カードを出さず札だけ）" });
  }
  return { id: "scene6", steps, omitted };
}
