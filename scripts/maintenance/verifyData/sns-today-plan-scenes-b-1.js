/**
 * verify-sns-today-plan.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-plan.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeadlinePreflight, createMockHeadless } from "../../../api/_lib/snsDeadlineQueue.js";
import { sendHolds } from "../../../api/_lib/snsMobileApproval.js";
import { createReadCurrent } from "../../../api/_lib/snsClaimCheck.js";
import { SCREEN_MARKERS } from "../../lib/snsScreenMarkers.js";
import { DATE } from "./sns-today-plan-v3-race-db.js";
import { TODAY_URL, TODAY_NOTICE, todaySchedule } from "../../lib/snsTodayPlanner.js";
import {
  FEATURED_LINE,
  raceDbOf,
  digestOf,
  runSnsTodayPlanScenes3,
  runSnsTodayPlanScenes4,
} from "./sns-today-plan-scenes-1.js";
import { runSnsTodayPlanScenes5 } from "./sns-today-plan-scenes-2.js";

let db, first, all, t, at, sqlStore, EXPECTED_LINES, shooter, plan, approve, stpRb11;

/** test("6:40 に一覧を撮って下書き・item（digest）を作り、本人が承認でき、7:00 に送る job ができる。送る直前の検 の中身を割った 1/3 */
async function stpMain1() {
  const notes = [];
  const saved = [];
  const headless = shooter();
  const result = await plan({ notes, saved, headless });
  const [draft] = await all("SELECT * FROM sns_drafts");
  const [item] = await all("SELECT * FROM sns_auto_send_items");
  assert.equal(result.report.items[0].outcome, "manual");
  assert.deepEqual(headless.inspects, [
    {
      url: TODAY_URL,
      context: { storageState: null },
      requiredSelectors: SCREEN_MARKERS.today,
    },
  ]);
  // 画像: 注目レース＋一覧の締切順、同じレースは1回、最大4枚の龍神ソナーの図（会場R 締切のラベルつき）
  assert.deepEqual(
    headless.calls.map((c) => [c.url, c.element, c.label]),
    [
      [
        `https://www.boat-ai.jp/race/${DATE}-04-12?tab=sonar&boat=1`,
        ".af-hep .af-dark",
        "平和島12R 20:35締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-02-05?tab=sonar&boat=3`,
        ".af-hep .af-dark",
        "戸田5R 13:15締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-04-03?tab=sonar&boat=1`,
        ".af-hep .af-dark",
        "平和島3R 14:15締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-04-05?tab=sonar&boat=1`,
        ".af-hep .af-dark",
        "平和島5R 15:15締切",
      ],
    ],
  );
  // 図の前に待つのは条件のカードだけ（段の表示は展示の後に消える、2026-10-17 夜）。外周の色の検査は ryujin の紺で撮る
  assert.ok(
    headless.calls.every(
      (c) =>
        JSON.stringify([c.requiredSelectors, c.edgeColorVar]) ===
        JSON.stringify([['[data-testid="analogy-fact-card"]'], "--ryujin-navy-600"]),
    ),
  );
  const revision = draft.source_data.digest.revision;
  assert.deepEqual(
    saved.map((x) => x.path),
    [1, 2, 3, 4].map((i) => `today/${DATE}/${revision}-${i}.png`),
  );
  assert.deepEqual(
    draft.source_data.image_paths,
    saved.map((x) => x.path),
  );
  assert.equal(draft.cover_image_path, saved[0].path);
  assert.equal(draft.send_lane, "A");
  assert.equal(draft.publish_blocked, false);
  assert.match(
    draft.caption_text,
    /^本日のデータ一覧（10月17日（土）\u300013会場 156レース）/,
  );
  assert.ok(
    draft.caption_text.includes(
      `）\n\n今日の一覧はこちら：https://www.boat-ai.jp/x/today?d=2037-10-17-a\n\n${FEATURED_LINE}\n\n${EXPECTED_LINES}\n\n過去の実績は当日の結果を保証しません。展示後は進入と展示タイムも確認してください。`,
    ),
    draft.caption_text,
  );
  for (const absent of [
    "イン崩れ",
    "AI",
    "逃がし",
    "フライング",
    "帰郷",
    "逃げ 1｜",
    "逃げ 4｜",
    "まくり 2｜",
    "まくり 4｜",
  ])
    assert.ok(!draft.caption_text.includes(absent), absent);
  return { notes, draft, item };
}

