/**
 * verify-scrape-odds-job.js の後半の場面（5/5）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-odds-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  buildBaseRow,
  fullOddsPatchOf,
  pickFallbackPatches,
  FULL_ODDS_KEYS,
} from "../../daily/scrape-odds.js";
import { computeOddsDigest } from "../../lib/scrapeJobs/oddsDigest.js";
import { compareOddsShadowDigests } from "../check-odds-shadow.js";

let printOut, check, show, same, DATE, RACE_A, fullRow;

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene1() {
  const data = {
    winOdds: [1.1, 2.2, 3.3, 4.4, 5.5, 6.6],
    placeOdds: [1, 2, 3, 4, 5, 6].map((n) => ({ low: n, high: n + 0.5 })),
    trifecta: [
      { combination: "1-2-3", odds: 10 },
      { combination: "2-1-3", odds: 20 },
      { combination: "3-1-2", odds: 30 },
    ],
  };
  const base = buildBaseRow("R", "T", data);
  // 従来の run() が組み立てていた行と、列名・値の対応が同じ（26列。値は入力の並びどおり）
  const expected = {
    race_id: "R",
    captured_at: "T",
    ...Object.fromEntries(
      [1, 2, 3, 4, 5, 6].map((n) => [`odds_win_${n}`, data.winOdds[n - 1]]),
    ),
    ...Object.fromEntries(
      [1, 2, 3, 4, 5, 6].flatMap((n) => [
        [`odds_place_${n}_low`, n],
        [`odds_place_${n}_high`, n + 0.5],
      ]),
    ),
    trifecta_popular_1: "1-2-3",
    trifecta_odds_1: 10,
    trifecta_popular_2: "2-1-3",
    trifecta_odds_2: 20,
    trifecta_popular_3: "3-1-2",
    trifecta_odds_3: 30,
  };
  check(
    "buildBaseRow: 従来の基本オッズの行と同じ26列（race_id・captured_at・単勝6・複勝12・3連単人気3位×2）で、値の対応も同じ。全通り系・window_min・source を含まない",
    Object.keys(base).length === 26 &&
      same(
        Object.fromEntries(Object.entries(base).sort()),
        Object.fromEntries(Object.entries(expected).sort()),
      ) &&
      !("window_min" in base) &&
      !("source" in base) &&
      !("trifecta_all" in base),
    show(base),
  );
  check(
    "buildBaseRow: 複勝・3連単が欠けていれば null（例外にしない）",
    (() => {
      const b = buildBaseRow("R", "T", {
        winOdds: [1],
        placeOdds: [],
        trifecta: [],
      });
      return (
        b.odds_win_2 === null &&
        b.odds_place_1_low === null &&
        b.trifecta_popular_1 === null
      );
    })(),
  );
  check(
    "fullOddsPatchOf: 取得できた券種の列だけを持つ（null は含めない）",
    same(
      fullOddsPatchOf({
        trifectaAll: { a: 1 },
        wideAll: { b: 2 },
        trioAll: null,
      }),
      {
        trifecta_all: { a: 1 },
        wide_all: { b: 2 },
      },
    ),
  );
  const snap = (raceId, at, extra) => ({
    race_id: raceId,
    captured_at: at,
    ...extra,
  });
  return { snap };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ snap }) {
  const picked = pickFallbackPatches(
    new Map([
      ["R1", { trifecta_all: { x: 1 } }], // 4列が欠け
      ["R2", Object.fromEntries(FULL_ODDS_KEYS.map((k) => [k, { x: 1 }]))], // 欠けなし
      ["R3", {}],
    ]),
    [
      snap("R1", "2026-09-19T04:59:00Z", {
        trio_all: { t: 1 },
        wide_all: null,
      }),
      snap("R1", "2026-09-19T04:50:00Z", { wide_all: { w: 1 } }),
      snap("R2", "2026-09-19T04:59:00Z", { trio_all: { t: 1 } }),
    ],
  );
  check(
    "pickFallbackPatches: 欠けているレースだけを対象に、最新のスナップショットが持つ列を返す（最新が null の列は、古い行から拾わない＝従来と同じ）",
    picked.size === 1 &&
      same(picked.get("R1"), { trio_all: { t: 1 } }) &&
      !picked.has("R2") &&
      !picked.has("R3"),
    show([...picked]),
  );
}

function scene3() {
  {
    const s1 = scene1();
    scene2(s1);
  }
  // shadow の一致率の比較（check-odds-shadow.js）
  {
    const digestRow = fullRow({ window_min: null, source: "gha" });
    const slotDigest = computeOddsDigest(digestRow);
    // 桐生1R 発走 12:00 JST（03:00Z）、窓 -30 → 期限 11:30 JST（02:30Z）
    const slot = (extra = {}) => ({
      race_id: RACE_A,
      race_date: DATE,
      offset_min: -30,
      result_digest: slotDigest,
      races: { start_time: "12:00:00" },
      ...extra,
    });
    const row = (captured_at, extra = {}) => ({
      ...digestRow,
      captured_at,
      ...extra,
    });
    const near = "2026-09-19T02:31:00.000Z";
    const c1 = compareOddsShadowDigests([slot()], [row(near)]);
    check(
      "shadow比較: 期限の近く（±5分以内）の既存基盤の行と構造が同じなら一致（値・時刻が違っても）",
      c1.matched === 1 && c1.mismatched.length === 0 && c1.missing.length === 0,
    );
    const c2 = compareOddsShadowDigests(
      [slot()],
      [row(near, { wide_all: null })],
    );
    check(
      "shadow比較: 既存基盤の行が拡連複を持たなければ不一致（Vercel が取れて既存基盤が取れていない差を検出）",
      c2.matched === 0 && c2.mismatched.length === 1,
    );
    const c3 = compareOddsShadowDigests(
      [slot()],
      [row("2026-09-19T02:40:00.000Z")],
    );
    check(
      "shadow比較: 期限から5分より離れた行しか無ければ「比べる行なし」（不一致に数えない）",
      c3.matched === 0 && c3.mismatched.length === 0 && c3.missing.length === 1,
    );
    const c4 = compareOddsShadowDigests(
      [slot()],
      [row("2026-09-19T02:35:00.000Z", { wide_all: null }), row(near)],
    );
    check(
      "shadow比較: 期限に最も近い行と比べる（遠い行が構造違いでも、近い行が同じなら一致）",
      c4.matched === 1 && c4.mismatched.length === 0,
    );
    const c5 = compareOddsShadowDigests(
      [slot({ result_digest: null })],
      [row(near)],
    );
    check(
      "shadow比較: digest 未記録のスロットは数えない",
      c5.noDigest.length === 1 && c5.matched === 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・DATE・RACE_A・fullRow） */
export function runScrapeOddsJobScenes5(env) {
  ({ printOut, check, show, same, DATE, RACE_A, fullRow } = env);
  scene3();
}

function scene4() {
  printOut("");
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・DATE・RACE_A・fullRow） */
export function runScrapeOddsJobScenes6(env) {
  ({ printOut, check, show, same, DATE, RACE_A, fullRow } = env);
  scene4();
}

function scene5() {
  printOut("✅ すべての検証に成功しました");
}

/** verify から呼ぶ入口。env は verify 側の束縛（printOut・check・show・same・DATE・RACE_A・fullRow） */
export function runScrapeOddsJobScenes7(env) {
  ({ printOut, check, show, same, DATE, RACE_A, fullRow } = env);
  scene5();
}
