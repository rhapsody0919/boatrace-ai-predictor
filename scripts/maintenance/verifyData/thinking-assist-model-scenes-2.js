/**
 * verify-thinking-assist-model.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-thinking-assist-model.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { shouldOpenAssist, showNewBadge } from "../../../src/utils/raceView.js";
import {
  boardModel,
  firstPlaceComposite,
  betForm,
  roughState,
  hasPricedTicket,
} from "../../../src/utils/assistModel.js";
import { racersFilled, racers, axis, bestOfNum } from "./thinking-assist-model-scenes-1.js";

let fx, check;
let flowFilled, flowOverall, cmpSt, cmpNat, power, comp;

const tri = { "1-2-3": 6.4, "1-2-4": 15.2, "2-1-3": 37.5, "4-1-2": 133 };

function scene1() {
  flowFilled = boardModel({
    lens: "flow",
    stage: "pre",
    racers: racersFilled,
  });
  check(
    "このコース: 5走未満は補った値（生の .120 ではなく .147）で「全体で補った」。5走は補わない。走数が少ない艇（6走未満）は金枠を付けない",
    racersFilled[1].stCourse === 0.1473 &&
      flowFilled.rows[1].dotText === ".147" &&
      flowFilled.rows[1].filled === true &&
      flowFilled.rows[4].filled === false &&
      flowFilled.rows
        .filter((r) => r.dotBest)
        .map((r) => r.boat)
        .join() === "3",
    JSON.stringify(flowFilled.rows.map((r) => [r.dotText, r.filled, r.dotBest])),
  );
  flowOverall = boardModel({
    lens: "flow",
    stage: "pre",
    racers,
    stBasis: "overall",
  });
  check(
    "切り替えで直近30走: 横軸は平均ST（直近30走）、点は st_mean30（1号艇 .132）、補った印は付けない",
    flowOverall.title === "平均ST（直近30走） 左ほど早い" &&
      flowOverall.basis === "overall" &&
      flowOverall.rows[0].dotText === ".132" &&
      flowOverall.rows[0].dotMetric === "st_mean30" &&
      flowOverall.rows.every((r) => !r.filled),
    flowOverall.title,
  );
  check(
    "展示の後も平均ST の切り替えを出す（spec D-47 (1)）",
    boardModel({ lens: "flow", stage: "post", racers, stBasis: "overall" })
      .basis === "overall",
  );
  check(
    "v16 の保存が無いと分かったレースだけ、軸レンズに平均ST を出せない理由（読み込み中は出さない。BOA-808 6）",
    boardModel({
      lens: "axis",
      stage: "pre",
      racers,
      hasToday: false,
      stMissing: true,
    }).noSt === true &&
      boardModel({ lens: "axis", stage: "pre", racers, hasToday: false }).noSt ===
        false,
  );
  // 6艇比較の目盛りと縮尺（BOA-804）: 目盛りを消さず、ST は展開レンズと同じ .00〜.25、勝率は軸レンズと同じ
  cmpSt = boardModel({
    lens: "axis",
    stage: "pre",
    racers,
    metric: "st_mean30",
  });
  cmpNat = boardModel({
    lens: "axis",
    stage: "pre",
    racers,
    metric: "nat_win",
  });
}

function scene2() {
  check(
    "6艇比較: 平均ST は目盛り .00〜.25（展開レンズと同じ縮尺）、全国勝率は軸レンズと同じ目盛り",
    cmpSt.left === ".00" &&
      cmpSt.right === ".25" &&
      cmpSt.lo === 0 &&
      cmpSt.hi === 0.25 &&
      cmpNat.left === axis.left &&
      cmpNat.right === axis.right &&
      cmpNat.lo === axis.lo &&
      cmpNat.hi === axis.hi,
    JSON.stringify([
      cmpSt.left,
      cmpSt.right,
      cmpNat.left,
      cmpNat.right,
      axis.left,
      axis.right,
    ]),
  );
  check(
    "6艇比較: どの項目も目盛りの文字が空でない",
    [
      "nat_win",
      "loc_win",
      "st_mean30",
      "motor_2",
      "exh_time",
      "st_course",
      "exh_st",
    ].every((m) => {
      const c = boardModel({ lens: "axis", stage: "post", racers, metric: m });
      return c.left !== "" && c.right !== "";
    }),
  );
  power = boardModel({
    lens: "power",
    stage: "post",
    racers,
    finalRound: true,
  });
  check(
    "機力レンズ（展示後）: 一番速い艇との差。モーター2連率の最良は4号艇（38.5）、展示タイムは4号艇（6.83）",
    power.rows[3].x === 0 &&
      bestOfNum(power, 0) === "4" &&
      bestOfNum(power, 1) === "4",
  );
  check(
    "機力レンズ（展示前）: 数字はモーター2連率の1個（展示の値を出さない）",
    boardModel({ lens: "power", stage: "pre", racers }).rows.every(
      (r) => r.nums.length === 1 && r.nums[0].metric === "motor_2",
    ),
  );
  comp = firstPlaceComposite(tri, [4]);
  check(
    "1着の合成オッズ: 1着が同じ組をまとめ、欠場の艇（4）を含む組は2着・3着でも数えない（D-38）",
    Math.abs(comp.get(1) - 6.4) < 1e-9 && // 1-2-4 は4号艇を含むので外れる
      Math.abs(firstPlaceComposite(tri).get(1) - 1 / (1 / 6.4 + 1 / 15.2)) <
        1e-9 &&
      Math.abs(comp.get(2) - 37.5) < 1e-9 &&
      !comp.has(4),
  );
  check(
    "買い目レンズ: オッズが無ければ図に点を置かない（noOdds、「オッズは締切の約1時間前から出る」）",
    boardModel({ lens: "bet", stage: "post", racers, trifecta: null }).noOdds ===
      true,
  );
  check(
    "買い目の表記: 着ごとの候補を艇番の昇順で「1-23-234」、候補の無い着は「—」",
    betForm({ 1: new Set([1]), 2: new Set([3, 2]), 3: new Set([4, 2, 3]) }) ===
      "1-23-234" &&
      betForm({ 1: new Set(), 2: new Set([2]), 3: new Set() }) === "—-2-—",
  );
}

function scene3() {
  // ---- PR #1308 /code-review の再現テスト ----
  check(
    "堅い？荒れる？: 1号艇の NC・NA の範囲キーが無いレースは「読み込み中」に残さず empty（取得しないので終わらない）",
    roughState({
      factsStatus: "ready",
      today: { scope_keys: { 1: { VA: "VA:18" } } },
      ncStatus: "idle",
      naStatus: "idle",
    }) === "empty" &&
      roughState({
        factsStatus: "ready",
        today: null,
        ncStatus: "idle",
        naStatus: "idle",
      }) === "empty" &&
      roughState({
        factsStatus: "ready",
        today: fx.today,
        ncStatus: "loading",
        naStatus: "ready",
      }) === "loading" &&
      roughState({
        factsStatus: "ready",
        today: fx.today,
        ncStatus: "error",
        naStatus: "ready",
      }) === "error",
  );
  check(
    "配分: オッズの付いた組が無い（発売前）ときは配分を出さない（「N点には最低0円」を出さない）",
    hasPricedTicket(["1-2-3"], {}) === false &&
      hasPricedTicket(["1-2-3"], null) === false &&
      hasPricedTicket(["1-2-3", "1-2-4"], { "1-2-4": 15.2 }) === true,
  );
  // ---- 上部の切り替え（PR6、D-22・D-36 (6)）----
  {
    const base = { saved: "assist", search: "", lang: "ja", enabled: true };
    check(
      "思考アシストを選んだ ja の端末は、tab・boat の指定が無いときだけ思考アシストへ移る",
      shouldOpenAssist(base) === true &&
        shouldOpenAssist({ ...base, search: "?tab=analogy" }) === false &&
        shouldOpenAssist({ ...base, search: "?boat=1" }) === false &&
        shouldOpenAssist({ ...base, lang: "en" }) === false &&
        shouldOpenAssist({ ...base, enabled: false }) === false &&
        shouldOpenAssist({ ...base, saved: "race" }) === false &&
        shouldOpenAssist({ ...base, saved: null }) === false,
    );
    check(
      "「新」の札: まだ選んでいない端末で、公開前は出し、公開から30日だけ出す",
      showNewBadge({ saved: null, today: "2026-10-09", publishedOn: null }) &&
        !showNewBadge({
          saved: "race",
          today: "2026-10-09",
          publishedOn: null,
        }) &&
        showNewBadge({
          saved: null,
          today: "2026-11-08",
          publishedOn: "2026-10-10",
        }) &&
        !showNewBadge({
          saved: null,
          today: "2026-11-09",
          publishedOn: "2026-10-10",
        }),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（fx・check） */
export function runThinkingAssistModelScenes2(env) {
  ({ fx, check } = env);
  scene1();
  scene2();
  scene3();
}
