/**
 * verify-thinking-assist-model.js の後半の場面（4/4）。verify ではない。
 * 判定と期待値は分ける前の verify-thinking-assist-model.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { assistEventOf } from "../../../src/utils/assistEvents.js";
import { SCRAPE_JOBS } from "../../lib/scrapeJobs/registry.js";
import {
  missingFirstBoats,
  betForm,
  assistBetType,
  ticketLabel,
  ASSIST_BET_TYPES,
  oddsByBetType,
  wideLowTable,
  betTypeComposite,
  boxBets,
  nextOddsRefreshDelay,
  ODDS_SNAPSHOT_WINDOWS_MIN,
} from "../../../src/utils/assistModel.js";

let check;

/** 元の verify の1つの塊 { } を割った 1/3 */
function scene1() {
  const B = (a, b, c) => ({ 1: new Set(a), 2: new Set(b), 3: new Set(c) });
  check(
    "券種: 2連単の表記は1着・2着だけ（1-234）、3連単は今のまま（1-234-2345）。知らない券種は3連単",
    betForm(B([1], [2, 3, 4], [2, 3, 4, 5]), 2) === "1-234" &&
      betForm(B([1], [2, 3, 4], [2, 3, 4, 5])) === "1-234-2345" &&
      assistBetType("zzz").id === "trifecta" &&
      assistBetType("exacta").legs === 2,
  );
  // BOA-990 ②: 連複の表記は「=」、組の表記も「=」。タブの並びは 3連単｜3連複｜2連単｜2連複
  check(
    "券種: 3連複は 1=234=2345、2連複は 1=234。組の表記 1=2=3。並びは承認モックの順。",
    betForm(B([1], [2, 3, 4], [2, 3, 4, 5]), 3, false) === "1=234=2345" &&
      betForm(B([1], [2, 3, 4], [2, 3, 4, 5]), 2, false) === "1=234" &&
      ticketLabel("1-2-3", false) === "1=2=3" &&
      ticketLabel("1-2", true) === "1-2" &&
      JSON.stringify(ASSIST_BET_TYPES.map((t) => t.id)) ===
        JSON.stringify(["trifecta", "trio", "exacta", "quinella", "wide"]) &&
      assistBetType("wide").legs === 2 &&
      assistBetType("wide").ordered === false &&
      assistBetType("wide").range === true &&
      assistBetType("trio").ordered === false &&
      assistBetType("quinella").legs === 2,
  );
  const tq = oddsByBetType(
    [
      {
        capturedAt: "t1",
        trifectaAll: { "1-2-3": 5 },
        trioAll: { "1-2-3": 2.1 },
        quinellaAll: { "1-2": 1.4 },
      },
    ],
    { capturedAt: "f", trioAll: { "1-2-3": 2.3 } },
  );
  return { B, tq };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
function scene2({ B, tq }) {
  check(
    "オッズ: 3連複は締切時オッズ（trio_all）、2連複は締切時オッズが無いのでスナップショット（quinella_all）",
    tq.byType.trio.final === true &&
      tq.byType.trio.odds["1-2-3"] === 2.3 &&
      tq.byType.quinella.final === false &&
      tq.byType.quinella.odds["1-2"] === 1.4,
    JSON.stringify(tq),
  );
  // 拡連複（BOA-990 ③）: wide_all は {low, high}。計算は下限の表、表示は幅。下限の無い組・票0 は下限の表に入れない
  const tw = oddsByBetType(
    [
      {
        capturedAt: "t1",
        trifectaAll: { "1-2-3": 5 },
        wideAll: {
          "1-2": { low: 1.7, high: 2 },
          "1-3": { low: 0, high: 0 },
          "1-4": { low: null, high: null },
        },
      },
    ],
    { capturedAt: "f", wideAll: { "1-2": { low: 1.8, high: 2.4 } } },
  );
  check(
    "オッズ: 拡連複は締切時オッズ（wide_all）があればその幅、計算用の odds は下限（票0・下限なしは除く）",
    tw.byType.wide.final === true &&
      JSON.stringify(tw.byType.wide.odds) === JSON.stringify({ "1-2": 1.8 }) &&
      tw.byType.wide.range["1-2"].high === 2.4 &&
      JSON.stringify(
        wideLowTable({
          "1-2": { low: 1.7, high: 2 },
          "1-3": { low: 0, high: 0 },
          "1-4": null,
        }),
      ) === JSON.stringify({ "1-2": 1.7 }),
    JSON.stringify(tw),
  );
  check(
    "合成オッズ: 拡連複は出さない（null）、2連複は合成、オッズの表が無ければ null。拡連複の幅は下限のある組だけ",
    betTypeComposite(assistBetType("wide"), { "1-2": 2 }, ["1-2"]) === null &&
      betTypeComposite(assistBetType("quinella"), { "1-2": 2 }, ["1-2"]) ===
        2 &&
      betTypeComposite(assistBetType("trio"), null, ["1-2-3"]) === null &&
      JSON.stringify(
        Object.keys(
          oddsByBetType(
            [
              {
                capturedAt: "t",
                wideAll: {
                  "1-2": { low: 1.7, high: 2 },
                  "1-3": { low: 0, high: 0 },
                  "1-4": null,
                },
              },
            ],
            null,
          ).byType.wide.range,
        ),
      ) === JSON.stringify(["1-2"]),
  );
  const boxed = boxBets(B([1], [2, 3], [5]), 2);
  check(
    "ボックス: 2連単は1着・2着の段を選んだ艇（1・2・3）にそろえ、使わない3着の段は触らない",
    JSON.stringify([...boxed[1]].sort()) === "[1,2,3]" &&
      JSON.stringify([...boxed[2]].sort()) === "[1,2,3]" &&
      JSON.stringify([...boxed[3]]) === "[5]",
    JSON.stringify(boxed, (k, v) => (v instanceof Set ? [...v] : v)),
  );
  const boxed3 = boxBets(B([1], [2], [3, 4]), 3);
  check(
    "ボックス: 3連単は3段すべてを1・2・3・4にそろえる",
    [1, 2, 3].every(
      (k) => JSON.stringify([...boxed3[k]].sort()) === "[1,2,3,4]",
    ),
  );
  const snaps = [
    { capturedAt: "t1", trifectaAll: { "1-2-3": 5 }, exactaAll: { "1-2": 3 } },
    { capturedAt: "t2", trifectaAll: { "1-2-3": 6 }, exactaAll: null },
  ];
  return { snaps };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ snaps }) {
  const o = oddsByBetType(snaps, null);
  check(
    "オッズ: 券種ごとに値を持つ最新のスナップショット（2連単は t2 が空なので t1）",
    o.byType.trifecta.capturedAt === "t2" &&
      o.byType.exacta.capturedAt === "t1" &&
      o.byType.exacta.final === false &&
      o.trifecta["1-2-3"] === 6,
    JSON.stringify(o),
  );
  const of = oddsByBetType(snaps, {
    capturedAt: "f",
    trifectaAll: null,
    exactaAll: { "1-2": 2.9 },
  });
  check(
    "オッズ: 締切時オッズ（公式）のある券種はその値、無い券種はスナップショット",
    of.byType.exacta.final === true &&
      of.byType.exacta.odds["1-2"] === 2.9 &&
      of.byType.trifecta.final === false &&
      oddsByBetType([], null) === null,
    JSON.stringify(of),
  );
  const st = { lens: "bet", deep: null, metric: null, betType: "trifecta" };
  check(
    "イベント: 券種を替えたら assist_bet_type（場所つき）、選んでいる券種の押し直しは送らない。ボックスは assist_bet_box",
    JSON.stringify(
      assistEventOf(st, {
        type: "betType",
        betType: "exacta",
        from: "compare",
      }),
    ) ===
      JSON.stringify({
        name: "assist_bet_type",
        params: { assist_bet_type: "exacta", assist_bet_from: "compare" },
      }) &&
      assistEventOf(st, {
        type: "betType",
        betType: "trifecta",
        from: "tab",
      }) === null &&
      assistEventOf(
        { lens: "bet" },
        { type: "betType", betType: "trifecta" },
      ) === null &&
      JSON.stringify(
        assistEventOf({ ...st, betType: "exacta" }, { type: "box" }),
      ) ===
        JSON.stringify({
          name: "assist_bet_box",
          params: { assist_bet_type: "exacta" },
        }),
  );
  check(
    "イベント: マークシートを開いた・着順を替えたときも今の券種を送る（保存から戻った2連単も区別する）",
    JSON.stringify(
      assistEventOf(
        { ...st, betType: "exacta" },
        { type: "sheet", sheet: "mark" },
      ),
    ) ===
      JSON.stringify({
        name: "assist_sheet_open",
        params: { assist_sheet: "mark", assist_bet_type: "exacta" },
      }) &&
      assistEventOf(
        { ...st, betType: "exacta", target: 1 },
        { type: "target", target: 3 },
      ).params.assist_bet_type === "exacta",
  );
}

