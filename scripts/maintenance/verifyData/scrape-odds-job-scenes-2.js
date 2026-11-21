/**
 * verify-scrape-odds-job.js の後半の場面（2/5）。verify ではない。
 * 判定と期待値は分ける前の verify-scrape-odds-job.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import {
  fetchOddsDetailed,
  runForRaces,
  ODDS_SOURCE_VERCEL,
  FULL_ODDS_KEYS,
  isOddsRowComplete,
} from "../../daily/scrape-odds.js";
import { computeOddsDigest } from "../../lib/scrapeJobs/oddsDigest.js";
import { BreakerOpenError } from "../../lib/scrapeJobs/circuitBreaker.js";

let check, show, same, HTML_UNPUBLISHED, DATE, RACE_A, RACE_B, raceOf, NOW, clone, pageOfUrl, createFetcher, createFakeDb, findRow, fullRow;

// ---------------------------------------------------------------------------
// (b) runForRaces
// ---------------------------------------------------------------------------
export const opts = (db, fetchFn, extra = {}) => ({
  date: DATE,
  mode: "live",
  fetchFn,
  client: db,
  concurrency: 4,
  now: () => NOW,
  ...extra,
});

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const pages = (f) => f.calls.map((u) => pageOfUrl(u));
  // 未公開: 単勝ページだけを取って no_values（他のページは取らない）
  let f = createFetcher({ oddstf: HTML_UNPUBLISHED });
  let r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  check(
    "winFirst: 未公開なら、単勝ページ（oddstf）の1リクエストだけで no_values にする（他の4ページは取らない）",
    r.status === "no_values" && r.data === null && same(pages(f), ["oddstf"]),
    show(pages(f)),
  );
  // 従来（winFirst=false）は、未公開でも全ページを取る（変えていない）
  f = createFetcher({ oddstf: HTML_UNPUBLISHED });
  r = await fetchOddsDetailed(DATE, 5, 1, { wantFull: true, fetchFn: f });
  check(
    "winFirst=false（既定）: 従来どおり、未公開でも5ページを並列に取る（通常の取得を変えていない）",
    r.status === "no_values" && f.calls.length === 5,
    show(pages(f)),
  );
  // 公開済み: 単勝を1回だけ取り、残りの4ページを取って、通常の取得と同じ結果になる
  f = createFetcher();
  const first = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  const normal = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    fetchFn: createFetcher(),
  });
  check(
    "winFirst: 公開済みなら、単勝は1回だけ取り（重複して取らない）、計5ページを取って ok。結果（単勝・複勝・全通り系）は通常の取得と同じ",
    first.status === "ok" &&
      f.calls.length === 5 &&
      pages(f).filter((p) => p === "oddstf").length === 1 &&
      same(first.data, normal.data) &&
      same(first.missing, normal.missing),
    show(pages(f)),
  );
  // 一部の券種ページが落ちていれば partial（通常と同じ）
  f = createFetcher({ odds3f: 404 });
  r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  check(
    "winFirst: 公開済みで3連複が404なら partial（通常と同じ。列名つき）",
    r.status === "partial" && same(r.missing, ["trio_all"]),
    show(r.missing),
  );
  // 単勝の失敗・ブレーカー: 他のページを取らない
  f = createFetcher({ oddstf: 500 });
  r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  check(
    "winFirst: 単勝ページが500なら、他のページを取らずに error（HTTPステータスをメッセージに含む）",
    r.status === "error" && /HTTP 500/.test(r.error) && f.calls.length === 1,
    show([r, pages(f)]),
  );
  f = createFetcher({
    oddstf: new BreakerOpenError("host:boatrace.jp", Date.now() + 60000),
  });
  return { pages, f, r };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene2({ pages, f, r }) {
  r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  check(
    "winFirst: ブレーカーが開いていれば、他のページを取らずに breaker_open（retryAt は Date）",
    r.status === "breaker_open" &&
      r.retryAt instanceof Date &&
      f.calls.length === 1,
    show([r, pages(f)]),
  );
  // 通信エラー（reject）: 他のページを取らずに error
  f = createFetcher({ oddstf: new Error("ECONNRESET") });
  r = await fetchOddsDetailed(DATE, 5, 1, {
    wantFull: true,
    winFirst: true,
    fetchFn: f,
  });
  check(
    "winFirst: 単勝が通信エラーなら、他のページを取らずに error",
    r.status === "error" && f.calls.length === 1,
    show([r, pages(f)]),
  );
}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene3() {
  const db = createFakeDb();
  const f = createFetcher();
  const [r] = await runForRaces([raceOf(RACE_A, -30)], opts(db, f));
  const w = db.writes[0];
  const row = findRow(db, RACE_A, -30)[0];
  check(
    "live: 1レース×1窓で、5ページを取得し、1行だけ upsert（onConflict は race_id,window_min）、outcome ok・rowsWritten 1",
    f.calls.length === 5 &&
      db.writes.length === 1 &&
      w.onConflict === "race_id,window_min" &&
      w.count === 1 &&
      r.outcome === "ok" &&
      r.rowsWritten === 1 &&
      r.rowsParsed === 1 &&
      r.rowsExpected === 1,
    show({ calls: f.calls.length, w, r }),
  );
  return { db, r, row };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene4({ db, r, row }) {
  check(
    "live: 行は window_min・source='vercel'・captured_at（now）つきで、基本オッズと全通り5列を1行に持つ",
    row &&
      row.window_min === -30 &&
      row.source === ODDS_SOURCE_VERCEL &&
      row.source === "vercel" &&
      row.captured_at === NOW.toISOString() &&
      row.odds_win_1 > 0 &&
      row.odds_place_1_low > 0 &&
      FULL_ODDS_KEYS.every((k) => row[k]) &&
      isOddsRowComplete(row),
  );
  check(
    "live: 結果の resultDigest は、書いた行から計算した構造のダイジェストと一致する",
    r.resultDigest === computeOddsDigest(row) && same(r.missing, []),
  );
  // 冪等: 同じ窓を、もう一度（重複配信・リース奪取後の二重実行）
  const f2 = createFetcher();
  await runForRaces([raceOf(RACE_A, -30)], opts(db, f2));
  check(
    "冪等: 同じレース×窓を二重に処理しても、行は1つのまま（一意索引の upsert で更新される）",
    findRow(db, RACE_A, -30).length === 1 && db.rows.length === 1,
    show(db.rows.length),
  );
  // 窓ごとに別の行
  await runForRaces([raceOf(RACE_A, -15), raceOf(RACE_A, 0)], opts(db, f2));
  check(
    "窓ごとに別の行（-30・-15・0の3行。旧基盤の window_min=NULL の行とも衝突しない）",
    db.rows.length === 3 &&
      [-30, -15, 0].every((wm) => findRow(db, RACE_A, wm).length === 1),
  );
  check(
    "書き込みの行のキーは、全行で一様（PostgREST の一括 upsert の要件。列の欠けで null 上書きが起きない）",
    db.writes.every((x) => x.uniformKeys),
  );
}

async function scene5() {
  {
    const s1 = await scene1();
    await scene2(s1);
  }
  {
    const s1 = await scene3();
    await scene4(s1);
  }
  {
    // 旧基盤（window_min NULL）の行があっても、新しい行は衝突せず追加される
    const db = createFakeDb([
      fullRow({
        window_min: null,
        source: "gha",
        captured_at: "2026-09-19T04:00:00.000Z",
      }),
      fullRow({
        window_min: null,
        source: "gha",
        captured_at: "2026-09-19T04:30:00.000Z",
      }),
    ]);
    await runForRaces([raceOf(RACE_A, -30)], opts(db, createFetcher()));
    check(
      "旧基盤の行（window_min=NULL、同じ race_id が複数）は、更新も削除もされず、Vercel の行が別に追加される",
      db.rows.length === 3 &&
        db.rows.filter((r) => r.source === "gha").length === 2 &&
        findRow(db, RACE_A, -30).length === 1,
    );
  }
  {
    // shadow
    const db = createFakeDb([fullRow({ window_min: -30 })]);
    const before = clone(db.rows);
    const f = createFetcher();
    const [r] = await runForRaces(
      [raceOf(RACE_A, -30, 2)],
      opts(db, f, { mode: "shadow" }),
    );
    check(
      "shadow: 取得・解析のみ。race_odds へ書かない（書き込み0回・行は不変）、既存行も読まない（再試行でも）",
      db.writes.length === 0 &&
        db.reads.length === 0 &&
        same(db.rows, before) &&
        f.calls.length === 5 &&
        r.outcome === "ok" &&
        r.rowsWritten === 0 &&
        r.rowsParsed === 1 &&
        /^[0-9a-f]{16}$/.test(r.resultDigest),
      show({ writes: db.writes, reads: db.reads.length, r }),
    );
    const live = await runForRaces(
      [raceOf(RACE_B, -30)],
      opts(createFakeDb(), createFetcher()),
    );
    check(
      "shadow: result_digest は、同じページを live で処理した結果と同じ（shadow と live で解析が同じ）",
      live[0].resultDigest === r.resultDigest,
    );
  }
}

async function scene6() {
  {
    // 再試行: 一部のページが失敗 → 次の試行で残りが取れる。既存の値を null で上書きしない
    const db = createFakeDb();
    const [r1] = await runForRaces(
      [raceOf(RACE_A, -30, 1)],
      opts(db, createFetcher({ oddsk: 500 })),
    );
    const row1 = clone(findRow(db, RACE_A, -30)[0]);
    check(
      "partial: 拡連複だけ取れなければ partial（取れた分は書き込み済み・missing に wide_all・再試行の理由を error に）",
      r1.outcome === "partial" &&
        r1.rowsWritten === 1 &&
        same(r1.missing, ["wide_all"]) &&
        /wide_all/.test(r1.error) &&
        row1.wide_all === null &&
        row1.trifecta_all &&
        !isOddsRowComplete(row1),
      show(r1),
    );
    // 再試行（attempts=2）: 今度は3連複・3連単が取れない。拡連複は取れる
    const NOW2 = new Date(NOW.getTime() + 60000);
    const [r2] = await runForRaces(
      [raceOf(RACE_A, -30, 2)],
      opts(db, createFetcher({ odds3f: 500, odds3t: 500 }), { now: () => NOW2 }),
    );
    const row2 = findRow(db, RACE_A, -30)[0];
    check(
      "再試行: 今回取れなかった列（3連複・3連単）は、前回の値を引き継ぎ、null で上書きしない。今回取れた拡連複が加わり、ok になる",
      r2.outcome === "ok" &&
        same(row2.trio_all, row1.trio_all) &&
        same(row2.trifecta_all, row1.trifecta_all) &&
        row2.wide_all &&
        findRow(db, RACE_A, -30).length === 1,
      show(r2),
    );
    check(
      "再試行: 最新の試行の値（captured_at）に更新される",
      row2.captured_at === NOW2.toISOString(),
    );
  }
  {
    // 基本オッズの列も、新しい値が null なら前回の値を引き継ぐ（新しい値が非nullなら新しい値）
    const prior = () =>
      createFakeDb([
        fullRow({
          window_min: -30,
          wide_all: null,
          odds_win_1: 99,
          trifecta_popular_1: "9-9-9",
          trifecta_odds_1: 99,
        }),
      ]);
    // 3連単の人気順は odds3t の全通りから求めるため、odds3t が取れなければ null になる
    const dbNull = prior();
    await runForRaces(
      [raceOf(RACE_A, -30, 2)],
      opts(dbNull, createFetcher({ odds3t: 500 })),
    );
    const rowNull = findRow(dbNull, RACE_A, -30)[0];
    check(
      "再試行: 新しい値が null の基本列は前回の値を引き継ぎ（odds3t が取れず trifecta_popular_1 が null の場合、前回の 9-9-9）、非null の列は新しい値になる（odds_win_1 は 99 ではなく最新の単勝）",
      rowNull.trifecta_popular_1 === "9-9-9" &&
        rowNull.trifecta_odds_1 === 99 &&
        rowNull.odds_win_1 !== 99 &&
        rowNull.odds_win_1 > 0,
      show([rowNull.trifecta_popular_1, rowNull.odds_win_1]),
    );
    const dbNew = prior();
    await runForRaces([raceOf(RACE_A, -30, 2)], opts(dbNew, createFetcher()));
    const rowNew = findRow(dbNew, RACE_A, -30)[0];
    check(
      "再試行: odds3t が取れた場合、trifecta_popular_1・trifecta_odds_1 は前回の値ではなく最新の人気1位（1-2-6・7.6）になる",
      rowNew.trifecta_popular_1 === "1-2-6" && rowNew.trifecta_odds_1 === 7.6,
      show([rowNew.trifecta_popular_1, rowNew.trifecta_odds_1]),
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・show・same・HTML_UNPUBLISHED・DATE・RACE_A・RACE_B・raceOf・NOW・clone・pageOfUrl・createFetcher・createFakeDb・findRow・fullRow） */
export async function runScrapeOddsJobScenes2(env) {
  ({ check, show, same, HTML_UNPUBLISHED, DATE, RACE_A, RACE_B, raceOf, NOW, clone, pageOfUrl, createFetcher, createFakeDb, findRow, fullRow } = env);
  await scene5();
  await scene6();
}
