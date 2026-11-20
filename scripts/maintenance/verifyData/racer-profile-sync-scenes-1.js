/**
 * verify-racer-profile-sync.js の後半の場面（1/2）。verify ではない。
 * 判定と期待値は分ける前の verify-racer-profile-sync.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  evaluateRun,
  runRacerProfileSync,
  parseArgs,
  SEASON_COLUMNS,
} from "../../lib/racerProfileSync.js";

let check, silent, seasonHtml, notFoundHtml, profileHtml, createMockSupabase, createMockSite, noSleep;

// ---------------------------------------------------------------------------
// 6. 統合: 実クライアント＋モックfetchで、送信されるリクエストを検証
// ---------------------------------------------------------------------------
export const existingRow = (id, extra = {}) => ({
  racer_id: id,
  name: `選手${id}`,
  birth_date: "1980-01-01",
  branch: "東京",
  grade_at_scrape: "A1級",
  ability_index: null,
  flying_count_period: null,
  false_start_count_period: null,
  period_label: null,
  official_win_rate_period: null,
  ...extra,
});

export const runWith = (mock, site, argv, deps = {}) =>
  runRacerProfileSync({
    client: mock.client,
    options: parseArgs(argv),
    deps: { fetchImpl: site.fetchImpl, sleep: noSleep, ...silent, ...deps },
  });

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  // 1001: 初回（期別成績が未取得）→更新 / 1002: 取得済みで同値→スキップ / 1003: 新規選手（未登録）
  // 1004: 期別成績ページが常に500 / 1005: 新人（集計期間内データ無し）
  // 1006: 公式サイトが「この登録番号は存在しない」を返す（引退・登録抹消等と推定。BOA-376）
  const mock = createMockSupabase({
    profiles: [
      existingRow(1001),
      existingRow(1002, {
        ability_index: 56,
        flying_count_period: 0,
        false_start_count_period: 0,
        period_label: "2026-second",
        official_win_rate_period: 6.87,
      }),
      existingRow(1004),
      existingRow(1005),
      existingRow(1006),
    ],
    recentRacerIds: [1001, 1003],
  });
  const site = createMockSite({
    1001: { season: seasonHtml({ flying: "1" }) },
    1002: { season: seasonHtml() },
    1003: { profile: profileHtml("新規 太郎"), season: seasonHtml() },
    1004: { season: 500 },
    1005: { season: seasonHtml({ withData: false }) },
    1006: { season: notFoundHtml() },
  });
  const { summary, verdict } = await runWith(mock, site, []);
  const writes = mock.requests.filter((r) => r.method !== "GET");
  const patch1001 = writes.find(
    (r) => r.method === "PATCH" && r.search.includes("racer_id=eq.1001"),
  );
  check(
    "統合: 期別成績はPATCH（upsertのPOSTではない）で、URLが racer_id=eq.<id>&select=racer_id",
    patch1001?.search,
    "?racer_id=eq.1001&select=racer_id",
  );
  check(
    "統合: PATCHのボディは期別成績5列＋official_updated_atだけ（name・birth_date・branch・grade_at_scrapeを含まない）",
    Object.keys(patch1001?.body ?? {}).sort(),
    [...SEASON_COLUMNS, "official_updated_at"].sort(),
  );
  check(
    "統合: 1001のF回数が更新される",
    mock.rows.get(1001).flying_count_period,
    1,
  );
  check(
    "統合: 既存の氏名・生年月日・支部・級別が上書きされない",
    [
      mock.rows.get(1001).name,
      mock.rows.get(1001).birth_date,
      mock.rows.get(1001).branch,
      mock.rows.get(1001).grade_at_scrape,
    ],
    ["選手1001", "1980-01-01", "東京", "A1級"],
  );
  check(
    "統合: 変更のない1002は書かない",
    writes.some((r) => r.search.includes("1002")),
    false,
  );
  const post1003 = writes.find((r) => r.method === "POST");
  check(
    "統合: 新規選手はPOST(upsert)で全列（name・birth_date含む）を送る",
    [post1003?.body?.name, post1003?.body?.birth_date],
    ["新規 太郎", "1990-01-02"],
  );
  check(
    "統合: 新規選手の期別成績はプロフィール登録後にPATCHで書く",
    writes.some(
      (r) => r.method === "PATCH" && r.search.includes("racer_id=eq.1003"),
    ),
    true,
  );
  return { mock, site, summary, verdict, writes };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ mock, site, summary, verdict, writes }) {
  check(
    "統合: 書き込みはPATCH2件(1001,1003)＋POST1件のみ",
    writes
      .map((r) => `${r.method}${r.search.match(/eq\.(\d+)/)?.[1] ?? ""}`)
      .sort(),
    ["PATCH1001", "PATCH1003", "POST"],
  );
  check(
    "統合: 直近出走の窓は race_id>=日付 の範囲指定",
    mock.requests
      .find((r) => r.table === "race_entries")
      ?.search.includes("race_id=gte.20"),
    true,
  );
  check(
    "統合: 件数の集計",
    [
      summary.season.successCount,
      summary.season.unchangedCount,
      summary.season.noDataCount,
      summary.season.notFoundCount,
      summary.season.failCount,
      summary.season.failedRacerIds,
      summary.profile.successCount,
    ],
    [2, 1, 1, 1, 1, [1004], 1],
  );
  check(
    "統合: 公式サイトが「ページが存在しない」を返した1006は、失敗（failCount）にせず notFoundCount に計上する（BOA-376）",
    [
      mock.requests.some(
        (r) => r.method !== "GET" && r.search?.includes("1006"),
      ),
      summary.season.failedRacerIds.includes(1006),
    ],
    [false, false],
  );
  check(
    "統合: 500を返す選手は3回試行してから失敗として記録される",
    site.calls.filter((u) => u.includes("season?toban=1004")).length,
    3,
  );
  check(
    "統合: 失敗1/6（1006のnotFoundCountは分母から除かない対象数だが失敗率の分子には含めない）が上限5%を超えるため実行全体は失敗（終了コード1）",
    verdict.ok,
    false,
  );
}

async function scene3() {
  // ---------------------------------------------------------------------------
  // 5. 結果の判定（終了コード）
  // ---------------------------------------------------------------------------
  {
    const ok = {
      targetCount: 100,
      stoppedEarly: false,
      aborted: false,
      nextOffset: null,
      profile: { successCount: 0, failCount: 0, saveErrorCount: 0 },
      season: {
        successCount: 5,
        unchangedCount: 90,
        noDataCount: 3,
        failCount: 2,
      },
    };
    check("evaluateRun: 失敗2%は成功", evaluateRun(ok).ok, true);
    check(
      "evaluateRun: 新規選手のプロフィール取得が1〜2件失敗（引退済み等）だけなら成功",
      evaluateRun({
        ...ok,
        profile: { successCount: 0, failCount: 2, saveErrorCount: 0 },
      }).ok,
      true,
    );
    check(
      "evaluateRun: 新規選手のプロフィール取得が3件すべて失敗は失敗",
      evaluateRun({
        ...ok,
        profile: { successCount: 0, failCount: 3, saveErrorCount: 0 },
      }).ok,
      false,
    );
    check(
      "evaluateRun: 新規選手のプロフィール保存でDBエラーが1件でもあれば失敗",
      evaluateRun({
        ...ok,
        profile: { successCount: 4, failCount: 1, saveErrorCount: 1 },
      }).ok,
      false,
    );
    check(
      "evaluateRun: 全件が変更なし（書き込み0）でも成功",
      evaluateRun({
        ...ok,
        season: { ...ok.season, successCount: 0, unchangedCount: 98 },
      }).ok,
      true,
    );
    check(
      "evaluateRun: 全件失敗（書き込み0・確認0）は失敗",
      evaluateRun({
        ...ok,
        season: {
          successCount: 0,
          unchangedCount: 0,
          noDataCount: 0,
          failCount: 100,
        },
      }).ok,
      false,
    );
    check(
      "evaluateRun: 失敗率6%は失敗",
      evaluateRun({ ...ok, season: { ...ok.season, failCount: 6 } }).ok,
      false,
    );
    check(
      "evaluateRun: 失敗率5%ちょうどは成功",
      evaluateRun({ ...ok, season: { ...ok.season, failCount: 5 } }).ok,
      true,
    );
    check(
      "evaluateRun: 対象0件は失敗",
      evaluateRun({ ...ok, targetCount: 0 }).ok,
      false,
    );
    check(
      "evaluateRun: 時間予算で中断は失敗",
      evaluateRun({ ...ok, stoppedEarly: true, nextOffset: 800 }).ok,
      false,
    );
    check(
      "evaluateRun: 中断（連続失敗）は失敗",
      evaluateRun({ ...ok, aborted: true }).ok,
      false,
    );
  }
  {
    const s1 = await scene1();
    scene2(s1);
  }
}

async function scene4() {
  {
    // 失敗なし・全件変更なしの実行は成功
    const same = {
      ability_index: 56,
      flying_count_period: 0,
      false_start_count_period: 0,
      period_label: "2026-second",
      official_win_rate_period: 6.87,
    };
    const mock = createMockSupabase({
      profiles: [existingRow(1, same), existingRow(2, same)],
    });
    const site = createMockSite({
      1: { season: seasonHtml() },
      2: { season: seasonHtml() },
    });
    const { summary, verdict } = await runWith(mock, site, []);
    check(
      "統合: 全件変更なしなら書き込み0件でも成功、書き込みリクエストも0",
      [
        verdict.ok,
        summary.season.unchangedCount,
        mock.requests.filter((r) => r.method !== "GET").length,
      ],
      [true, 2, 0],
    );
  }
  {
    // --racer-ids: race_entriesを読まず、racer_profilesもその選手だけを読む
    const mock = createMockSupabase({
      profiles: [existingRow(1), existingRow(2)],
    });
    const site = createMockSite({
      1: { season: seasonHtml() },
      2: { season: seasonHtml() },
    });
    const { summary } = await runWith(mock, site, ["--racer-ids=2", "--dry-run"]);
    check(
      "統合: --racer-ids は対象だけ取得し、race_entriesを読まない",
      [summary.targetCount, mock.requests.map((r) => r.table)],
      [1, ["racer_profiles"]],
    );
    check(
      "統合: dry-runは書き込みリクエストを送らない",
      mock.requests.filter((r) => r.method !== "GET").length,
      0,
    );
  }
  {
    // update が0行を返す（対象行なし）→失敗として記録され、成功扱いにしない
    const mock = createMockSupabase({
      profiles: [existingRow(1)],
      patchMissesRows: true,
    });
    const site = createMockSite({ 1: { season: seasonHtml() } });
    const { summary, verdict } = await runWith(mock, site, []);
    check(
      "統合: PATCHの更新が0行なら失敗として記録し、実行は失敗",
      [summary.season.successCount, summary.season.failCount, verdict.ok],
      [0, 1, false],
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・silent・seasonHtml・notFoundHtml・profileHtml・createMockSupabase・createMockSite・noSleep） */
export async function runRacerProfileSyncScenes1(env) {
  ({ check, silent, seasonHtml, notFoundHtml, profileHtml, createMockSupabase, createMockSite, noSleep } = env);
  await scene3();
  await scene4();
}