function scene4() {
  // ---- 買い目の券種（BOA-990 ①: 3連単・2連単）----
  {
    // ファン評価2周目 P2-1: 2026-10-27 蒲郡10R の exacta_all は 3-6・6-3 が無い。図の1着人気が欠けた組を除く艇
    const ex = {};
    for (const a of [1, 2, 3, 4, 5, 6])
      for (const b of [1, 2, 3, 4, 5, 6])
        if (a !== b && !["3-6", "6-3"].includes(`${a}-${b}`))
          ex[`${a}-${b}`] = 10;
    check(
      "図の1着人気: オッズの無い組（3-6・6-3）がある1着の艇は 3・6号艇。欠場の6号艇を外すと 3 も外れる。全部あれば空",
      JSON.stringify(missingFirstBoats(ex, [1, 2, 3, 4, 5, 6])) === "[3,6]" &&
        JSON.stringify(missingFirstBoats(ex, [1, 2, 3, 4, 5])) === "[]" &&
        JSON.stringify(
          missingFirstBoats({ ...ex, "3-6": 9, "6-3": 9 }, [1, 2, 3, 4, 5, 6]),
        ) === "[]" &&
        JSON.stringify(missingFirstBoats(null, [1, 2])) === "[]",
    );
  }
  {
    const s1 = scene1();
    const s2 = scene2(s1);
    scene3(s2);
  }
}

