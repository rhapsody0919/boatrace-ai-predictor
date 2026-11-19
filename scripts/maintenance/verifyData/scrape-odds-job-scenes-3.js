/**
 * verify-scrape-odds-job.js の後半の場面（3/5）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-odds-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { runForRaces, FULL_ODDS_KEYS, isOddsRowComplete } from "../../daily/scrape-odds.js";
import { createOddsSlotHandler } from "../../lib/scrapeJobs/oddsHandlers.js";
import { runScrapeJob } from "../../lib/scrapeJobs/cronWrapper.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";
import { createMemoryStore } from "../../lib/scrapeJobs/testing/memoryStore.js";
import { opts } from "./scrape-odds-job-scenes-2.js";

let check, show, same, HTML_UNPUBLISHED, HTML_ALL_ZERO_VOTES, RACE_A, RACE_B, RACE_C, raceOf, NOW, createFetcher, createFakeDb, findRow, fullRow;

// ---------------------------------------------------------------------------
// (c) 共通ラッパ経由の odds
// ---------------------------------------------------------------------------
export const slotOf = (raceId, offset, extra = {}) => ({
  job: "odds",
  race_id: raceId,
  offset_min: offset,
  attempts: 1,
  last_attempt_at: NOW.toISOString(),
  lease_until: new Date(NOW.getTime() + 120000).toISOString(),
  ...extra,
});

export async function runOdds({ rows, slots, available, db, fetcher, run }) {
  const store = createMemoryStore({ rows, slots, available });
  const database = db ?? createFakeDb();
  const f = fetcher ?? createFetcher();
  const result = await runScrapeJob({
    job: "odds",
    store,
    handleSlot: createOddsSlotHandler(run ? { run } : {}),
    now: () => NOW,
    worker: "test:odds",
    client: database,
    politeFetch: f,
  });
  return { result, store, db: database, fetcher: f };
}

async function scene1() {
  {
    // 完了済みの窓は、取得しない
    const db = createFakeDb([fullRow({ window_min: -30 })]);
    const f = createFetcher();
    const [r] = await runForRaces([raceOf(RACE_A, -30, 2)], opts(db, f));
    check(
      "再試行: その窓の行が既に完了していれば、取得せず skipped_have_data（完了の記録だけが失敗した場合の二重取得を避ける）",
      r.outcome === "skipped_have_data" &&
        f.calls.length === 0 &&
        db.writes.length === 0,
      show(r),
    );
    const db2 = createFakeDb([fullRow({ window_min: -30 })]);
    const f2 = createFetcher();
    const [r2] = await runForRaces([raceOf(RACE_A, -30, 1)], opts(db2, f2));
    check(
      "初回（attempts=1）は既存行を読まず、取得する（読み取りの追加なし）",
      r2.outcome === "ok" && f2.calls.length === 5 && db2.reads.length === 0,
      show({ r2, reads: db2.reads.length }),
    );
    const db3 = createFakeDb([fullRow({ window_min: -15 })]);
    const f3 = createFetcher();
    const [r3] = await runForRaces([raceOf(RACE_A, -30, 2)], opts(db3, f3));
    check(
      "再試行でも、別の窓の完了済みの行は、この窓の完了とみなさない",
      r3.outcome === "ok" && f3.calls.length === 5,
    );
  }
  {
    const db = createFakeDb();
    const f = createFetcher({ oddstf: HTML_UNPUBLISHED });
    const [r] = await runForRaces([raceOf(RACE_A, -60)], opts(db, f));
    check(
      "未公開: no_values（書き込みなし・再試行される outcome）",
      r.outcome === "no_values" && db.writes.length === 0 && r.rowsParsed === 0,
      show(r),
    );
  }
}

async function scene2() {
  // BOA-486: 全艇が票0（0.0）でも、解析できた全通り系を捨てずに行を書く。
  // 以前は no_values になって行が1つも組み立てられず、画面のオッズ一覧タブが発走20分前でも空だった
  {
    const db = createFakeDb();
    const f = createFetcher({ oddstf: HTML_ALL_ZERO_VOTES });
    const [r] = await runForRaces([raceOf(RACE_A, -60)], opts(db, f));
    // 修正前は行が1つも書かれない（これが BOA-486 の症状）。その状態でも例外ではなく ❌ として出るよう {} にする
    const written = db.rows[0] ?? {};
    check(
      "全艇票0: no_values にせず ok で書き込む（単勝は null・全通り系5券種は入る）",
      r.outcome === "ok" &&
        r.rowsWritten === 1 &&
        db.rows.length === 1 &&
        [1, 2, 3, 4, 5, 6].every((b) => written[`odds_win_${b}`] === null) &&
        FULL_ODDS_KEYS.every((k) => written[k]) &&
        Object.keys(written.trifecta_all).length === 120,
      show(r),
    );
    check(
      "全艇票0: 3連単の人気上位3件は、単勝が無くても odds3t から求まる",
      // != null（undefined も落とす）。修正前は written が {} で、!== null だと undefined でも通ってしまう
      written.trifecta_popular_1 != null && written.trifecta_odds_1 != null,
      show([written.trifecta_popular_1, written.trifecta_odds_1]),
    );
    // winFirst（-60 の延長中の再試行）でも、票0は「公開済み」として扱い、残りの4ページを取る
    const f2 = createFetcher({ oddstf: HTML_ALL_ZERO_VOTES });
    const [r2] = await runForRaces(
      [{ ...raceOf(RACE_B, -60, 4), winFirst: true }],
      opts(createFakeDb(), f2),
    );
    check(
      "winFirst: 全艇票0は未公開として打ち切らず、5ページ取って ok にする",
      r2.outcome === "ok" && f2.calls.length === 5,
      show([r2.outcome, f2.calls.length]),
    );
  }
  {
    const db = createFakeDb([], { failUpsert: true });
    const [r] = await runForRaces(
      [raceOf(RACE_A, -60)],
      opts(db, createFetcher()),
    );
    check(
      "書き込み失敗: error（メッセージ付き・rowsWritten 0）。再試行される",
      r.outcome === "error" &&
        /書き込みに失敗/.test(r.error) &&
        r.rowsWritten === 0,
      show(r),
    );
  }
  {
    const db = createFakeDb();
    const [r] = await runForRaces(
      [raceOf(RACE_A, -60)],
      opts(
        db,
        createFetcher({
          oddstf: new BreakerOpenError("host:boatrace.jp", NOW.getTime() + 60000),
        }),
      ),
    );
    check(
      "ブレーカー: breaker_open（retryAt つき・書き込みなし）",
      r.outcome === "breaker_open" &&
        r.retryAt instanceof Date &&
        db.writes.length === 0,
    );
  }
}

async function scene3() {
  {
    // 1件の失敗が他を止めない・書き込みは1回にまとまる
    const db = createFakeDb();
    const f = createFetcher({ "oddstf@2": 500 });
    const rs = await runForRaces(
      [raceOf(RACE_A, -30), raceOf(RACE_B, -30), raceOf(RACE_C, -30)],
      opts(db, f),
    );
    check(
      "複数レース: 1レースの単勝ページが失敗しても、他のレースは ok。書き込みは1回（ok の2行のみ）",
      same(
        rs.map((x) => x.outcome),
        ["ok", "error", "ok"],
      ) &&
        db.writes.length === 1 &&
        db.writes[0].count === 2 &&
        db.rows.length === 2,
      show(rs.map((x) => x.outcome)),
    );
  }
  {
    const f = createFetcher({}, { delayMs: 5 });
    const races = Array.from({ length: 8 }, (_, i) =>
      raceOf(`2026-09-19-05-${String(i + 1).padStart(2, "0")}`, -30),
    );
    await runForRaces(races, opts(createFakeDb(), f, { concurrency: 2 }));
    check(
      "並列度: concurrency=2 なら、同時に取得するページは 2レース×5ページ＝10 以下（会場内12レース×5＝最大60同時だった現行より緩やか）",
      f.maxActive <= 10 && f.maxActive >= 5 && f.calls.length === 40,
      `max=${f.maxActive} calls=${f.calls.length}`,
    );
  }
}

async function scene4() {
  {
    // 0分窓のフォールバック
    const missingWide = createFetcher({ oddsk: 500 });
    const older = fullRow({
      window_min: -5,
      captured_at: "2026-09-19T04:55:00.000Z",
      wide_all: { "1-2": 3.3, "1-3": 4.4 },
    });
    const db = createFakeDb([
      older,
      // 自分の窓（0）の、部分的な前回の試行（拡連複なし。新しい）: 補完元にしない
      fullRow({
        window_min: 0,
        captured_at: "2026-09-19T04:59:00.000Z",
        wide_all: null,
      }),
    ]);
    const [r] = await runForRaces([raceOf(RACE_A, 0, 2)], opts(db, missingWide));
    const row = findRow(db, RACE_A, 0)[0];
    check(
      "0分窓: 拡連複が取れなくても、直近のスナップショット（自分の窓の行を除く）から補完して ok にする（ADR-0057）",
      r.outcome === "ok" &&
        same(row.wide_all, older.wide_all) &&
        isOddsRowComplete(row),
      show(r),
    );

    const dbOld = createFakeDb([
      fullRow({
        window_min: -5,
        captured_at: "2026-09-19T03:00:00.000Z", // 120分前: 75分を超える
        wide_all: { "1-2": 3.3 },
      }),
    ]);
    const [rOld] = await runForRaces(
      [raceOf(RACE_A, 0)],
      opts(dbOld, createFetcher({ oddsk: 500 })),
    );
    check(
      "0分窓: 75分より古いスナップショットは採用しない（partial のまま）",
      rOld.outcome === "partial" && same(rOld.missing, ["wide_all"]),
      show(rOld),
    );

    const dbOther = createFakeDb([older]);
    const [rOther] = await runForRaces(
      [raceOf(RACE_A, -5)],
      opts(dbOther, createFetcher({ oddsk: 500 })),
    );
    check(
      "0分窓以外（-5分）は、補完しない（partial のまま再試行）",
      rOther.outcome === "partial" && same(rOther.missing, ["wide_all"]),
    );
    const [rShadow] = await runForRaces(
      [raceOf(RACE_A, 0)],
      opts(createFakeDb([older]), createFetcher({ oddsk: 500 }), {
        mode: "shadow",
      }),
    );
    check(
      "0分窓の補完は shadow でも同じ判定（ダイジェストが live と同じになる）。書き込みはしない",
      rShadow.outcome === "ok" && rShadow.rowsWritten === 0,
    );
  }
  {
    let threw = null;
    try {
      await runForRaces(
        [{ ...raceOf(RACE_A, -30), window_min: undefined }],
        opts(createFakeDb(), createFetcher()),
      );
    } catch (e) {
      threw = e.message;
    }
    let threw2 = null;
    try {
      await runForRaces(
        [raceOf(RACE_A, -30)],
        opts(createFakeDb(), createFetcher(), { mode: "bogus" }),
      );
    } catch (e) {
      threw2 = e.message;
    }
    check(
      "入力の検査: window_min が無い・mode が不正なら、取得せずに例外（メッセージ付き）",
      /window_min/.test(threw ?? "") && /mode/.test(threw2 ?? ""),
      `${threw} / ${threw2}`,
    );
  }
}

async function scene5() {
  {
    const off = await runOdds({
      rows: { odds: { job: "odds", mode: "off", consecutive_failures: 0 } },
      slots: [slotOf(RACE_A, -30)],
    });
    check(
      "ラッパ: mode=off は、取得も書き込みも予定表の更新もしない（200・skipped）",
      off.result.status === 200 &&
        off.result.body.skipped === "mode_off" &&
        off.fetcher.calls.length === 0 &&
        off.db.writes.length === 0 &&
        off.store.completed.length === 0 &&
        off.store.retried.length === 0 &&
        !off.store.calls.some((c) => c.name === "claimSlots"),
      show(off.result.body),
    );
    const none = await runOdds({ rows: {}, slots: [slotOf(RACE_A, -30)] });
    check(
      "ラッパ: 行が無いジョブは off として扱い、行を作るだけ（取得・書き込み・claim なし）",
      none.result.body.skipped === "mode_off" &&
        none.store.state.get("odds")?.mode === "off" &&
        none.fetcher.calls.length === 0 &&
        none.db.writes.length === 0 &&
        !none.store.calls.some((c) => c.name === "claimSlots"),
    );
    const unavailable = await runOdds({
      available: false,
      slots: [slotOf(RACE_A, -30)],
    });
    check(
      "ラッパ: マイグレーション075が未適用なら、何もせず 200（skipped）",
      unavailable.result.status === 200 &&
        unavailable.result.body.skipped === "scrape_schema_not_applied" &&
        unavailable.fetcher.calls.length === 0,
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・HTML_UNPUBLISHED・HTML_ALL_ZERO_VOTES・RACE_A・RACE_B・RACE_C・raceOf・NOW・createFetcher・createFakeDb・findRow・fullRow） */
export async function runScrapeOddsJobScenes3(env) {
  ({ check, show, same, HTML_UNPUBLISHED, HTML_ALL_ZERO_VOTES, RACE_A, RACE_B, RACE_C, raceOf, NOW, createFetcher, createFakeDb, findRow, fullRow } = env);
  await scene1();
  await scene2();
  await scene3();
  await scene4();
  await scene5();
}