/** test("6:40 に一覧を撮って下書き・item（digest）を作り、本人が承認でき、7:00 に送る job ができる。送る直前の検 の中身を割った 2/3 */
async function stpMain2({ draft, item, notes }) {
  assert.deepEqual(
    draft.source_data.digest.picks.map((p) => p.race_id),
    [
      `${DATE}-04-12`,
      `${DATE}-02-05`,
      `${DATE}-04-03`,
      `${DATE}-04-05`,
      `${DATE}-04-02`,
      `${DATE}-02-07`,
    ],
  );
  // リンクは見出しの直後（3行目）に1回だけ。末尾は注意書き（2026-10-22 オーナー「前倒しで押される形」）
  // utm_content は「日付-札」（実際に送った型、hq §10-5）
  const todayUrl = `https://www.boat-ai.jp/x/today?d=${DATE}-a`;
  const captionLines = draft.caption_text.split("\n");
  assert.equal(captionLines[1], "");
  assert.equal(captionLines[2], `今日の一覧はこちら：${todayUrl}`);
  assert.equal(captionLines[3], "");
  assert.equal(draft.caption_text.split(todayUrl).length, 2);
  assert.ok(draft.caption_text.endsWith(TODAY_NOTICE));
  assert.deepEqual(sendHolds(draft), []);
  assert.deepEqual(
    [
      item.kind,
      item.state,
      item.channel,
      item.race_id,
      item.draft_id,
      item.checks.passed,
    ],
    ["digest", "manual", "x", `today:${DATE}`, draft.id, true],
  );
  const when = todaySchedule(DATE);
  assert.equal(item.notify_by.toISOString(), when.notify_by);
  assert.equal(item.veto_until.toISOString(), when.veto_until);
  const tracking = await first(
    "SELECT * FROM sns_post_tracking WHERE draft_id=$1",
    [draft.id],
  );
  assert.deepEqual(
    [tracking.utm_campaign, tracking.utm_content],
    ["today_digest", `${DATE}-a`],
  );
  assert.equal(
    tracking.tracking_url,
    `${TODAY_URL}?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=${DATE}-a`,
  );
  assert.equal(tracking.utm_source, "x");
  assert.equal(tracking.utm_medium, "social");
  assert.ok(!draft.caption_text.includes("utm_"));
  assert.equal(notes.length, 1);
  // 個別承認の画面は 2026-10-18 に撤去した。manual のときは送らないと知らせる
  assert.match(notes[0], /個別承認（mode=manual）なので送らない/);
  assert.match(
    notes[0],
    /画像1: https:\/\/signed\/today\/[^\n]+-1\.png\n画像2: [^\n]+\n画像3: [^\n]+\n画像4: [^\n]+-4\.png/,
  );
  // 本人の承認 → 7:45 の job
  const job = await approve(draft);
  assert.equal(job.state, "queued");
  assert.equal(new Date(job.scheduled_at).toISOString(), when.scheduled_at);
  assert.equal(job.auto_item_id, item.id);
  // 送る直前の検査: 一覧の版を読み直して一致すれば通る（長文の1投稿の印つき）、変わっていれば止まる
  const readCurrent = (digest, races = raceDbOf()) =>
    createReadCurrent({
      db: async (path) =>
        path.startsWith("sns_drafts")
          ? [{ bundle_import_id: null, source_data: draft.source_data }]
          : races(path),
      getDigest: async () => digest,
    });
  const preflight = (digest, races) =>
    createDeadlinePreflight({
      headless: createMockHeadless({ visibleSelectors: SCREEN_MARKERS.today }),
      markers: SCREEN_MARKERS,
      readCurrent: readCurrent(digest, races),
      now: () => at("07:01").getTime(),
    });
  const sent = { ...job, snapshot_text: JSON.stringify(job.snapshot) };
  await preflight(digestOf())(sent);
  await assert.rejects(preflight(digestOf(24))(sent), /source_changed/);
  return { preflight, sent };
}