function scene5() {
  // ---- オッズの読み直しの時刻（BOA-1180）----
  {
    // 締切 13:14 のレース。2026-10-29〜11-02 の本番の実測で、各窓の値は窓の始まりの約0.6分後に DB に入る
    const dl = Date.parse("2026-10-06T13:14:00+09:00");
    const at = (hm) => Date.parse(`2026-10-06T${hm}+09:00`);
    const snap = (hm) => ({
      byType: {
        trifecta: {
          odds: {},
          capturedAt: new Date(at(hm)).toISOString(),
          final: false,
        },
      },
      capturedAt: new Date(at(hm)).toISOString(),
    });
    const min = (ms) => (ms == null ? null : ms / 60_000);
    check(
      "読み直し: 13:07 に -10（13:04:38）の値を読んだら、-5 の値が入る 13:10:30 に読み直す（直す前は読み直さなかった）",
      min(nextOddsRefreshDelay(dl, at("13:07:00"), snap("13:04:38"))) === 3.5,
      String(min(nextOddsRefreshDelay(dl, at("13:07:00"), snap("13:04:38")))),
    );
    check(
      "読み直し: 最初の読み込みが入っているはずの窓より古い（キャッシュ）なら、すぐ1回読み直す。読み直しの結果なら（窓の始まりから5分まで）1分おき",
      nextOddsRefreshDelay(dl, at("13:11:00"), snap("13:04:38")) === 0 &&
        min(nextOddsRefreshDelay(dl, at("13:11:00"), snap("13:04:38"), true)) ===
          1,
    );
    const finalOf = (ids) => ({
      byType: Object.fromEntries(
        ids.map((id) => [
          id,
          {
            odds: {},
            capturedAt: new Date(at("13:21:00")).toISOString(),
            final: true,
          },
        ]),
      ),
      capturedAt: new Date(at("13:21:00")).toISOString(),
    });
    check(
      "読み直し: 締切の後は締切時オッズが入る 11・20・30・45・61分後。全部の券種の締切時オッズがそろうか、61分後を過ぎたら終わり（一部の券種だけでは続ける）",
      min(nextOddsRefreshDelay(dl, at("13:16:00"), snap("13:14:36"))) === 9 &&
        min(nextOddsRefreshDelay(dl, at("13:26:00"), snap("13:14:36"), true)) ===
          8 &&
        min(nextOddsRefreshDelay(dl, at("13:50:00"), snap("13:14:36"), true)) ===
          9 &&
        nextOddsRefreshDelay(dl, at("14:15:00"), snap("13:14:36")) === null &&
        nextOddsRefreshDelay(
          dl,
          at("13:22:00"),
          finalOf(ASSIST_BET_TYPES.map((t) => t.id)),
        ) === null &&
        min(
          nextOddsRefreshDelay(dl, at("13:26:00"), finalOf(["trifecta"]), true),
        ) === 8,
    );
    check(
      "読み直し: 読み直しても入っているはずの窓の値が無ければ（取得の遅れ）、窓の始まりから5分までは1分おきに読む",
      min(nextOddsRefreshDelay(dl, at("12:46:00"), snap("12:14:37"), true)) ===
        1 &&
        min(nextOddsRefreshDelay(dl, at("12:50:00"), snap("12:14:37"), true)) ===
          10.5,
    );
    check(
      "読み直し: 締切時オッズの失敗で byType が空でも、発売前として2分おきに読む",
      min(
        nextOddsRefreshDelay(
          dl,
          at("12:20:00"),
          { byType: {}, capturedAt: null, finalFailed: true },
          true,
        ),
      ) === 2,
    );
    check(
      "読み直し: 窓は取得の registry（odds.offsets）と同じ",
      JSON.stringify(SCRAPE_JOBS.odds.offsets.map((o) => -o)) ===
        JSON.stringify(ODDS_SNAPSHOT_WINDOWS_MIN),
    );
    check(
      "読み直し: 発売前（オッズが無い）で -60〜-30 の間は2分おき、-60 より前は -60 の値が入る時刻、-30 の後は次の窓",
      min(nextOddsRefreshDelay(dl, at("12:20:00"), null, true)) === 2 &&
        min(nextOddsRefreshDelay(dl, at("12:00:00"), null)) === 15.5 &&
        min(nextOddsRefreshDelay(dl, at("12:50:00"), null, true)) === 10.5,
    );
    check(
      "読み直し: 締切が分からなければ読み直さない",
      nextOddsRefreshDelay(null, at("13:07:00"), snap("13:04:38")) === null,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runThinkingAssistModelScenes4(env) {
  ({ check } = env);
  scene4();
  scene5();
}
