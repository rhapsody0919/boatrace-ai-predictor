/**
 * verify-series-points-stage-rules.js の後半の場面（1/5）。verify ではない。
 * 判定と期待値は分ける前の verify-series-points-stage-rules.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  createFakeSupabase,
  installLocalStorage,
  registerFakeServiceSupabase,
  setFakeSupabase,
} from "./fakeServiceSupabase.js";
import { RECORDS, BADGE_CASES, LABEL_CASES } from "./series-points-stage-rules.js";
import {
  computeSeriesScore,
  listSeriesFinishes,
  buildMeetRanking,
  listAbsentOnlyRacers,
  FINISH_ABSENT,
  isAbsentStartRow,
  runFinishLabel,
  officialMarkOf,
  pointsNeededForBorder,
  forecastSeriesScore,
} from "../../../src/pure/seriesPoints.js";
import {
  getRaceStageKey,
  getRaceStageCategory,
  isFinalStage,
  getRaceStageBadge,
  raceStageLabel,
} from "../../../src/constants/raceStageConfig.js";
import { dayCenter, dayTickLabels, layoutTrendByDate } from "../../../src/utils/trendDateLayout.js";
import { fetchAllByRaceId } from "../../lib/meetBoundaries.js";
import { buildRacerScopedRaceRows } from "../../../src/services/racerScopedRaceRows.js";
import { absentScenesLate } from "./series-points-stage-rules-absent-2.js";
import { absentScenesEarly } from "./series-points-stage-rules-absent-1.js";
import { meetTabAbsentScenes } from "./series-points-stage-rules-meet-tab.js";

let check;
let score, KNOWN_GAPS;

const t = (key) => `T(${key})`;

function scene1() {
  score = computeSeriesScore(RECORDS, {
    prelimEndRaceId: "2026-09-25-20-12",
  });
  check("得点（ドリーム12 + 予選8 + 特選11）", score.points, 31);
  check("走数（予選終了後の一般戦を除く3走）", score.runs, 3);
  check("得点率", Math.round(score.rate * 100) / 100, 10.33);
  // 着順の並びは**算入したレースだけ**。得点率の隣に出すので、算入していない走を
  // 混ぜると「着順が4つ並ぶのに3走」という食い違いになる（BOA-457）
  check(
    "着順の並びは算入したレースだけ（予選終了後の一般戦を含めない）",
    listSeriesFinishes(RECORDS, { prelimEndRaceId: "2026-09-25-20-12" }),
    [1, 2, 1],
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export function runSeriesPointsStageRulesScenes1(env) {
  ({ check } = env);
  scene1();
}

async function scene2() {
  // ---- 3b. 欠場（不出走）と失格・落水の区別（BOA-489） --------------------------
  // 着順に載らない走は2種類ある。失格・落水は「0点だが1走」、欠場は「走数にも
  // 入れない」。区別は `started`（本番STの記録があるか）で行う
  {
    const { base, withPrelim, board, RA, RB } = await absentScenesEarly({ createFakeSupabase, installLocalStorage, registerFakeServiceSupabase, setFakeSupabase, computeSeriesScore, listSeriesFinishes, buildMeetRanking, listAbsentOnlyRacers, FINISH_ABSENT, isAbsentStartRow, check });
    absentScenesLate({ listSeriesFinishes, listAbsentOnlyRacers, runFinishLabel, officialMarkOf, dayCenter, dayTickLabels, layoutTrendByDate, buildRacerScopedRaceRows, check, base, withPrelim, board, RA, RB });
    await meetTabAbsentScenes({ board, check });
  }
  // 「届かず」の判定に使う上限は、残りレースの種別ごとの1着の点で出す。
  // 予選配点の10点で決め打ちすると、ドリーム戦が残っている選手を取りこぼす
  check(
    "必要得点の上限は残りレースの配点で決まる",
    [
      // 残り1走・必要11点。予選配点（上限10）では届かないが、ドリーム戦（12）なら届く
      pointsNeededForBorder({ points: 0, runs: 1 }, 5.5, 1),
      pointsNeededForBorder({ points: 0, runs: 1 }, 5.5, 1, 12),
    ],
    [
      { needed: 11, max: 10, reachable: false },
      { needed: 11, max: 12, reachable: true },
    ],
  );
  check(
    "早見はドリーム戦の日はドリーム配点で出す",
    forecastSeriesScore({ points: 31, runs: 3 }, "ドリーム戦")[0].rate,
    (31 + 12) / 4,
  );
  check(
    "早見は予選の日は予選配点で出す",
    forecastSeriesScore({ points: 31, runs: 3 }, "予選")[0].rate,
    (31 + 10) / 4,
  );
  // ---- 4. バッジ判定 ---------------------------------------------------------
  check("バッジ: 優勝戦", getRaceStageKey("優勝戦"), "final");
  check("バッジ: 会場名付きの優勝戦", getRaceStageKey("ツッキー優勝戦"), "final");
  check("バッジ: 準優勝戦", getRaceStageKey("準優勝戦"), "semifinal");
  check("バッジ: 準々優勝戦は山場でない", getRaceStageKey("準々優勝戦"), null);
  check("バッジ: 準優進出戦は準優でない", getRaceStageKey("準優進出戦"), null);
  // 男女Ｗ優勝戦の準優勝戦は「Ｗ準優戦前半/後半」と書く（「勝」が無い）。以前は準優勝戦に
  // 当たらず、見出しのチップが「会場独自の名前」、英韓中の文中に原文の日本語が入った（BOA-728）
  check(
    "バッジ: Ｗ準優戦前半は準優勝戦",
    getRaceStageKey("Ｗ準優戦前半"),
    "semifinal",
  );
  check(
    "区分: Ｗ準優戦後半は準優勝戦",
    getRaceStageCategory("Ｗ準優戦後半")?.key,
    "semifinal",
  );
  check(
    "区分: 準優進出戦は準優勝戦でない",
    getRaceStageCategory("準優進出戦")?.key,
    "semifinalQualifier",
  );
  check("バッジ: 予選", getRaceStageKey("予選"), null);
  for (const [stage, final, badge] of BADGE_CASES) {
    const input = String(JSON.stringify(stage));
    const key = getRaceStageKey(stage);
    check(`isFinalStage(${input})`, isFinalStage(stage), final);
    check(`getRaceStageBadge(${input})`, getRaceStageBadge(stage), badge);
    check(
      `isFinalStage とキーの一致(${input})`,
      isFinalStage(stage),
      key === "final",
    );
    check(
      `バッジとキーの一致(${input})`,
      getRaceStageBadge(stage)?.i18nKey,
      key ? `raceStage.${key}` : undefined,
    );
  }
  for (const [stage, lang, expected] of LABEL_CASES) {
    check(
      `raceStageLabel(${JSON.stringify(stage)}, ${JSON.stringify(lang)})`,
      raceStageLabel(stage, t, lang),
      expected,
    );
  }
  // lang は i18n が渡す。未指定・空文字の仕様は未定なので assert しない。
  KNOWN_GAPS = [undefined, ""].map((lang) => ({
    input: { raceStage: "優勝戦", lang: String(JSON.stringify(lang)) },
    specification: "言語が未指定・空文字の場合の扱いは未定",
    current: raceStageLabel("優勝戦", t, lang),
  }));
  console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length} 件`);
  for (const gap of KNOWN_GAPS) console.log(JSON.stringify(gap));
}

async function scene3() {
  // ---- 5. 全件取得のページング -----------------------------------------------
  // `race_entries` は1レース6行で `race_id` が一意でない。ページの境目が同じ
  // `race_id` の途中に落ちたときに行を取りこぼさないこと（BOA-457のレビュー指摘）
  {
    // 1レース6行 × 10レースの擬似テーブル。ページサイズ8（6の倍数でない）だと
    // 必ず境目がレースの途中に落ちる。本番も1000行 ÷ 6行/レース で同じことが起きる
    const rows = [];
    for (let r = 1; r <= 10; r += 1) {
      for (let b = 1; b <= 6; b += 1) {
        rows.push({
          race_id: `2026-01-01-01-${String(r).padStart(2, "0")}`,
          boat_number: b,
        });
      }
    }
    const fake = {
      from: () => {
        let cursor = "";
        let limit = Infinity;
        const chain = {
          select: () => chain,
          gt: (_col, v) => {
            cursor = v;
            return chain;
          },
          order: () => chain,
          limit: (n) => {
            limit = n;
            return chain;
          },
          then: (res) =>
            Promise.resolve({
              data: rows.filter((r) => r.race_id > cursor).slice(0, limit),
              error: null,
            }).then(res),
        };
        return chain;
      },
    };
    const fetched = await fetchAllByRaceId(fake, "race_entries", "race_id", {
      pageSize: 8,
    });
    check(
      "ページの境目がレースの途中でも全行取れる",
      fetched.length,
      rows.length,
    );
    check(
      "取りこぼしたレースが無い",
      new Set(fetched.map((r) => r.race_id)).size,
      10,
    );
    check(
      "重複して取っていない",
      new Set(fetched.map((r) => `${r.race_id}-${r.boat_number}`)).size,
      rows.length,
    );
    // 1レースが1ページに収まらないときは、黙って取りこぼさず落とす
    let threw = null;
    try {
      await fetchAllByRaceId(fake, "race_entries", "race_id", { pageSize: 4 });
    } catch (e) {
      threw = e.message.includes("ページングできない");
    }
    check("1レースがページに収まらないときは例外で落とす", threw, true);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check） */
export async function runSeriesPointsStageRulesScenes2(env) {
  ({ check } = env);
  await scene2();
  await scene3();
}