/** test("6:40 に一覧を撮って下書き・item（digest）を作り、本人が承認でき、7:00 に送る job ができる。送る直前の検 の中身を割った 3/3 */
async function stpMain3({ preflight, sent }) {
  // 載せた候補が送る前に欠場・中止になったら、その朝の投稿は送らない
  for (const races of [
    raceDbOf({ absent: [`${DATE}-04-03:1`] }),
    raceDbOf({ cancelled: [`${DATE}-02-07`] }),
  ])
    await assert.rejects(
      preflight(digestOf(), races)(sent),
      /race_unconfirmed_or_withdrawn/,
    );
}

/** test("runbook の L2 の SQL（153-runbook.md）を流すと、承認した /today の job が 7:01  の中身を割った 2/2 */
async function stpRb12({ runbook }) {
  const sql = runbook
    .split("<!-- l2-today-sql:start -->")[1]
    .split("<!-- l2-today-sql:end -->")[0]
    .replace(/```sql|```/g, "");
  await db.exec(
    "UPDATE sns_x_send_control SET period_start=NULL, period_end=NULL, reserved_microusd=0, paused=true",
  );
  // 本番の SQL の now() は、この日の 5:40（計画）→ 7:46（送る）の時計で流す
  await db.query("UPDATE test_clock SET value=$1", [at("06:40")]);
  await db.exec(sql.replaceAll("now()", "test_now()"));
  // runbook の期間（2026-10）は、テストの日付（2037 年。実際の時計で期限を判定する部品があるため未来に置く）に合わせて動かす
  await db.exec(
    "UPDATE sns_x_send_control SET period_start = test_now() - interval '1 day', period_end = test_now() + interval '30 days'",
  );
  await plan({ now: at("06:40") });
  const [draft] = await all("SELECT * FROM sns_drafts");
  const job = await approve(draft);
  // 試運転（dry_run=true）の間は claim しない
  await db.exec(
    "UPDATE sns_auto_send_control SET dry_run=true WHERE channel='x'",
  );
  await assert.rejects(
    first("SELECT transition_sns_x_send($1,'claim','{}') r", [job.id]),
    /dry_run/,
  );
  // 手順2（dry_run=false）の後は、7:45 を過ぎたら claim できる
  await db.query("UPDATE test_clock SET value=$1", [at("07:01")]);
  await db.exec(
    "UPDATE sns_auto_send_control SET dry_run=false WHERE channel='x'",
  );
  const claimed = (
    await first("SELECT transition_sns_x_send($1,'claim','{}') r", [job.id])
  ).r;
  assert.equal(claimed.state, "sending", JSON.stringify(claimed));
}

function stpb1Scene1() {
  test("6:40 に一覧を撮って下書き・item（digest）を作り、本人が承認でき、7:00 に送る job ができる。送る直前の検査も通る", async () => {
    const { notes, draft, item } = await stpMain1();
    const { preflight, sent } = await stpMain2({ draft, item, notes });
    await stpMain3({ preflight, sent });
  });
  // ---- 後半の場面（verifyData/sns-today-plan-scenes-1.js） ----
  runSnsTodayPlanScenes3({ first, all, at, sqlStore, shooter, plan, approve });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・t・at・sqlStore・EXPECTED_LINES・shooter・plan・approve・stpRb11） */
export function runSnsTodayPlanScenesB1(env) {
  ({ db, first, all, t, at, sqlStore, EXPECTED_LINES, shooter, plan, approve, stpRb11 } = env);
  stpb1Scene1();
}

function stpb1Scene2() {
  test("runbook の L2 の SQL（153-runbook.md）を流すと、承認した /today の job が 7:01 に claim まで進む。dry_run の間は claim しない", async () => {
    const { runbook } = await stpRb11();
    await stpRb12({ runbook });
  });
  // ---- 後半の場面（verifyData/sns-today-plan-scenes-1.js・sns-today-plan-scenes-2.js） ----
  runSnsTodayPlanScenes4({ first, all, at, sqlStore, shooter, plan, approve });
  runSnsTodayPlanScenes5({ db, all, t, at, shooter, plan, approve });
}

/** verify から呼ぶ入口。env は verify 側の束縛（db・first・all・t・at・sqlStore・EXPECTED_LINES・shooter・plan・approve・stpRb11） */
export function runSnsTodayPlanScenesB2(env) {
  ({ db, first, all, t, at, sqlStore, EXPECTED_LINES, shooter, plan, approve, stpRb11 } = env);
  stpb1Scene2();
}
