/**
 * verify-thinking-assist-model.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-thinking-assist-model.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { assistEventOf } from "../../../src/utils/assistEvents.js";
import {
  parseAssistSession,
  serializeAssistSession,
  ASSIST_SESSION_PREFIX,
} from "../../../src/utils/assistSession.js";
import { boardModel } from "../../../src/utils/assistModel.js";
import { racers } from "./thinking-assist-model-scenes-1.js";

let check;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const st = { lens: "axis", deep: null, metric: null, target: 1 };
  check(
    "イベント: 着順の切り替えは assist_target（押したレンズも）。選択中の着順の押し直しは送らない",
    JSON.stringify(assistEventOf(st, { type: "target", target: 2 })) ===
      JSON.stringify({
        name: "assist_target",
        params: {
          assist_target: 2,
          assist_lens: "axis",
          assist_bet_type: "trifecta",
        },
      }) &&
      assistEventOf(st, { type: "target", target: 1 }) === null &&
      assistEventOf(
        { ...st, target: 3, lens: "bet" },
        { type: "target", target: 3 },
      ) === null,
  );
  const tri = { "1-2-3": 6.4, "2-1-3": 37.5 };
  const pastWin = new Map([[1, { k: 83, n: 119 }]]);
  const row = (target) =>
    boardModel({
      lens: "bet",
      stage: "post",
      racers,
      trifecta: tri,
      pastWin,
      target,
    }).rows[0].nums;
  const r1 = row(1);
  const r2 = row(2);
  check(
    "買い目: 2着以内を選ぶと「人気（1着）」を薄く、「過去の2着以内 70%（83/119）」。1着では「1着人気」「過去の1着」",
    r2[0].label === "3連単から見た1着人気" &&
      r2[0].muted === true &&
      r2[1].label === "過去の2着以内" &&
      r2[1].text === "70%（83/119）" &&
      r1[0].label === "3連単から見た1着人気" &&
      r1[0].muted === false &&
      r1[1].label === "過去の1着",
    JSON.stringify({ r1, r2 }),
  );
  // 締切後は公式の単勝の締切時オッズ（2026-10-28 オーナー決定）。票0（0）と欠場の艇は値を出さない
  const winRows = boardModel({
    lens: "bet",
    stage: "post",
    racers: racers.map((r) => (r.boat === 6 ? { ...r, absent: true } : r)),
    trifecta: tri,
    finalWin: { 1: 2.5, 2: 1.8, 3: 0, 4: 12.0, 5: 30.1, 6: 5.0 },
    target: 1,
  });
  const winNum = (b) => winRows.rows.find((r) => r.boat === b).nums[0];
  check(
    "買い目: 締切後は図の1着人気を公式の単勝で出す（2号艇 1番 1.8倍、1号艇 2番）。票0の3号艇・欠場の6号艇は値なし。見出しも単勝",
    winRows.title === "1着のオッズ（公式の単勝の締切時オッズ）" &&
      winNum(2).label === "1着人気（公式の単勝）" &&
      winNum(2).text === "1番（1.8倍）" &&
      winNum(1).text === "2番（2.5倍）" &&
      winRows.rows
        .find((r) => r.boat === 3)
        .nums.every((n) => !/倍/.test(n.text ?? "")) &&
      winRows.rows
        .find((r) => r.boat === 6)
        .nums.every((n) => !/倍/.test(n.text ?? "")),
    JSON.stringify(winRows.rows.map((r) => r.nums)),
  );
  const tri0 = boardModel({
    lens: "bet",
    stage: "post",
    racers,
    trifecta: tri,
    finalWin: null,
    target: 1,
  });
  return { pastWin, tri0 };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ pastWin, tri0 }) {
  check(
    "買い目: 締切前（単勝の締切時オッズが無い）は3連単から見た1着人気のまま",
    tri0.title === "1着になる組のオッズ（3連単の合成。公式の単勝人気とは別）" &&
      tri0.rows[0].nums[0].label === "3連単から見た1着人気",
  );
  const noOdds = boardModel({
    lens: "bet",
    stage: "post",
    racers,
    trifecta: null,
    pastWin,
    target: 3,
  }).rows[0].nums;
  check(
    "買い目: オッズが無いときも過去の{着順}と件数を出す",
    noOdds.length === 1 &&
      noOdds[0].label === "過去の3着以内" &&
      noOdds[0].text === "70%（83/119）",
    JSON.stringify(noOdds),
  );
}

function scene3() {
  // GA4 のイベント（docs/design/thinking-assist/events.md）。状態が変わらない押し直しは送らない
  {
    const st = { lens: "axis", deep: null, metric: null };
    const ev = (state, action) => assistEventOf(state, action);
    const RESERVED = ["source", "medium", "campaign", "term", "content", "id"];
    const all = [
      ev(st, { type: "lens", lens: "flow" }),
      ev(st, { type: "deep", boat: 3 }),
      ev(st, { type: "metric", metric: "st_course", boat: 1 }),
      ev(st, { type: "guide", step: 0, lens: "axis" }),
      ev(st, { type: "sheet", sheet: "mark" }),
      ev(st, { type: "sheet", sheet: { type: "theory", id: "TC-T1", boat: 1 } }),
    ];
    check(
      "イベント: レンズ・深掘り・6艇比較・ガイド・シートの名前とパラメータ",
      JSON.stringify(all) ===
        JSON.stringify([
          { name: "assist_lens_select", params: { assist_lens: "flow" } },
          {
            name: "assist_deep_open",
            params: { assist_boat: 3, assist_lens: "axis" },
          },
          {
            name: "assist_metric_compare",
            params: { assist_metric: "st_course", assist_lens: "axis" },
          },
          { name: "assist_guide_step", params: { assist_guide_step: 1 } },
          {
            name: "assist_sheet_open",
            params: { assist_sheet: "mark", assist_bet_type: "trifecta" },
          },
          {
            name: "assist_sheet_open",
            params: { assist_sheet: "theory", assist_bet_type: "trifecta" },
          },
        ]),
      JSON.stringify(all),
    );
    check(
      "イベント: 押し直し（同じレンズ・開いている艇・比較中の項目）、ガイド・シートを閉じる、その他の操作は送らない",
      [
        ev(st, { type: "lens", lens: "axis" }),
        ev({ ...st, deep: 3 }, { type: "deep", boat: 3 }),
        ev(
          { ...st, metric: "st_course" },
          { type: "metric", metric: "st_course" },
        ),
        ev(st, { type: "guide", step: null, lens: null }),
        ev(st, { type: "sheet", sheet: null }),
        ev(st, { type: "toggleBet", pos: 1, boat: 1 }),
        ev(st, { type: "closeDeep" }),
      ].every((e) => e === null),
    );
    check(
      "イベント: 軸の要約の入口1行（openFacts）から開いたときも assist_deep_open。開いている艇では送らない",
      JSON.stringify(ev(st, { type: "openFacts", boat: 1, all: false })) ===
        JSON.stringify({
          name: "assist_deep_open",
          params: { assist_boat: 1, assist_lens: "axis" },
        }) &&
        ev({ ...st, deep: 1 }, { type: "openFacts", boat: 1, all: true }) ===
          null,
    );
    check(
      "イベント: パラメータ名に GA4 の予約語を使わない",
      all.every((e) => Object.keys(e.params).every((k) => !RESERVED.includes(k))),
    );
  }
  // ---- 相手レンズの軸の艇（BOA-845、spec D-48）----
  {
    const st = { lens: "place", deep: null, metric: null, placeAxis: null };
    check(
      "イベント: 軸の艇の選び替えは assist_place_axis（assist_boat を流用）。選んでいる艇の押し直しは送らない",
      JSON.stringify(assistEventOf(st, { type: "placeAxis", boat: 4 })) ===
        JSON.stringify({
          name: "assist_place_axis",
          params: { assist_boat: 4, assist_lens: "place" },
        }) &&
        assistEventOf({ ...st, placeAxis: 4 }, { type: "placeAxis", boat: 4 }) ===
          null,
    );
  }
}

function scene4() {
  // ---- 展開レンズの形の選択（spec D-47、承認モック v2 ④）----
  {
    const st = { lens: "flow", deep: null, metric: null, flowForm: "kado" };
    check(
      "イベント: 形の選び替えは assist_flow_form。選んでいる形の押し直しは送らない",
      JSON.stringify(assistEventOf(st, { type: "flowForm", form: "d2" })) ===
        JSON.stringify({
          name: "assist_flow_form",
          params: { assist_form: "d2" },
        }) && assistEventOf(st, { type: "flowForm", form: "kado" }) === null,
    );
  }
  {
    const s1 = scene1();
    scene2(s1);
  }
}

function scene5() {
  // ---- 買い目を同じタブの中に残す（2026-10-11 ユーザーの不具合報告）----
  {
    const st = {
      bets: { 1: new Set([1]), 2: new Set([2, 3]), 3: new Set([2, 3, 4]) },
      betType: "exacta",
      budget: "2000",
      mode: "equal",
      target: 3,
      lens: "bet",
      placeAxis: 4,
      deep: 2,
      sheet: "mark",
    };
    const back = parseAssistSession(serializeAssistSession(st));
    check(
      "保存: 券種を戻し、知らない券種・券種の無い古い保存は券種を返さない（既定の3連単。BOA-990）",
      back.betType === "exacta" &&
        !(
          "betType" in
          parseAssistSession('{"bets":{"1":[],"2":[],"3":[]},"betType":"win"}')
        ) &&
        !("betType" in parseAssistSession('{"bets":{"1":[],"2":[],"3":[]}}')),
      JSON.stringify(back),
    );
    check(
      "保存: 買い目・予算・配分の方式・着順・レンズ・相手レンズの軸の艇（BOA-845）を戻し、深掘り・シートは残さない",
      JSON.stringify([...back.bets[1]]) === "[1]" &&
        JSON.stringify([...back.bets[3]]) === "[2,3,4]" &&
        back.budget === "2000" &&
        back.mode === "equal" &&
        back.target === 3 &&
        back.lens === "bet" &&
        back.placeAxis === 4 &&
        !("deep" in back) &&
        !("sheet" in back),
      JSON.stringify(back),
    );
    check(
      "保存: 壊れた値・形の違う値は捨てる（ページを落とさない）",
      parseAssistSession("{") === null &&
        parseAssistSession(null) === null &&
        parseAssistSession('{"x":1}') === null &&
        (() => {
          const v = parseAssistSession(
            '{"bets":{"1":[1,9,"2",1],"2":[],"3":[]},"budget":"abc","mode":"kelly","target":5,"lens":"zzz","placeAxis":7}',
          );
          return (
            JSON.stringify([...v.bets[1]]) === "[1]" &&
            !("budget" in v) &&
            !("mode" in v) &&
            !("target" in v) &&
            !("lens" in v) &&
            !("placeAxis" in v)
          );
        })(),
    );
    check(
      "保存: キーは boatai-user: 接頭辞（キャッシュの全削除 boatai:* で消えない）",
      ASSIST_SESSION_PREFIX === "boatai-user:assist:" &&
        !ASSIST_SESSION_PREFIX.startsWith("boatai:"),
    );
  }
}

function scene6() {
  // ---- 相手レンズ（spec D-46、2026-10-12 ユーザー承認 v4）----
  {
    const placeRates = new Map([
      [1, { t2: { k: 83, n: 119 }, t3: { k: 94, n: 119 } }],
      [3, { t2: { k: 252, n: 641 }, t3: { k: 417, n: 641 } }],
      [5, { t2: { k: 5, n: 12 }, t3: { k: 8, n: 12 } }],
    ]);
    const m = boardModel({ lens: "place", stage: "post", racers, placeRates });
    const r1 = m.rows[0];
    const r3 = m.rows[2];
    const r5 = m.rows[4];
    check(
      "相手レンズ: 横軸は割合 0〜100%、●2着以内（x）と○3着以内（x2）、数字は1艇2個（2着以内・3着以内）、金枠なし",
      m.kind === "place" &&
        m.lo === 0 &&
        m.hi === 1 &&
        Math.abs(r1.x - 83 / 119) < 1e-9 &&
        Math.abs(r1.x2 - 94 / 119) < 1e-9 &&
        r1.nums.length === 2 &&
        r1.nums[0].label === "2着以内" &&
        r1.nums[0].text === "70%" &&
        r1.nums[1].text === "79%" &&
        r3.nums[1].text === "65%" &&
        m.rows.every((r) => r.nums.every((n) => !n.best)),
      JSON.stringify([r1, r3]),
    );
    check(
      "相手レンズ: 30件未満の艇は点を置かず、割合でなく件数だけ（件数の分布の検証で出るのは0.2%）",
      r5.x == null &&
        r5.x2 == null &&
        r5.nums[0].text === "12件（少ない）" &&
        m.rows[1].nums.length === 0,
      JSON.stringify(r5),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runThinkingAssistModelScenes3(env) {
  ({ check } = env);
  scene3();
  scene4();
  scene5();
  scene6();
}
