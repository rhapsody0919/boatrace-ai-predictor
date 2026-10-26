// /today の画像つき X 投稿の計画（sns-pdca-loop tasks 19b、cron sns_auto_plan）の再現テスト。
// SQL158 までを PGlite に入れ（本番と同じ）、下書き・item の作成 → 本人の個別承認 → 送る直前の検査（一覧の版）までを通す。
// 一覧（morning_digest_*）・撮影・Storage はモック。外部接続なし。
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import {
  createDeadlinePreflight,
  createMockHeadless,
} from "../../api/_lib/snsDeadlineQueue.js";
import { sendHolds } from "../../api/_lib/snsMobileApproval.js";
import { createReadCurrent } from "../../api/_lib/snsClaimCheck.js";
import { getJaT } from "../../api/_lib/botPage.js";
import { SCREEN_MARKERS } from "../lib/snsScreenMarkers.js";
import {
  TODAY_NOTICE,
  TODAY_URL,
  createTodayStore,
  runTodayPlan,
  todaySchedule,
} from "../lib/snsTodayPlanner.js";
import { buildCourseWinNotes } from "../../src/utils/todayCourseWin.js";
import {
  normalizeTodayExperiment,
  pickExperimentSide,
} from "../lib/snsTodayVariants.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const PNG = new Uint8Array([137, 80, 78, 71, 1, 2, 3]);
const riskRules = JSON.parse(
  await readFile(
    new URL("../../sns-video-studio/remotion/risk-rules.json", import.meta.url),
    "utf8",
  ),
).rules;
const t = await getJaT();
const DATE = "2037-10-17";
const at = (hhmm) => new Date(`${DATE}T${hhmm}:00+09:00`);
let me;

before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  await db.exec(
    "CREATE TABLE test_clock(value timestamptz); INSERT INTO test_clock VALUES(NULL); CREATE FUNCTION test_now() RETURNS timestamptz LANGUAGE sql AS 'SELECT coalesce(value,now()) FROM test_clock';",
  );
  await db.exec(
    "CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off','shadow','live')));",
  );
  for (const file of [
    "035_sns_marketing_hub_schema.sql",
    "042_content_drafts_columns.sql",
    "135_sns_preview_bundle_import.sql",
    "136_sns_metric_observations.sql",
    "137_sns_x_send.sql",
    "138_sns_external_operations.sql",
    "139_sns_deadline_queue.sql",
    "140_sns_mobile_approval.sql",
    "145_sns_edit_assist.sql",
    "146_sns_shorts_send.sql",
    "147_sns_draft_diff.sql",
    "148_sns_posted_approval_guard.sql",
    "153_sns_auto_send.sql",
    "154_sns_tokens_metric_jobs.sql",
    "158_sns_lanes_digest_period.sql",
    "160_sns_x_multiple_images.sql",
    "163_drop_sns_mobile_approval.sql",
    "174_sns_today_type_schedule.sql",
  ])
    await db.exec(
      (
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        )
      ).replaceAll("now()", "test_now()"),
    );
  me = (await first("SELECT id FROM sns_approvers WHERE display_name='本人'"))
    .id;
});
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_metric_jobs; DELETE FROM sns_post_tracking; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; DELETE FROM sns_today_type_schedule;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE test_clock SET value=NULL;`);
});
after(() => db.close());

// PostgREST の store と同じ契約を SQL で（URL の形は下の別のテストで確かめる）
const sqlStore = {
  async todayState(date) {
    const draft =
      (await first(
        "SELECT * FROM sns_drafts WHERE send_lane='A' AND format='today_digest' AND source_data->'digest'->>'date'=$1 AND status<>'archived' AND source_data->'today_reply' IS NULL",
        [date],
      )) ?? null;
    const reply = draft
      ? await first(
          "SELECT * FROM sns_drafts WHERE source_data->'today_reply'->>'parent_draft_id'=$1 AND status<>'archived'",
          [draft.id],
        )
      : null;
    const itemOf = async (raceId) =>
      (await first(
        "SELECT * FROM sns_auto_send_items WHERE kind='digest' AND race_id=$1",
        [raceId],
      )) ?? null;
    return {
      draft,
      item: await itemOf(`today:${date}`),
      reply: reply
        ? { draft: reply, item: await itemOf(`today:${date}:reply`) }
        : null,
    };
  },
  typeSchedule: (date) =>
    first(
      "SELECT day::text AS day, type_id, post FROM sns_today_type_schedule WHERE day=$1",
      [date],
    ).then((row) => row ?? null),
  insertDraft: (row) =>
    first(
      `INSERT INTO sns_drafts(content_group_id,platform,language,status,format,title,caption_text,hashtags,cover_image_path,
         source_data,publish_blocked,publication_hold_reasons,risk_flags,send_lane,scheduled_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [
        row.content_group_id,
        row.platform,
        row.language,
        row.status,
        row.format,
        row.title,
        row.caption_text,
        row.hashtags,
        row.cover_image_path,
        row.source_data,
        row.publish_blocked,
        JSON.stringify(row.publication_hold_reasons),
        JSON.stringify(row.risk_flags),
        row.send_lane,
        row.scheduled_at,
      ],
    ),
  async updateTodayDraft(id, p) {
    const row = await first(
      // PostgREST の PATCH と同じく、渡した列だけを書く
      `UPDATE sns_drafts SET caption_text=coalesce($2,caption_text),cover_image_path=coalesce($3,cover_image_path),
         source_data=coalesce($4,source_data),risk_flags=coalesce($5,risk_flags),template_variant_id=coalesce($6,template_variant_id),
         publish_blocked=coalesce($7,publish_blocked)
       WHERE id=$1 AND status IN ('pending_review','approved') RETURNING *`,
      [
        id,
        p.caption_text ?? null,
        p.cover_image_path ?? null,
        p.source_data ?? null,
        p.risk_flags === undefined ? null : JSON.stringify(p.risk_flags),
        p.template_variant_id ?? null,
        p.publish_blocked ?? null,
      ],
    );
    if (!row) throw new Error("下書きを書き換えられない");
    return row;
  },
  insertItem: (row) =>
    first(
      `INSERT INTO sns_auto_send_items(kind,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,held_reason)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [
        row.kind,
        row.draft_id,
        row.channel,
        row.race_id,
        row.deadline_at,
        row.notify_by,
        row.veto_until,
        row.state,
        row.checks,
        row.held_reason,
      ],
    ),
  async updateItem(id, from, p) {
    const row = await first(
      `UPDATE sns_auto_send_items SET state=$3,checks=coalesce($4,checks),held_reason=$5,
         notified_at=coalesce($6,notified_at),stop_token_hash=coalesce($7,stop_token_hash) WHERE id=$1 AND state=$2 RETURNING *`,
      [
        id,
        from,
        p.state,
        p.checks ?? null,
        p.held_reason ?? null,
        p.notified_at ?? null,
        p.stop_token_hash ?? null,
      ],
    );
    if (!row) throw new Error("item を更新できない");
    return row;
  },
  control: () =>
    first(
      "SELECT mode, dry_run, auto_approver_id FROM sns_auto_send_control WHERE channel='x'",
    ),
  // PostgREST の rpc と同じく、関数の返り値（job の JSON）を返す
  approve: async (a) =>
    (
      await first("SELECT public.approve_sns_x_send($1,$2,$3,$4) r", [
        a.p_draft_id,
        a.p_approver_id,
        a.p_snapshot,
        a.p_scheduled_at,
      ])
    ).r,
};
const trackingStore = {
  save: (t) =>
    db.query(
      `INSERT INTO sns_post_tracking(draft_id,template_variant_id,race_url,tracking_url,utm_source,utm_medium,utm_campaign,utm_content,release_evidence)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (draft_id) DO NOTHING`,
      [
        t.draft_id,
        t.template_variant_id,
        t.race_url,
        t.tracking_url,
        t.utm_source,
        t.utm_medium,
        t.utm_campaign,
        t.utm_content,
        t.release_evidence,
      ],
    ),
};
// 逃げ: 1位は 7:30 締切（送る 7:45 より前）、4位は全国29走（30走未満）で載せない。2・3・5位を載せる。
// まくり: 1位と2位は同じレース（区分の中は最初の行だけ）、3位を載せて2人まで。逃がし・注目・フライング・帰郷は載せない
const NIGE_TIME = {
  1: "07:45:00",
  2: "16:15:00",
  3: "14:15:00",
  4: "13:45:00",
  5: "15:15:00",
};
const digestOf = (count = 25, prefix = "逃げ") => ({
  day: {
    generated_at: `${DATE}T05:30:27Z`,
    venue_count: 13,
    race_count: 156,
    notes: {},
  },
  rows: [
    {
      section: "featured",
      rank: 1,
      race_id: `${DATE}-04-12`,
      venue_code: 4,
      race_number: 12,
      start_time: "20:35:00",
      reason: "AIが当日条件から算出したイン崩れ指数は…",
      from: "nige",
      course: 1,
      boat_number: 1,
      racer_name: "注目\u30001",
      metric_value: "84.13",
      metric_venue_baseline: "58.40",
      sample_size: 63,
    },
    ...Array.from({ length: count }, (_, i) => ({
      section: "nige",
      rank: i + 1,
      race_id: `${DATE}-04-${String(i + 1).padStart(2, "0")}`,
      venue_code: 4,
      race_number: i + 1,
      start_time: NIGE_TIME[i + 1] ?? "17:15:00",
      racer_name: `${prefix}\u3000${i + 1}`,
      boat_number: 1,
      sample_size: i === 3 ? 29 : 40,
    })).reverse(),
    {
      section: "makuri",
      rank: 1,
      race_id: `${DATE}-02-05`,
      venue_code: 2,
      race_number: 5,
      start_time: "13:15:00",
      racer_name: "まくり\u30001",
      boat_number: 3,
      sample_size: 31,
    },
    {
      section: "makuri",
      rank: 2,
      race_id: `${DATE}-02-05`,
      venue_code: 2,
      race_number: 5,
      start_time: "13:15:00",
      racer_name: "まくり\u30002",
      boat_number: 4,
      sample_size: 35,
    },
    {
      section: "makuri",
      rank: 3,
      race_id: `${DATE}-02-07`,
      venue_code: 2,
      race_number: 7,
      start_time: "18:15:00",
      racer_name: "まくり\u30003",
      boat_number: 2,
      sample_size: 33,
    },
    {
      section: "makuri",
      rank: 4,
      race_id: `${DATE}-02-08`,
      venue_code: 2,
      race_number: 8,
      start_time: "19:15:00",
      racer_name: "まくり\u30004",
      boat_number: 2,
      sample_size: 40,
    },
    {
      section: "nigashi",
      rank: 1,
      race_id: `${DATE}-12-03`,
      venue_code: 12,
      race_number: 3,
      start_time: "20:25:00",
      racer_name: "逃がし\u30001",
      boat_number: 5,
      sample_size: 50,
    },
    { section: "flying", rank: 1, racer_name: "フライング1" },
    { section: "returned", rank: 1, racer_name: "帰郷1" },
  ],
});
const FEATURED_LINE =
  "注目レース：平和島12R 20:35締切｜1号艇 注目 1｜1コースで逃げ切った割合 84.13%（全国63走）・この会場の平均 58.4%";
const EXPECTED_LINES = [
  "［逃げ］全国で1コースに入ったとき逃げ切った割合70%以上の1号艇",
  "［まくり］そのコースでまくりで1着の割合25%以上の選手",
  "",
  "［まくり］戸田5R 13:15締切｜3号艇 まくり 1｜全国31走",
  "［逃げ］平和島3R 14:15締切｜1号艇 逃げ 3｜全国40走",
  "［逃げ］平和島5R 15:15締切｜1号艇 逃げ 5｜全国40走",
  "［逃げ］平和島2R 16:15締切｜1号艇 逃げ 2｜全国40走",
  "［まくり］戸田7R 18:15締切｜2号艇 まくり 3｜全国33走",
].join("\n");
// 出走表・中止の読み取り（PostgREST の形）。absent は "race_id:艇番"、cancelled は race_id
function raceDbOf({ absent = [], cancelled = [], missing = [] } = {}) {
  return async (path) => {
    const ids = decodeURIComponent(path)
      .match(/in\.\(([^)]*)\)/)[1]
      .split(",")
      .map((x) => x.replaceAll('"', ""));
    if (path.startsWith("races"))
      return ids
        .filter((id) => !missing.includes(id))
        .map((race_id) => ({
          race_id,
          start_time: "14:15:00",
          cancellation_status: cancelled.includes(race_id) ? "confirmed" : null,
        }));
    return absent
      .map((key) => key.split(":"))
      .filter(([id]) => ids.includes(id))
      .map(([race_id, boat]) => ({
        race_id,
        boat_number: Number(boat),
        is_absent: true,
      }));
  };
}
// /today の確認（inspect）と、レースの龍神ソナーの図（screenshot）。notReady の race_id は図が無い（元データの作成前）
function shooter({ fail = false, notReady = [], todayMissing = false } = {}) {
  const calls = [];
  const inspects = [];
  return {
    calls,
    inspects,
    async inspect(request) {
      inspects.push(request);
      return {
        finalUrl: request.url,
        visibleSelectors: todayMissing ? [] : request.requiredSelectors,
      };
    },
    async screenshot(request) {
      calls.push(request);
      if (fail || notReady.some((id) => request.url.includes(id)))
        throw new Error("screenshot_component_missing");
      // 図ごとに中身の違う画像（hash で区別できるように）
      return {
        finalUrl: request.url,
        png: new Uint8Array([...PNG, calls.length]),
        visibleSelectors: request.requiredSelectors,
      };
    },
  };
}
async function plan({
  now = at("07:40"),
  mode = "live",
  digest = digestOf(),
  headless = shooter(),
  notes = [],
  saved = [],
  raceDb = raceDbOf(),
  nowMs,
  reviewDate,
  loadVariants,
} = {}) {
  return runTodayPlan(
    { mode, now: () => now },
    {
      store: sqlStore,
      getDigest: async (date) => {
        assert.equal(date, DATE);
        return digest;
      },
      raceDb,
      t,
      headless,
      markers: SCREEN_MARKERS,
      riskRules,
      trackingStore,
      saveImage: async (path, bytes) => saved.push({ path, bytes }),
      signImage: async (path) => `https://signed/${path}`,
      notify: async (text) => notes.push(text),
      ...(nowMs ? { nowMs } : {}),
      ...(reviewDate ? { reviewDate } : {}),
      ...(loadVariants ? { loadVariants } : {}),
    },
  );
}
const loadMedia = async () => PNG;
// 本人の承認（個別承認の RPC は 163 で削除。承認そのものの approve_sns_x_send を使う）
async function approve(draft) {
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      draft.id,
      me,
      await createXSnapshot(draft, loadMedia),
      draft.scheduled_at,
    ])
  ).r;
}

test("7:40 に一覧を撮って下書き・item（digest）を作り、本人が承認でき、8:00 に送る job ができる。送る直前の検査も通る", async () => {
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
        `https://www.boat-ai.jp/race/${DATE}-04-12?tab=sonar`,
        ".af-hep .af-dark",
        "平和島12R 20:35締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-02-05?tab=sonar`,
        ".af-hep .af-dark",
        "戸田5R 13:15締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-04-03?tab=sonar`,
        ".af-hep .af-dark",
        "平和島3R 14:15締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-04-05?tab=sonar`,
        ".af-hep .af-dark",
        "平和島5R 15:15締切",
      ],
    ],
  );
  // 図の前に待つのは条件のカードだけ（段の表示は展示の後に消える、2026-10-17 夜）
  assert.ok(
    headless.calls.every(
      (c) =>
        JSON.stringify(c.requiredSelectors) ===
        JSON.stringify(['[data-testid="analogy-fact-card"]']),
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
      `）\n\n今日の一覧はこちら：https://www.boat-ai.jp/today?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=2037-10-17-a\n\n${FEATURED_LINE}\n\n${EXPECTED_LINES}\n\n過去の実績は当日の結果を保証しません。展示後は進入と展示タイムも確認してください。`,
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
  const todayUrl = `${TODAY_URL}?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=${DATE}-a`;
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
      now: () => at("08:01").getTime(),
    });
  const sent = { ...job, snapshot_text: JSON.stringify(job.snapshot) };
  await preflight(digestOf())(sent);
  await assert.rejects(preflight(digestOf(24))(sent), /source_changed/);
  // 載せた候補が送る前に欠場・中止になったら、その朝の投稿は送らない
  for (const races of [
    raceDbOf({ absent: [`${DATE}-04-03:1`] }),
    raceDbOf({ cancelled: [`${DATE}-02-07`] }),
  ])
    await assert.rejects(
      preflight(digestOf(), races)(sent),
      /race_unconfirmed_or_withdrawn/,
    );
});

test("同じ一覧でもう一度走らせても何も書かない。一覧がやり直されたら撮り直し、承認を外して知らせる", async () => {
  await plan();
  const [before] = await all("SELECT * FROM sns_drafts");
  const job = await approve(before);
  const notes = [];
  const again = await plan({ now: at("07:50"), notes });
  assert.equal(again.report.items[0].outcome, "unchanged");
  assert.equal(notes.length, 0);
  const rebuilt = await plan({ now: at("08:10"), digest: digestOf(24), notes });
  assert.equal(rebuilt.report.items[0].outcome, "rebuilt");
  const [after] = await all("SELECT * FROM sns_drafts");
  assert.equal(after.id, before.id);
  assert.notEqual(
    after.source_data.digest.revision,
    before.source_data.digest.revision,
  );
  assert.equal(
    after.source_data.deadline_queue.source_revision,
    after.source_data.digest.revision,
  );
  assert.equal(after.status, "pending_review");
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE id=$1", [job.id]))
      .state,
    "cancelled",
  );
  assert.match(notes[0], /承認し直して/);
  assert.equal(
    (await all("SELECT * FROM sns_auto_send_items"))[0].state,
    "manual",
  );
});

test("7:30 より前・一覧が未公開は何もしない。9:00 以降に下書きが無ければ missed。shadow は撮らず書かない", async () => {
  assert.equal(
    (await plan({ now: at("07:29") })).report.items[0].reason,
    "outside_window",
  );
  assert.deepEqual(
    (({ outcome, reason }) => ({ outcome, reason }))(
      (await plan({ now: at("09:00") })).report.items[0],
    ),
    { outcome: "missed", reason: "no_draft_by_send_time" },
  );
  assert.equal(
    (await plan({ digest: { day: { generated_at: null }, rows: [] } })).report
      .items[0].reason,
    "not_generated",
  );
  const headless = shooter();
  const notes = [];
  const shadow = await plan({ mode: "shadow", headless, notes });
  assert.equal(shadow.report.items[0].outcome, "manual");
  assert.equal(headless.calls.length, 0);
  assert.equal(notes.length, 0);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
});

test("撮れなければ何も書かずに投げる（次の5分でやり直す）", async () => {
  const saved = [];
  await assert.rejects(
    plan({ headless: shooter({ fail: true }), saved }),
    /sonar_not_ready/,
  );
  await assert.rejects(
    plan({ headless: shooter({ todayMissing: true }), saved }),
    /today_page_not_ready/,
  );
  assert.equal(saved.length, 0);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  assert.equal((await all("SELECT * FROM sns_auto_send_items")).length, 0);
});

test("本文に禁止表現があれば held_manual。その後に一覧が変わっても作り直さない", async () => {
  const notes = [];
  await plan({ digest: digestOf(25, "競艇"), notes });
  const [item] = await all("SELECT * FROM sns_auto_send_items");
  assert.equal(item.state, "held_manual");
  assert.match(item.held_reason, /禁止表現/);
  assert.match(notes[0], /禁止表現があり、止めた/);
  const again = await plan({
    now: at("08:10"),
    digest: digestOf(24, "競艇"),
  });
  assert.equal(again.report.items[0].reason, "item_held_manual");
});

test("PostgREST の store: 今日の下書き・item の引き方、承認済みも書き換える条件、失敗は投げる", async () => {
  const calls = [];
  const fetchImpl = async (url, options = {}) => {
    calls.push({
      url: decodeURIComponent(String(url)),
      method: options.method ?? "GET",
    });
    if (String(url).includes("fail")) return new Response("", { status: 500 });
    if (options.method === "PATCH" && String(url).includes("none"))
      return new Response("[]");
    return new Response(JSON.stringify([{ id: "1" }]));
  };
  const store = createTodayStore({ url: "https://db", key: "k", fetchImpl });
  await store.todayState(DATE);
  assert.ok(
    calls.some((c) =>
      c.url.includes(
        `sns_drafts?send_lane=eq.A&format=eq.today_digest&source_data->digest->>date=eq.${DATE}`,
      ),
    ),
  );
  assert.ok(
    calls.some((c) =>
      c.url.includes(
        `sns_auto_send_items?kind=eq.digest&race_id=in.("today:${DATE}","today:${DATE}:reply")`,
      ),
    ),
  );
  // 型の列（174）はその日の1行
  await store.typeSchedule(DATE);
  assert.ok(
    calls
      .at(-1)
      .url.endsWith(
        `sns_today_type_schedule?day=eq.${DATE}&select=day,type_id,post`,
      ),
  );
  await store.updateTodayDraft("d1", {});
  assert.ok(
    calls
      .at(-1)
      .url.endsWith("sns_drafts?id=eq.d1&status=in.(pending_review,approved)"),
  );
  await assert.rejects(store.updateTodayDraft("none", {}), /書き換えられない/);
  await assert.rejects(
    createTodayStore({ url: "https://fail", key: "k", fetchImpl }).todayState(
      DATE,
    ),
    /HTTP 500/,
  );
});

test("vercel.json: sns-auto-plan の関数に /today の文言（ja の common.json）を同梱する", async () => {
  const vercel = JSON.parse(
    await readFile(new URL("../../vercel.json", import.meta.url), "utf8"),
  );
  assert.match(
    vercel.functions["api/cron/sns-auto-plan.js"].includeFiles,
    /src\/locales\/ja\/common\.json/,
  );
});

test("runbook の L2 の SQL（153-runbook.md）を流すと、承認した /today の job が 8:01 に claim まで進む。dry_run の間は claim しない", async () => {
  const runbook = await readFile(
    new URL("../../docs/db-migration/153-runbook.md", import.meta.url),
    "utf8",
  );
  const sql = runbook
    .split("<!-- l2-today-sql:start -->")[1]
    .split("<!-- l2-today-sql:end -->")[0]
    .replace(/```sql|```/g, "");
  await db.exec(
    "UPDATE sns_x_send_control SET period_start=NULL, period_end=NULL, reserved_microusd=0, paused=true",
  );
  // 本番の SQL の now() は、この日の 5:40（計画）→ 7:46（送る）の時計で流す
  await db.query("UPDATE test_clock SET value=$1", [at("07:40")]);
  await db.exec(sql.replaceAll("now()", "test_now()"));
  // runbook の期間（2026-10）は、テストの日付（2037 年。実際の時計で期限を判定する部品があるため未来に置く）に合わせて動かす
  await db.exec(
    "UPDATE sns_x_send_control SET period_start = test_now() - interval '1 day', period_end = test_now() + interval '30 days'",
  );
  await plan({ now: at("07:40") });
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
  await db.query("UPDATE test_clock SET value=$1", [at("08:01")]);
  await db.exec(
    "UPDATE sns_auto_send_control SET dry_run=false WHERE channel='x'",
  );
  const claimed = (
    await first("SELECT transition_sns_x_send($1,'claim','{}') r", [job.id])
  ).r;
  assert.equal(claimed.state, "sending", JSON.stringify(claimed));
});

test("下書きを作った後に item の作成で落ちても、次の実行で item を作る（同じ版でも「変化なし」で止まらない）", async () => {
  const insertItem = sqlStore.insertItem;
  sqlStore.insertItem = async () => {
    throw new Error("item を作れない");
  };
  await assert.rejects(plan(), /item を作れない/);
  sqlStore.insertItem = insertItem;
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 1);
  assert.equal((await all("SELECT * FROM sns_auto_send_items")).length, 0);
  const again = await plan({ now: at("07:45") });
  assert.equal(again.report.items[0].outcome, "manual");
  const [item] = await all("SELECT * FROM sns_auto_send_items");
  assert.equal(item.state, "manual");
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 1);
});

test("一覧の読み取り: /today の投稿は選手名・枠番を足して読み、ボット向け HTML の読み取りは選手の値を取らないまま", async () => {
  const { createTodayDigestSource } =
    await import("../../api/_lib/snsTodayDigest.js");
  const { createDigestSource } = await import("../../api/_lib/botToday.js");
  const urls = [];
  const fetchImpl = async (url) => {
    urls.push(decodeURIComponent(String(url)));
    return Response.json(String(url).includes("morning_digest_days") ? [] : []);
  };
  const env = { SUPABASE_URL: "https://db", SUPABASE_ANON_KEY: "anon" };
  await createTodayDigestSource({ fetchImpl, env })(DATE);
  await createDigestSource({ fetchImpl, env })(DATE);
  const rows = urls.filter((u) => u.includes("morning_digest_rows"));
  assert.match(
    rows[0],
    // course は逃がしの2号艇・3号艇を分けるためにボット向けの ROW_SELECT に足した（2037-10-15）
    /select=section,rank,race_id,venue_code,race_number,start_time,course,reason:detail->>reason,racer_name,boat_number,sample_size,metric_value,metric_venue_baseline,from:detail->>from&/,
  );
  assert.ok(!rows[1].includes("racer_name"));
});

test("欠場・中止・締切を確かめられない候補は除き、区分の上限まで後ろの rank から補う", async () => {
  await plan({
    raceDb: raceDbOf({
      absent: [`${DATE}-04-03:1`],
      cancelled: [`${DATE}-02-05`],
      missing: [`${DATE}-04-05`],
    }),
  });
  const [draft] = await all("SELECT * FROM sns_drafts");
  for (const gone of ["逃げ 3｜", "逃げ 5｜", "まくり 1｜"])
    assert.ok(!draft.caption_text.includes(gone), gone);
  // 逃げは 2位・6位・7位（13:00）、まくりは 3位・4位
  assert.ok(
    draft.caption_text.includes(
      "［逃げ］平和島6R 17:15締切｜1号艇 逃げ 6｜全国40走",
    ),
    draft.caption_text,
  );
  assert.ok(
    draft.caption_text.includes(
      "［まくり］戸田8R 19:15締切｜2号艇 まくり 4｜全国40走",
    ),
  );
  assert.equal(draft.source_data.digest.picks.length, 6);
});

test("区分が1つだけの日も印の意味を書き、印を付ける（割合は一覧のしきい値）。候補が0件の日は下書きを作らず送らない", async () => {
  const onlyNige = digestOf();
  onlyNige.rows = onlyNige.rows.filter(
    (r) => r.section !== "makuri" && r.section !== "featured",
  );
  onlyNige.day.notes = { thresholds: { nige: 72, makuri: 25 } };
  await plan({ digest: onlyNige });
  const [draft] = await all("SELECT * FROM sns_drafts");
  assert.ok(
    draft.caption_text.includes(
      "\n\n［逃げ］全国で1コースに入ったとき逃げ切った割合72%以上の1号艇\n\n［逃げ］平和島3R 14:15締切｜1号艇 逃げ 3｜全国40走\n［逃げ］平和島5R 15:15締切｜1号艇 逃げ 5｜全国40走\n［逃げ］平和島2R 16:15締切｜1号艇 逃げ 2｜全国40走\n\n過去の実績は",
    ),
    draft.caption_text,
  );
  assert.ok(!draft.caption_text.includes("まくり"));

  await db.exec(
    "DELETE FROM sns_post_tracking; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );
  const none = digestOf();
  // 一覧の候補が全員30走未満で、注目レースも無い日
  none.rows = none.rows
    .filter((r) => r.section !== "featured")
    .map((r) => ({ ...r, sample_size: 29 }));
  const notes = [];
  const result = await plan({ digest: none, notes });
  assert.equal(result.report.items[0].reason, "no_candidates");
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  assert.equal(notes.length, 0);
});

test("注目レース: 先頭に置き一覧に重ねない。逃がしからの注目・8:00 より前・欠場の注目は載せない", async () => {
  const { buildTodayPost } = await import("../lib/snsTodayPlanner.js");
  const url = "https://www.boat-ai.jp/today";
  const build = (mutate, excluded = new Set()) => {
    const digest = digestOf();
    const featured = digest.rows.find((r) => r.section === "featured");
    mutate(featured, digest);
    return buildTodayPost(digest, { date: DATE, t, url, excluded });
  };
  // 一覧の逃げ3位と同じ選手が注目なら、一覧からは外して次の順位で補う
  const same = build((f) =>
    Object.assign(f, {
      race_id: `${DATE}-04-03`,
      race_number: 3,
      start_time: "14:15:00",
      racer_name: "逃げ\u30003",
    }),
  );
  assert.match(same.text, /注目レース：平和島3R 14:15締切｜1号艇 逃げ 3｜/);
  assert.equal(same.text.split("逃げ 3｜").length - 1, 1);
  assert.match(same.text, /［逃げ］平和島6R 17:15締切｜1号艇 逃げ 6｜/);
  // まくりからの注目は、まくりの言い方
  const makuri = build((f) =>
    Object.assign(f, {
      from: "makuri",
      course: 3,
      boat_number: 3,
      metric_value: "30.00",
    }),
  );
  assert.match(
    makuri.text,
    /｜3号艇 注目 1｜3コースでまくりで1着の割合 30%（全国63走）/,
  );
  for (const text of [
    build((f) => Object.assign(f, { from: "nigashi" })).text,
    build((f) => Object.assign(f, { start_time: "07:55:00" })).text,
    build(() => {}, new Set([`${DATE}-04-12:1`])).text,
    build((f, d) => {
      d.rows = d.rows.filter((r) => r !== f);
    }).text,
  ])
    assert.ok(!text.includes("注目レース"), text);
  // 一覧が0件でも、注目レースがあれば送る
  const onlyFeatured = build((f, d) => {
    d.rows = d.rows.filter((r) => r === f || r.section === "flying");
  });
  assert.match(
    onlyFeatured.text,
    /^本日のデータ一覧（[^\n]+）\n\n今日の一覧はこちら：[^\n]+\n\n注目レース：[^\n]+\n\n過去の実績[^\n]+$/,
  );
  assert.deepEqual(onlyFeatured.picks, [
    { race_id: `${DATE}-04-12`, boat_number: 1 },
  ]);
});

test("龍神ソナーの図がそろわないうちは 8:30 までやり直し、8:30 を過ぎたら撮れた分で作る", async () => {
  const saved = [];
  const notReady = [`${DATE}-02-05`];
  await assert.rejects(
    plan({ now: at("08:00"), headless: shooter({ notReady }), saved }),
    /sonar_not_ready（2037-10-17-02-05: screenshot_component_missing）/,
  );
  assert.equal(saved.length, 0);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  await plan({ now: at("08:35"), headless: shooter({ notReady }), saved });
  const [draft] = await all("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.image_paths.length, 3);
  // 本人の承認（160）は3枚の媒体で通る
  const job = await approve(draft);
  assert.equal(job.snapshot.media.length, 3);
  assert.ok(job.snapshot.media.every((m) => m.type === "image/png"));
});

test("160: X の画像は image_paths の数・順・種類とそろったときだけ承認できる。image_paths の無い下書きは今までどおり1つ", async () => {
  await plan();
  const [draft] = await all("SELECT * FROM sns_drafts");
  const snapshot = await createXSnapshot(draft, loadMedia);
  assert.equal(snapshot.media.length, 4);
  const tryApprove = (snap) =>
    db.query("SELECT approve_sns_x_send($1,$2,$3,NULL)", [draft.id, me, snap]);
  for (const [bad, why] of [
    [
      { ...snapshot, media: snapshot.media.slice(0, 3) },
      /画像の数・並びが不正です/,
    ],
    [
      {
        ...snapshot,
        media: [
          snapshot.media[1],
          snapshot.media[0],
          ...snapshot.media.slice(2),
        ],
      },
      /媒体のhash・サイズが不正です/,
    ],
    [
      {
        ...snapshot,
        media: snapshot.media.map((m, i) =>
          i === 2 ? { ...m, type: "video/mp4" } : m,
        ),
      },
      /媒体のhash・サイズが不正です/,
    ],
    [
      {
        ...snapshot,
        media: snapshot.media.map((m, i) =>
          i === 3 ? { ...m, size: 6_000_000 } : m,
        ),
      },
      /媒体のhash・サイズが不正です/,
    ],
  ])
    await assert.rejects(tryApprove(bad), why);
  // 5枚は作れない（image_paths が4枚を超える下書きは承認しない）
  await db.exec(
    "ALTER TABLE sns_drafts DISABLE TRIGGER USER; UPDATE sns_drafts SET source_data = jsonb_set(source_data, '{image_paths}', (source_data->'image_paths') || '[\"x/5.png\"]'::jsonb) WHERE id=$1; ALTER TABLE sns_drafts ENABLE TRIGGER USER;".replaceAll(
      "$1",
      `'${draft.id}'`,
    ),
  );
  await assert.rejects(tryApprove(snapshot), /画像の数・並びが不正です/);
  // image_paths の無い X の下書き（今までの1枚）は、今までどおり承認できる
  await db.exec(
    "ALTER TABLE sns_drafts DISABLE TRIGGER USER; UPDATE sns_drafts SET source_data = source_data - 'image_paths'; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );
  const [single] = await all("SELECT * FROM sns_drafts");
  const one = await createXSnapshot(single, loadMedia);
  assert.equal(one.media.length, 1);
  const job = (
    await first("SELECT approve_sns_x_send($1,$2,$3,NULL) r", [
      single.id,
      me,
      one,
    ])
  ).r;
  assert.equal(job.state, "queued");
});

test("各回の結果をその日の分だけ cursor に残す（送る時刻を過ぎても朝の経過を読める）。時間外は残さず、日付が変わったら空から、最新30件", async () => {
  const { nextTodayLog } = await import("../lib/snsTodayPlanner.js");
  let log = nextTodayLog(
    null,
    { outcome: "error", reason: "sonar_not_ready（x）" },
    at("07:50"),
  );
  log = nextTodayLog(log, { outcome: "manual", item_id: "i1" }, at("08:35"));
  log = nextTodayLog(
    log,
    { outcome: "skipped", reason: "outside_window" },
    at("09:10"),
  );
  assert.deepEqual(log, {
    date: DATE,
    events: [
      {
        at: at("07:50").toISOString(),
        outcome: "error",
        reason: "sonar_not_ready（x）",
      },
      { at: at("08:35").toISOString(), outcome: "manual", reason: null },
    ],
  });
  const next = nextTodayLog(
    log,
    { outcome: "error", reason: "x" },
    new Date(at("07:50").getTime() + 86400000),
  );
  assert.equal(next.events.length, 1);
  let many = null;
  for (let i = 0; i < 35; i++)
    many = nextTodayLog(
      many,
      { outcome: "error", reason: String(i) },
      at("07:50"),
    );
  assert.equal(many.events.length, 30);
  assert.equal(many.events.at(-1).reason, "34");
});

test("確認用の作り直しが3回続けて失敗したら、Slack に1回知らせてやめる。理由はブラウザのログを除いた1行ずつ（2026-10-17 夜、届かずに5分ごとに失敗し続けた）", async () => {
  const { finishTodayLog, isTodayRebuild, REBUILD_MAX_FAILURES } =
    await import("../lib/snsTodayPlanner.js");
  assert.equal(REBUILD_MAX_FAILURES, 3);
  // 作り直しは、その日の分で送る時刻を過ぎた後だけ
  assert.equal(isTodayRebuild(DATE, at("20:25")), true);
  assert.equal(isTodayRebuild(DATE, at("07:40")), false);
  assert.equal(isTodayRebuild("2037-10-16", at("20:25")), false);
  assert.equal(isTodayRebuild(null, at("20:25")), false);
  const crash = {
    outcome: "error",
    reason: `sonar_not_ready（${DATE}-04-07: browserContext.newPage: Target page, context or browser has been closed\nBrowser logs:\n\n<launching> /tmp/chromium ${"--flag ".repeat(80)} / ${DATE}-10-04: browser.newContext: Target page, context or browser has been closed）`,
  };
  let log = { date: DATE, events: [], missed_notified: true };
  const results = [];
  for (const hhmm of ["20:25", "20:30", "20:35"]) {
    const r = finishTodayLog(log, crash, at(hhmm), { rebuilding: true });
    results.push(r);
    log = r.log;
  }
  assert.deepEqual(
    results.map((r) => [r.giveUp, r.notice === null]),
    [
      [false, true],
      [false, true],
      [true, false],
    ],
  );
  assert.match(
    results[2].notice,
    /確認用の作り直しが3回続けて失敗したので、やめた/,
  );
  // 理由はブラウザのログを含まず、2レース分が残る
  const reason = log.events.at(-1).reason;
  assert.doesNotMatch(reason, /Browser logs|launching/);
  assert.match(reason, new RegExp(`${DATE}-10-04: browser.newContext`));
  assert.ok(reason.length < 400, reason.length);
  // 知らせた後は数え直し、朝の「作れなかった」の印は残す
  assert.equal(log.rebuild_failures, undefined);
  assert.equal(log.missed_notified, true);
  // 作り直しでない回の失敗は数えない
  assert.equal(
    finishTodayLog(null, crash, at("07:40")).log.rebuild_failures,
    undefined,
  );
});

test("下書きを作れずに 9:00 を過ぎたら、理由つきで Slack に1回だけ知らせる文を出す。下書きがあれば出さない（2026-10-17 黙って終わった件）", async () => {
  const { finishTodayLog, nextTodayLog } =
    await import("../lib/snsTodayPlanner.js");
  // 朝は図がそろわずやり直し続け、7:45 を過ぎた
  let log = nextTodayLog(
    null,
    {
      outcome: "error",
      reason:
        "sonar_not_ready（2037-10-17-04-07: screenshot_component_missing）",
    },
    at("08:20"),
  );
  const late = (await plan({ now: at("09:05") })).report.items[0];
  assert.equal(late.outcome, "missed");
  const first = finishTodayLog(log, late, at("09:05"));
  assert.match(
    first.notice,
    /SNS \/today（2037-10-17）: 09:00 までに下書きを作れなかった。今日は送らない/,
  );
  assert.match(
    first.notice,
    /最後の結果（08:20）: error sonar_not_ready（2037-10-17-04-07: screenshot_component_missing）（朝の記録 1件）/,
  );
  // 知らせた後（missed_notified を保存）は、その日はもう出さない。次の日は改めて出す
  first.log.missed_notified = true;
  const again = finishTodayLog(first.log, late, at("09:10"));
  assert.equal(again.notice, null);
  assert.equal(again.log.missed_notified, true);
  const nextDay = finishTodayLog(
    again.log,
    late,
    new Date(at("09:05").getTime() + 86400000),
  );
  assert.match(nextDay.notice, /朝の実行が一度も最後まで終わっていない/);
  // 朝の記録が無い（関数の時間切れで何も残らない）日も、その旨を出す
  assert.match(
    finishTodayLog(null, late, at("09:05")).notice,
    /関数の時間切れなど/,
  );
  // 下書きがあれば missed にならず、何も出さない
  await plan({ now: at("07:50") });
  const ok = (await plan({ now: at("09:05") })).report.items[0];
  assert.equal(ok.reason, "outside_window");
  assert.equal(finishTodayLog(null, ok, at("09:05")).notice, null);
});

test("撮影は開始から120秒を過ぎたら新しく撮らない（関数の時間切れで何も残らないのを避ける）", async () => {
  let ms = 0;
  const headless = shooter();
  const slow = {
    ...headless,
    screenshot: async (r) => {
      ms += 70_000;
      return headless.screenshot(r);
    },
  };
  await assert.rejects(
    plan({ now: at("08:00"), headless: slow, nowMs: () => ms }),
    /sonar_not_ready（2037-10-17-04-03: time_budget \/ 2037-10-17-04-05: time_budget）/,
  );
  assert.equal(headless.calls.length, 2);
  // 7:00 を過ぎていれば、撮れた2枚で作る
  ms = 0;
  await plan({ now: at("08:35"), headless: slow, nowMs: () => ms });
  const [draft] = await all("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.image_paths.length, 2);
});

test("確認用の作り直し（cursor.today_rebuild）: 送る時刻を過ぎても、その日の下書きと図を1回作る。承認はできない。別の日付なら作らない", async () => {
  const notes = [];
  const other = await plan({ now: at("13:30"), reviewDate: "2037-10-16" });
  assert.equal(other.report.items[0].outcome, "missed");
  const result = await plan({ now: at("13:30"), reviewDate: DATE, notes });
  const item = result.report.items[0];
  assert.deepEqual(
    [item.outcome, item.review, item.written],
    ["manual", true, true],
  );
  const [draft] = await all("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.image_paths.length, 4);
  assert.match(
    notes[0],
    /確認用に今日の下書きを作り直した（送る時刻を過ぎているので、承認・送信はできない）/,
  );
  // 期限（8:15）を過ぎているので、承認の条件で止まる（送られない）
  assert.ok(
    sendHolds(draft).includes("期限失効") ||
      Date.now() < Date.parse(draft.source_data.deadline_queue.expires_at),
  );
});

test("mode=auto（2026-10-18 オーナー決定: /today も承認なし）: 下書きを作ったら item を notified にし、自動送信の承認者で 8:00 の job を作る。一覧がやり直されたら作り直して承認し直す", async () => {
  await db.exec(
    "UPDATE sns_auto_send_control SET mode='auto' WHERE channel='x'",
  );
  try {
    const notes = [];
    const first1 = await plan({ notes });
    assert.equal(first1.report.items[0].outcome, "notified");
    const item = await first("SELECT * FROM sns_auto_send_items");
    assert.equal(item.state, "notified");
    assert.ok(item.notified_at && /^[a-f0-9]{64}$/.test(item.stop_token_hash));
    const auto = (
      await first(
        "SELECT auto_approver_id FROM sns_auto_send_control WHERE channel='x'",
      )
    ).auto_approver_id;
    const job = await first("SELECT * FROM sns_x_send_jobs");
    assert.equal(job.state, "queued");
    assert.equal(job.approver_id, auto);
    assert.equal(job.auto_item_id, item.id);
    assert.equal(job.scheduled_at.toISOString(), at("08:00").toISOString());
    assert.ok(notes.some((n) => /08:00 に自動で送る/.test(n)));
    assert.ok(notes.some((n) => /paused = true/.test(n)));
    // 一覧がやり直されたら（版が変わる）、notified でも作り直して承認し直す
    const again = await plan({
      now: at("07:45"),
      digest: digestOf(24),
    });
    assert.equal(again.report.items[0].outcome, "rebuilt");
    const after = await first("SELECT * FROM sns_auto_send_items");
    assert.equal(after.state, "notified");
    const job2 = await first("SELECT * FROM sns_x_send_jobs");
    assert.equal(job2.state, "queued");
  } finally {
    await db.exec(
      "UPDATE sns_auto_send_control SET mode='manual' WHERE channel='x'",
    );
  }
});

test("送る時刻（2026-10-19 オーナー決定: 毎朝 8:00 ごろ）: 8:00 より前に作れば 8:00、遅れて作れば作った時刻。失効は 9:30、締切は 10:00", async () => {
  const { todaySchedule } = await import("../lib/snsTodayPlanner.js");
  assert.deepEqual(todaySchedule(DATE, at("07:40")), {
    plan_from: at("07:30").toISOString(),
    latest: at("09:00").toISOString(),
    scheduled_at: at("08:00").toISOString(),
    deadline_at: at("10:00").toISOString(),
    notify_by: at("07:30").toISOString(),
    veto_until: at("08:00").toISOString(),
    expires_at: at("09:30").toISOString(),
  });
  // 図を 8:30 まで待って 8:40 に作った日は、8:40 に送る
  await plan({ now: at("08:40") });
  const draft = await first("SELECT * FROM sns_drafts");
  const item = await first("SELECT * FROM sns_auto_send_items");
  assert.equal(draft.scheduled_at.toISOString(), at("08:40").toISOString());
  assert.equal(item.veto_until.toISOString(), at("08:40").toISOString());
  assert.equal(item.notify_by.toISOString(), at("07:30").toISOString());
  assert.equal(item.deadline_at.toISOString(), at("10:00").toISOString());
  assert.equal(
    draft.source_data.deadline_queue.expires_at,
    at("09:30").toISOString(),
  );
});

test("見出しの日替わり（2026-10-20）: 1行目だけが案の文になり、札は source_data.today_variant と tracking に残る（uuid が無い間は null）", async () => {
  const variants = {
    default: "本日のデータ一覧（{date}）",
    variants: [
      { id: "a", uuid: null, heading: "今日のデータ（{date}）" },
      { id: "b", uuid: null, heading: "今日のデータ（{date}）" },
    ],
  };
  await plan({ loadVariants: () => variants });
  const draft = await first("SELECT * FROM sns_drafts");
  const lines = draft.caption_text.split("\n");
  assert.match(lines[0], /^今日のデータ（/);
  // 2行目以降は今までどおり（注目レース・印・一覧・注意書き・URL）
  assert.match(draft.caption_text, /注目レース：/);
  assert.equal(draft.source_data.today_variant.uuid, null);
  assert.ok(["a", "b"].includes(draft.source_data.today_variant.id));
  const tracking = await first(
    "SELECT template_variant_id FROM sns_post_tracking WHERE draft_id=$1",
    [draft.id],
  );
  assert.equal(tracking.template_variant_id, null);
});

test("見出しの日替わり: 案の uuid が入っていれば（sns_template_variants の行がある）tracking の template_variant_id にも入る", async () => {
  const id = "0f88824e-c630-4f94-8c15-475297e4b242";
  await db.query(
    "INSERT INTO sns_template_variants(id, format, variant_name, composition_name) VALUES($1,'today_digest','today-heading-a','TodayDigestX') ON CONFLICT DO NOTHING",
    [id],
  );
  const same = { id: "a", uuid: id, heading: "今日のデータ（{date}）" };
  await plan({
    loadVariants: () => ({
      default: "本日のデータ一覧（{date}）",
      variants: [same, { ...same, id: "b" }],
    }),
  });
  const draft = await first("SELECT * FROM sns_drafts");
  const tracking = await first(
    "SELECT template_variant_id FROM sns_post_tracking WHERE draft_id=$1",
    [draft.id],
  );
  assert.equal(tracking.template_variant_id, id);
  assert.equal(draft.source_data.today_variant.uuid, id);
  // 管理画面の観測の比較は下書きの template_variant_id を読む（代わりの審査の P2）
  assert.equal(draft.template_variant_id, id);
});

test("見出しの日替わり: 案の uuid の行が sns_template_variants に無いときは、札なしで tracking を保存し、下書き・item は作る（/code-review の指摘）", async () => {
  const missing = "99999999-9999-4999-8999-999999999999";
  const same = { id: "a", uuid: missing, heading: "今日のデータ（{date}）" };
  const result = await plan({
    loadVariants: () => ({
      default: "本日のデータ一覧（{date}）",
      variants: [same, { ...same, id: "b" }],
    }),
  });
  assert.equal(result.report.items[0].outcome, "manual");
  const draft = await first("SELECT * FROM sns_drafts");
  const tracking = await first(
    "SELECT template_variant_id FROM sns_post_tracking WHERE draft_id=$1",
    [draft.id],
  );
  assert.equal(tracking.template_variant_id, null);
  assert.equal(draft.template_variant_id, null);
  assert.equal(draft.source_data.today_variant.uuid, missing);
  assert.ok(await first("SELECT id FROM sns_auto_send_items"));
});

test("見出しの日替わり: tracking の保存が一時的な失敗（HTTP 503）なら札なしで保存し直さず投げ、次の回にやり直す（代わりの審査の P3）", async () => {
  const id = "0f88824e-c630-4f94-8c15-475297e4b242";
  await db.query(
    "INSERT INTO sns_template_variants(id, format, variant_name, composition_name) VALUES($1,'today_digest','today-heading-a','TodayDigestX') ON CONFLICT DO NOTHING",
    [id],
  );
  const same = { id: "a", uuid: id, heading: "今日のデータ（{date}）" };
  const variants = () => ({
    default: "本日のデータ一覧（{date}）",
    variants: [same, { ...same, id: "b" }],
  });
  const save = trackingStore.save;
  const saved = [];
  trackingStore.save = async (row) => {
    saved.push(row.template_variant_id);
    throw new Error("UTM の保存に失敗: HTTP 503");
  };
  try {
    await assert.rejects(plan({ loadVariants: variants }), /HTTP 503/);
  } finally {
    trackingStore.save = save;
  }
  // 札なしで保存し直していない
  assert.deepEqual(saved, [id]);
  // 次の回は札つきで保存できる
  await plan({ now: at("07:45"), loadVariants: variants });
  const draft = await first("SELECT * FROM sns_drafts");
  const tracking = await first(
    "SELECT template_variant_id FROM sns_post_tracking WHERE draft_id=$1",
    [draft.id],
  );
  assert.equal(tracking.template_variant_id, id);
});

test("171: /today の見出しの2案の行を入れる。もう一度当てても増えない。入れた後は案の uuid で tracking・下書きに札が入る", async () => {
  const sql = await readFile(
    new URL(
      "../../docs/db-migration/171_sns_today_heading_variants.sql",
      import.meta.url,
    ),
    "utf8",
  );
  // 本番の sns_template_variants は 039 で created_by を足している（この試験の土台は 039 を当てていない）
  await db.exec(
    "ALTER TABLE sns_template_variants ADD COLUMN IF NOT EXISTS created_by VARCHAR(10) NOT NULL DEFAULT 'human'",
  );
  await db.exec(
    "DELETE FROM sns_post_tracking; DELETE FROM sns_template_variants WHERE format='today_digest'",
  );
  // 同じ名前で別の id の行が先にあると、黙って成功せず全体を戻す（代わりの審査の P3）
  await db.exec(
    "INSERT INTO sns_template_variants(id, format, variant_name, composition_name) VALUES('11111111-1111-4111-8111-111111111111','today_digest','today-heading-a','X')",
  );
  await assert.rejects(db.exec(sql), /既存の行が食い違う/);
  // ファイルの BEGIN の中で落ちたので、psql と同じく戻す（db-apply は接続を閉じてトランザクション全体が戻る）
  await db.exec("ROLLBACK");
  await db.exec(
    "DELETE FROM sns_template_variants WHERE format='today_digest'",
  );
  await db.exec(sql);
  await db.exec(sql);
  const rows = await all(
    "SELECT id, variant_name, active FROM sns_template_variants WHERE format='today_digest' ORDER BY variant_name",
  );
  assert.deepEqual(
    rows.map((r) => [r.id, r.variant_name, r.active]),
    [
      ["0f88824e-c630-4f94-8c15-475297e4b242", "today-heading-a", true],
      ["be74c247-fa8f-442e-a29f-4d1d7866919a", "today-heading-b", true],
    ],
  );
  // 入れた後に config の uuid を入れると、札が tracking・下書きに入る
  const variants = {
    default: "本日のデータ一覧（{date}）",
    variants: [
      { id: "a", uuid: rows[0].id, heading: "本日のデータ一覧（{date}）" },
      { id: "b", uuid: rows[1].id, heading: "本日のデータ一覧（{date}）" },
    ],
  };
  await plan({ loadVariants: () => variants });
  const draft = await first("SELECT * FROM sns_drafts");
  assert.ok(rows.some((r) => r.id === draft.template_variant_id));
  // リポジトリの config の案 a・b の uuid は、171 が入れた行の id と同じ（2026-10-20 に本番へ適用済み）
  const config = JSON.parse(
    await readFile(
      new URL("../../config/today-variants.json", import.meta.url),
      "utf8",
    ),
  );
  // b は型 b（course_win、2026-10-27）に替えたので、見出しの案 b の行（171）の札は付けない（別の中身に同じ札を付けない）
  assert.deepEqual(
    config.variants.map((v) => [v.id, v.uuid]),
    [
      ["a", rows[0].id],
      ["b", null],
    ],
  );
});
// ---------- PD02: 型の列（174）とリンクの置き場（2026-10-25 hq の依頼） ----------
const TYPE_VARIANTS = {
  default: "本日のデータ一覧（{date}）",
  // 返信の型は reply_enabled の間だけ（費用の線はオーナーの判断。リポジトリの config は false）
  reply_enabled: true,
  variants: [
    {
      id: "a",
      uuid: null,
      type_id: "today-a",
      heading: "本日のデータ一覧（{date}）",
    },
    {
      id: "b",
      uuid: null,
      type_id: "today-a",
      heading: "本日のデータ一覧（{date}）",
    },
  ],
};
const putType = (day, typeId, post) =>
  db.query(
    "INSERT INTO sns_today_type_schedule(day, type_id, post) VALUES($1,$2,$3)",
    [day, typeId, post],
  );
const linkAt = (caption) =>
  caption.split("\n").findIndex((l) => l.includes(TODAY_URL));
const clearAll = () =>
  db.exec(`
    DELETE FROM sns_metric_jobs; DELETE FROM sns_post_tracking; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; DELETE FROM sns_today_type_schedule;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;`);
const withAuto = async (fn) => {
  await db.exec(
    "UPDATE sns_auto_send_control SET mode='auto' WHERE channel='x'",
  );
  try {
    await fn();
  } finally {
    await db.exec(
      "UPDATE sns_auto_send_control SET mode='manual' WHERE channel='x'",
    );
  }
};

test("型の列: その日の行があれば見出し・リンクの前の文・置き場がその型になり、型の id を source_data.content_type に書く", async () => {
  await putType(DATE, "t03-conclusion-heading", {
    heading: "今日いちばん偏った数字は（{date}）",
    link_lead: "一覧はこちら→",
    link_position: "end",
  });
  const result = await plan({ loadVariants: () => TYPE_VARIANTS });
  const draft = await first("SELECT * FROM sns_drafts");
  const lines = draft.caption_text.split("\n");
  assert.match(lines[0], /^今日いちばん偏った数字は（/);
  // 末尾はリンクの1行（注意書きの後）
  assert.equal(linkAt(draft.caption_text), lines.length - 1);
  assert.ok(lines.at(-1).startsWith("一覧はこちら→https://"));
  assert.equal(lines.at(-3), TODAY_NOTICE);
  const ct = draft.source_data.content_type;
  assert.deepEqual(
    [ct.id, ct.source, ct.side, ct.fallback_reason],
    ["t03-conclusion-heading", "schedule", "b", undefined],
  );
  assert.equal(result.report.items[0].content_type, "t03-conclusion-heading");
  // 列の型の日は見出しの a・b の札を付けない（札と文面の食い違いで a・b の比較を汚さない。x-channel の審査 P1）
  assert.deepEqual(draft.source_data.today_variant, {
    id: "schedule",
    uuid: null,
  });
  assert.equal(draft.template_variant_id, null);
});

test("型の列: 行が無い日・作れない項目がある日・壊れた日・表が無い日は config の案で送り、理由を残す（止めない）", async () => {
  const cases = [
    [null, "no_schedule_row"],
    [
      { heading: "見出し（{date}）", thumb: "早見表" },
      "type_unsupported:thumb",
    ],
    [{ heading: "日付なし" }, "heading_invalid"],
    [
      { heading: "見出し（{date}）", link_position: "middle" },
      "link_position_invalid",
    ],
  ];
  for (const [post, reason] of cases) {
    await clearAll();
    if (post) await putType(DATE, "t09-test", post);
    const result = await plan({ loadVariants: () => TYPE_VARIANTS });
    assert.equal(result.report.items[0].outcome, "manual", reason);
    const draft = await first("SELECT * FROM sns_drafts");
    const ct = draft.source_data.content_type;
    assert.deepEqual(
      [ct.id, ct.source, ct.fallback_reason],
      ["today-a", "config", reason],
    );
    // 今の型（リンクは見出しの直後、3行目）
    assert.equal(linkAt(draft.caption_text), 2);
    assert.equal(result.report.items[0].type_fallback, reason);
  }
  // 表が無い（174 の適用前。PostgREST は 404）
  await clearAll();
  const typeSchedule = sqlStore.typeSchedule;
  sqlStore.typeSchedule = async () => {
    throw new Error(
      "/today の計画の DB 操作に失敗: HTTP 404 GET sns_today_type_schedule",
    );
  };
  try {
    await plan({ loadVariants: () => TYPE_VARIANTS });
  } finally {
    sqlStore.typeSchedule = typeSchedule;
  }
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(
    draft.source_data.content_type.fallback_reason,
    "schedule_unavailable",
  );
});

test("型の列: 下書きができた後は列が変わってもその日の型を変えない（作り直しでも同じ型）", async () => {
  await putType(DATE, "t04-question-heading", {
    heading: "今日いちばん荒れそうな場は？（{date}）",
  });
  await plan({ loadVariants: () => TYPE_VARIANTS });
  await db.exec(
    `UPDATE sns_today_type_schedule SET type_id='t03-conclusion-heading', post='{"heading":"別の見出し（{date}）"}'`,
  );
  const again = await plan({
    now: at("08:10"),
    digest: digestOf(24),
    loadVariants: () => TYPE_VARIANTS,
  });
  assert.equal(again.report.items[0].outcome, "rebuilt");
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.content_type.id, "t04-question-heading");
  assert.match(draft.caption_text, /^今日いちばん荒れそうな場は？/);
});

test("返信（link_position=reply、mode=auto）: 本文にリンクを置かず、リンクだけの子の下書き・item を作り、親の job につないで自動で承認する。子は親の公開の後に選ばれる", async () => {
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await withAuto(async () => {
    const notes = [];
    const result = await plan({ notes, loadVariants: () => TYPE_VARIANTS });
    assert.equal(result.report.items[0].outcome, "notified");
    const state = await sqlStore.todayState(DATE);
    const { draft: parent, item } = state;
    const { draft: child, item: childItem } = state.reply;
    assert.equal(linkAt(parent.caption_text), -1);
    assert.ok(!parent.caption_text.includes("今日の一覧はこちら"));
    assert.equal(
      child.caption_text,
      `今日の一覧はこちら：${parent.source_data.deadline_queue.public_url}`,
    );
    assert.equal(child.source_data.today_reply.parent_draft_id, parent.id);
    assert.equal(child.source_data.image_paths, undefined);
    assert.equal(child.cover_image_path, null);
    assert.equal(child.source_data.content_type.id, "t01-link-in-reply");
    assert.equal(child.publish_blocked, false);
    assert.equal(result.report.items[0].reply_draft_id, child.id);
    assert.deepEqual([item.state, childItem.state], ["notified", "notified"]);
    assert.equal(childItem.race_id, `today:${DATE}:reply`);
    const parentJob = await first(
      "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
      [parent.id],
    );
    const childJob = await first(
      "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
      [child.id],
    );
    assert.equal(childJob.parent_job_id, parentJob.id);
    assert.equal(childJob.auto_item_id, childItem.id);
    assert.equal(
      childJob.scheduled_at.toISOString(),
      parentJob.scheduled_at.toISOString(),
    );
    assert.ok(
      notes.some((n) => n.includes("（自分への返信）今日の一覧はこちら：")),
    );
    // 送信の runner は親が posted の子だけを選ぶ
    const { pickDueJobs } = await import("../lib/snsSendRunner.js");
    assert.deepEqual(
      pickDueJobs([parentJob, childJob], [parentJob]).map((j) => j.id),
      [parentJob.id],
    );
    assert.deepEqual(
      pickDueJobs(
        [childJob],
        [{ ...parentJob, state: "posted", external_post_id: "123" }],
      ).map((j) => j.id),
      [childJob.id],
    );
    // 子の送る直前の検査（一覧の版の読み直し）は親と同じに通る
    const sent = {
      ...childJob,
      snapshot_text: JSON.stringify(childJob.snapshot),
    };
    await createDeadlinePreflight({
      headless: createMockHeadless({ visibleSelectors: SCREEN_MARKERS.today }),
      markers: SCREEN_MARKERS,
      readCurrent: createReadCurrent({
        db: async (path) =>
          path.startsWith("sns_drafts")
            ? [{ bundle_import_id: null, source_data: child.source_data }]
            : raceDbOf()(path),
        getDigest: async () => digestOf(),
      }),
      now: () => at("08:01").getTime(),
    })(sent);
    // 同じ版でもう一度走らせても何も書かない
    const again = await plan({
      now: at("07:50"),
      loadVariants: () => TYPE_VARIANTS,
    });
    assert.equal(again.report.items[0].outcome, "unchanged");
    // 一覧がやり直されたら、親も子も作り直して、同じ親の job につなぎ直す
    const rebuilt = await plan({
      now: at("07:55"),
      digest: digestOf(24),
      loadVariants: () => TYPE_VARIANTS,
    });
    assert.equal(rebuilt.report.items[0].outcome, "rebuilt");
    const child2 = await first("SELECT * FROM sns_drafts WHERE id=$1", [
      child.id,
    ]);
    assert.equal(child2.status, "approved");
    assert.equal(
      child2.source_data.digest.revision,
      rebuilt.report.items[0].revision,
    );
    const childJob2 = await first(
      "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
      [child.id],
    );
    assert.equal(childJob2.state, "queued");
    assert.equal(childJob2.parent_job_id, parentJob.id);
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 2);
  });
});

test("返信: 子の下書きの後に落ちて子の item が無いときは、同じ版でも「変化なし」で止まらず子の item を作る", async () => {
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await withAuto(async () => {
    const insertItem = sqlStore.insertItem;
    sqlStore.insertItem = async (row) => {
      if (row.race_id.endsWith(":reply")) throw new Error("item を作れない");
      return insertItem(row);
    };
    try {
      await assert.rejects(
        plan({ loadVariants: () => TYPE_VARIANTS }),
        /item を作れない/,
      );
    } finally {
      sqlStore.insertItem = insertItem;
    }
    const again = await plan({
      now: at("07:45"),
      loadVariants: () => TYPE_VARIANTS,
    });
    // 親の item はあるので作り直しの扱い（子の item を作り、親から順に承認する）
    assert.equal(again.report.items[0].outcome, "rebuilt");
    const items = await all(
      "SELECT race_id, state FROM sns_auto_send_items ORDER BY race_id",
    );
    assert.deepEqual(
      items.map((i) => i.state),
      ["notified", "notified"],
    );
    assert.equal((await all("SELECT * FROM sns_drafts")).length, 2);
  });
});

test("返信: 子の承認に落ちたら、親の item も held_manual にして送らない（リンクの無い親だけを出さない。x-channel の審査 P2）", async () => {
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await withAuto(async () => {
    const approveFn = sqlStore.approve;
    let calls = 0;
    sqlStore.approve = async (a) => {
      calls += 1;
      if (calls === 2) throw new Error("子の承認に失敗");
      return approveFn(a);
    };
    try {
      const result = await plan({ loadVariants: () => TYPE_VARIANTS });
      assert.match(result.report.items[0].reason, /子の承認に失敗/);
    } finally {
      sqlStore.approve = approveFn;
    }
    const items = await all(
      "SELECT race_id, state FROM sns_auto_send_items ORDER BY race_id",
    );
    assert.deepEqual(
      items.map((i) => i.state),
      ["held_manual", "held_manual"],
    );
  });
});

test("返信: 個別承認（mode=manual）の日は返信を選べず、config の案（リンクは見出しの直後）で送る。理由は reply_not_allowed", async () => {
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await plan({ loadVariants: () => TYPE_VARIANTS });
  const drafts = await all("SELECT * FROM sns_drafts");
  assert.equal(drafts.length, 1);
  assert.equal(linkAt(drafts[0].caption_text), 2);
  assert.deepEqual(
    [
      drafts[0].source_data.content_type.id,
      drafts[0].source_data.content_type.fallback_reason,
    ],
    ["today-a", "reply_not_allowed"],
  );
});

test("返信: 子の文に禁止表現があれば、親も held_manual にして承認しない", async () => {
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_lead: "必ず当たる一覧→",
    link_position: "reply",
  });
  await withAuto(async () => {
    const result = await plan({ loadVariants: () => TYPE_VARIANTS });
    assert.equal(result.report.items[0].outcome, "held_manual");
    const items = await all("SELECT state FROM sns_auto_send_items");
    assert.deepEqual(
      items.map((i) => i.state),
      ["held_manual", "held_manual"],
    );
    assert.equal((await all("SELECT * FROM sns_x_send_jobs")).length, 0);
  });
});

test("PostgREST の store: 親と返信の下書きを分けて返す（返信は source_data.today_reply.parent_draft_id）", async () => {
  const fetchImpl = async (url) =>
    Response.json(
      String(url).includes("sns_drafts")
        ? [
            { id: "c", source_data: { today_reply: { parent_draft_id: "p" } } },
            { id: "p", source_data: {} },
          ]
        : [
            { id: "i1", race_id: `today:${DATE}`, draft_id: "p" },
            { id: "i2", race_id: `today:${DATE}:reply`, draft_id: "c" },
          ],
    );
  const state = await createTodayStore({
    url: "https://db",
    key: "k",
    fetchImpl,
  }).todayState(DATE);
  assert.deepEqual(
    [state.draft.id, state.item.id, state.reply.draft.id, state.reply.item.id],
    ["p", "i1", "c", "i2"],
  );
});
test("返信: 返信の型を引き継いだ作り直しで自動でなくなっていたら（mode を manual に戻した）、親も子も held_manual にして送らない（/code-review の指摘）", async () => {
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await withAuto(() => plan({ loadVariants: () => TYPE_VARIANTS }));
  // withAuto の後は mode=manual。一覧がやり直されて作り直す
  const rebuilt = await plan({
    now: at("07:55"),
    digest: digestOf(24),
    loadVariants: () => TYPE_VARIANTS,
  });
  assert.equal(rebuilt.report.items[0].outcome, "rebuilt");
  const items = await all(
    "SELECT race_id, state, held_reason FROM sns_auto_send_items ORDER BY race_id",
  );
  assert.deepEqual(
    items.map((i) => i.state),
    ["held_manual", "held_manual"],
  );
  assert.match(items[0].held_reason, /自動（mode=auto）の日だけ/);
  const parent = (await sqlStore.todayState(DATE)).draft;
  assert.equal(linkAt(parent.caption_text), -1);
});

test("返信: 自動の承認に落ちて item を戻せなかったら、握りつぶさず知らせる", async () => {
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await withAuto(async () => {
    const approveFn = sqlStore.approve;
    const updateItem = sqlStore.updateItem;
    sqlStore.approve = async () => {
      throw new Error("承認に失敗");
    };
    sqlStore.updateItem = async (id, from, p) => {
      if (p.state === "held_manual") throw new Error("戻せない");
      return updateItem(id, from, p);
    };
    try {
      const notes = [];
      const result = await plan({ notes, loadVariants: () => TYPE_VARIANTS });
      assert.match(result.report.items[0].reason, /承認に失敗.*を戻せない/);
      assert.ok(notes.some((n) => /を戻せない/.test(n)));
    } finally {
      sqlStore.approve = approveFn;
      sqlStore.updateItem = updateItem;
    }
  });
});
test("返信: 送信の側（158・153 の transition）で、親の claim → 公開 → 子の claim が通る。子の予約も URL つきの額（system-architect の審査 P2-4）", async () => {
  const runbook = await readFile(
    new URL("../../docs/db-migration/153-runbook.md", import.meta.url),
    "utf8",
  );
  const sql = runbook
    .split("<!-- l2-today-sql:start -->")[1]
    .split("<!-- l2-today-sql:end -->")[0]
    .replace(/```sql|```/g, "");
  await db.exec(
    "UPDATE sns_x_send_control SET period_start=NULL, period_end=NULL, reserved_microusd=0, paused=true",
  );
  await db.query("UPDATE test_clock SET value=$1", [at("07:40")]);
  await db.exec(sql.replaceAll("now()", "test_now()"));
  await db.exec(
    "UPDATE sns_x_send_control SET period_start = test_now() - interval '1 day', period_end = test_now() + interval '30 days', daily_limit_x = 2",
  );
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await withAuto(async () => {
    await db.exec(
      "UPDATE sns_auto_send_control SET dry_run=false WHERE channel='x'",
    );
    try {
      await plan({ loadVariants: () => TYPE_VARIANTS });
      const state = await sqlStore.todayState(DATE);
      const parentJob = await first(
        "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
        [state.draft.id],
      );
      const childJob = await first(
        "SELECT * FROM sns_x_send_jobs WHERE draft_id=$1",
        [state.reply.draft.id],
      );
      await db.query("UPDATE test_clock SET value=$1", [at("08:01")]);
      const claim = async (id) =>
        (await first("SELECT transition_sns_x_send($1,'claim','{}') r", [id]))
          .r;
      const parent = await claim(parentJob.id);
      assert.equal(parent.state, "sending", JSON.stringify(parent));
      await first("SELECT transition_sns_x_send($1,'begin_post','{}') r", [
        parentJob.id,
      ]);
      const done = (
        await first("SELECT transition_sns_x_send($1,'complete',$2) r", [
          parentJob.id,
          { id: "1234567890", posted_at: at("08:01").toISOString() },
        ])
      ).r;
      assert.equal(done.state, "posted", JSON.stringify(done));
      const child = await claim(childJob.id);
      assert.equal(child.state, "sending", JSON.stringify(child));
      // 子の予約も URL つきの額（thread_index=0）。親子で2本分
      const control = await first(
        "SELECT reserved_microusd::bigint r FROM sns_x_send_control",
      );
      assert.equal(Number(control.r), 500000);
    } finally {
      await db.exec(
        "UPDATE sns_auto_send_control SET dry_run=true WHERE channel='x'",
      );
    }
  });
});
test("返信: 子を親につないだ後、子の承認の前に関数が落ちた（子は pending_review・job なし）ら、同じ版でも作り直して子を承認する（Codex の審査 P1）", async () => {
  await putType(DATE, "t01-link-in-reply", {
    heading: "本日のデータ一覧（{date}）",
    link_position: "reply",
  });
  await withAuto(async () => {
    await plan({ loadVariants: () => TYPE_VARIANTS });
    const { reply } = await sqlStore.todayState(DATE);
    // 落ちた状態を作る: 子の job が無く、子の下書きは承認前（parent_job_id は入っている）
    await db.query("DELETE FROM sns_x_send_jobs WHERE draft_id=$1", [
      reply.draft.id,
    ]);
    await db.query(
      "UPDATE sns_drafts SET status='pending_review', approver_id=NULL, approved_at=NULL, x_approved_hash=NULL WHERE id=$1",
      [reply.draft.id],
    );
    const again = await plan({
      now: at("07:45"),
      loadVariants: () => TYPE_VARIANTS,
    });
    assert.notEqual(again.report.items[0].outcome, "unchanged");
    const job = await first(
      "SELECT state, parent_job_id FROM sns_x_send_jobs WHERE draft_id=$1",
      [reply.draft.id],
    );
    assert.equal(job.state, "queued");
    assert.ok(job.parent_job_id);
  });
});

// ---------- 型 b（v2「今日走る選手のコース別1着率」、hq 2026-10-27 オーナー決定） ----------
const CW_BASE = [
  ["A1", 1, 16129, 11456],
  ["A2", 1, 13822, 8353],
  ["B1", 1, 19169, 7685],
  ["A1", 4, 11658, 1867],
  ["A2", 4, 11845, 1474],
];
/** 朝の一覧の notes.courseWin（buildCourseWinNotes で作る。生成と同じ関数） */
function courseWinOf() {
  const races = [
    [`${DATE}-04-12`, 4, 12, "16:14:00"],
    [`${DATE}-24-10`, 24, 10, "19:36:00"],
    [`${DATE}-22-12`, 22, 12, "16:40:00"],
    [`${DATE}-06-12`, 6, 12, "16:23:00"],
    // 締切が送る時刻より前のレースは載せない
    [`${DATE}-01-01`, 1, 1, "07:50:00"],
  ].map(([race_id, venue_code, race_number, start_time]) => ({
    race_id,
    venue_code,
    race_number,
    start_time,
  }));
  const entries = [
    [`${DATE}-04-12`, 1, 1001, "A1", "高橋\u3000竜矢"],
    [`${DATE}-24-10`, 1, 1002, "A1", "西村\u3000\u3000拓也"],
    [`${DATE}-22-12`, 1, 1003, "A2", "上田\u3000龍星"],
    [`${DATE}-06-12`, 4, 1004, "A2", "山下\u3000大輝"],
    [`${DATE}-01-01`, 1, 1005, "A1", "早朝\u3000一郎"],
  ].map(([race_id, boat_number, racer_id, grade, player_name]) => ({
    race_id,
    boat_number,
    racer_id,
    grade,
    player_name,
  }));
  const w = { window_start: "2025-12-02", window_end: "2037-10-15" };
  const rows = [
    ...CW_BASE.map(([grade, course, runs, wins]) => ({
      scope: "grade",
      grade,
      course,
      runs,
      wins,
      ...w,
    })),
    ...[
      [1001, 1, 47, 42],
      [1002, 1, 56, 47],
      [1003, 1, 42, 33],
      [1004, 4, 45, 14],
      [1005, 1, 60, 58],
    ].map(([racer_id, course, runs, wins]) => ({
      scope: "racer",
      racer_id,
      course,
      runs,
      wins,
      off_frame_runs: 0,
      ...w,
    })),
  ];
  return buildCourseWinNotes({
    races,
    entries,
    rpcRows: rows,
    until: "2037-10-15",
  });
}
const withCourseWin = (courseWin = courseWinOf()) => {
  const d = digestOf();
  return { ...d, day: { ...d.day, notes: { ...d.day.notes, courseWin } } };
};
/** DATE が型 b の日になる比べの設定（組の1日目か2日目かは乱数で決まるので、b になる方を選ぶ） */
function abVariants() {
  const base = {
    default: "本日のデータ一覧（{date}）",
    variants: [
      {
        id: "a",
        uuid: null,
        type_id: "today-a",
        heading: "本日のデータ一覧（{date}）",
      },
      {
        id: "b",
        uuid: null,
        type_id: "today-b-course-win",
        body: "course_win",
        heading: "【今日の注目データ】{date}",
      },
    ],
  };
  for (const start of [DATE, "2037-10-16"]) {
    const experiment = { id: "t-ab", start, pairs: 10, seed: "verify" };
    if (
      pickExperimentSide(normalizeTodayExperiment(experiment), DATE).side ===
      "b"
    )
      return { ...base, experiment };
  }
  throw new Error("b の日を作れない");
}
/** 撮影用のページ（指紋の印が出る）と /today・ソナーの図 */
/**
 * 撮影用のページ（指紋の印が出る）と /today・ソナーの図。pageKey を渡すと、ページはその指紋を出す（計画の指紋と違えば、
 * 本物の snsHeadless と同じく待つ印が見えず screenshot_component_missing）
 */
function sheetShooter({ sheetFails = false, pageKey = null } = {}) {
  const inner = shooter();
  return {
    ...inner,
    async screenshot(request) {
      if (request.url.includes("/share/today-sheet")) {
        inner.calls.push(request);
        if (sheetFails) throw new Error("screenshot_component_missing");
        if (
          pageKey &&
          !request.requiredSelectors.includes(
            `[data-today-sheet-key="${pageKey}"]`,
          )
        )
          throw new Error("screenshot_component_missing");
        return { finalUrl: request.url, png: new Uint8Array([...PNG, 9]) };
      }
      return inner.screenshot(request);
    },
  };
}
const clearDrafts = () =>
  db.exec(
    "DELETE FROM sns_post_tracking; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items; ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;",
  );

test("型 b: b の日は本文が「N回中M回。」の型、画像は撮影用のページ1枚（指紋の一致が条件）、札は b、K・線を記録し、自動の承認で job ができる", async () => {
  const headless = sheetShooter();
  const saved = [];
  const notes = [];
  await withAuto(async () => {
    const result = await plan({
      digest: withCourseWin(),
      headless,
      saved,
      notes,
      loadVariants: abVariants,
    });
    assert.equal(result.report.items[0].outcome, "notified");
  });
  const draft = await first("SELECT * FROM sns_drafts");
  const url = `${TODAY_URL}?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=${DATE}-b`;
  // 並べは縮めた値−級の平均。1コースの1行目（本文の人）は高橋（A1 42/47）。名前の全角の空白は半角1つにそろう
  assert.equal(
    draft.caption_text,
    [
      "47回中42回。",
      "",
      "今日の平和島12R、1号艇 高橋 竜矢が",
      "1コースに入ったときに1着になった数。",
      // 正確な二項の上側確率 0.0025 がその日の1コースの候補3人の Bonferroni の水準 0.025/3 を下回った日だけ、差を書く
      "A1級の全国平均 71% を上回る。",
      "",
      "今日走る選手のコース別1着率を1枚に。",
      "締切前に見返すなら保存を。",
      "",
      `全レースの一覧 → ${url}`,
      "※過去の数字です #ボートレース",
    ].join("\n"),
  );
  const sd = draft.source_data;
  assert.equal(sd.content_type.sent, "b");
  assert.equal(sd.content_type.body, "course_win");
  assert.equal(sd.content_type.id, "today-b-course-win");
  assert.equal(sd.content_type.experiment, "t-ab");
  assert.deepEqual(sd.image_paths, [
    `today/${DATE}/${sd.digest.revision}-sheet.png`,
  ]);
  assert.equal(draft.cover_image_path, sd.image_paths[0]);
  // 締切が 8:00 より前の 早朝 一郎 は K に入らない。1コース 3人・4コース 1人
  assert.deepEqual(sd.course_win.k, { c1: 3, c4: 1 });
  assert.equal(sd.course_win.claim, true);
  assert.ok(sd.course_win.tail < 0.025 / 3);
  assert.ok(Math.abs(sd.course_win.line - 2.394) < 1e-3);
  assert.equal(sd.course_win.featured.racer_id, 1001);
  assert.deepEqual(
    sd.digest.picks.map((p) => p.race_id).sort(),
    [`${DATE}-04-12`, `${DATE}-06-12`, `${DATE}-22-12`, `${DATE}-24-10`].sort(),
  );
  // 撮影用のページ: 渡すのは日付・送る時刻だけ。指紋が計画と同じときだけ撮れる。ソナーの図は撮らない
  const sheetCall = headless.calls.find((c) => c.url.includes("today-sheet"));
  assert.equal(
    sheetCall.url,
    `https://www.boat-ai.jp/share/today-sheet?date=${DATE}&from=08%3A00`,
  );
  assert.deepEqual(sheetCall.requiredSelectors, [
    `[data-today-sheet-key="${sd.course_win.key}"]`,
  ]);
  assert.deepEqual(sheetCall.viewport, { width: 1080, height: 1350 });
  // 撮るのは画像の要素だけ。label は渡さない（snsHeadless が要素の先頭に焼き込み、下余白が減る。コードレビューの P1）
  assert.equal(sheetCall.element, "[data-today-sheet]");
  assert.equal(sheetCall.label, undefined);
  assert.equal(
    headless.calls.filter((c) => c.url.includes("tab=sonar")).length,
    0,
  );
  assert.equal(saved.length, 1);
  const tracking = await first("SELECT * FROM sns_post_tracking");
  assert.equal(tracking.utm_content, `${DATE}-b`);
  assert.equal(tracking.tracking_url, url);
  const job = await first("SELECT * FROM sns_x_send_jobs WHERE draft_id=$1", [
    draft.id,
  ]);
  assert.equal(job.state, "queued");
  assert.doesNotMatch(notes[0], /型 b の日だったが/);
});

test("型 b: 欠場・中止の行は外して後ろから補い、撮影用のページに skip で渡す", async () => {
  const headless = sheetShooter();
  await plan({
    digest: withCourseWin(),
    headless,
    raceDb: raceDbOf({ absent: [`${DATE}-04-12:1`] }),
    loadVariants: abVariants,
  });
  const draft = await first("SELECT * FROM sns_drafts");
  // 高橋が欠場 → 1コースの1行目は上田（A2 33/42。縮めた値−A2 の平均が、西村（A1 47/56）より大きい）
  assert.match(
    draft.caption_text,
    /^42回中33回。\n\n今日の福岡12R、1号艇 上田 龍星が/,
  );
  assert.deepEqual(draft.source_data.course_win.k, { c1: 2, c4: 1 });
  const sheetCall = headless.calls.find((c) => c.url.includes("today-sheet"));
  assert.match(sheetCall.url, new RegExp(`skip=${DATE}-04-12%3A1$`));
});

test("型 b: 材料が無い日（RPC 未適用など）は型 a で送り、理由を content_type と Slack に残す（b を送らない）", async () => {
  const notes = [];
  const headless = sheetShooter();
  await plan({
    digest: withCourseWin({
      v: 1,
      status: "unavailable",
      reason: "rpc_missing",
    }),
    headless,
    notes,
    loadVariants: abVariants,
  });
  const draft = await first("SELECT * FROM sns_drafts");
  assert.match(draft.caption_text, /^本日のデータ一覧（/);
  const ct = draft.source_data.content_type;
  assert.equal(ct.side, "b");
  assert.equal(ct.sent, "a");
  assert.equal(ct.id, "today-a");
  assert.equal(ct.fallback_reason, "course_win:rpc_missing");
  assert.equal(draft.source_data.course_win, undefined);
  assert.match(draft.caption_text, /utm_content=2037-10-17-a/);
  assert.match(notes[0], /型 b の日だったが型 a で送る: rpc_missing/);
  assert.equal(
    headless.calls.filter((c) => c.url.includes("today-sheet")).length,
    0,
  );
});

test("型 b: 1コースの候補が0人の日・形の版が違う日も型 a", async () => {
  for (const [courseWin, reason] of [
    [
      {
        ...courseWinOf(),
        candidates: courseWinOf().candidates.filter((c) => c.section === "c4"),
      },
      "no_c1_rows",
    ],
    [{ ...courseWinOf(), v: 2 }, "version_2"],
  ]) {
    await clearDrafts();
    await plan({
      digest: withCourseWin(courseWin),
      headless: sheetShooter(),
      loadVariants: abVariants,
    });
    const draft = await first("SELECT * FROM sns_drafts");
    assert.equal(
      draft.source_data.content_type.fallback_reason,
      `course_win:${reason}`,
    );
  }
});

test("型 b: 撮影用のページが撮れないときは 8:30 までやり直し（何も書かない）、過ぎたら型 a で送る", async () => {
  await assert.rejects(
    plan({
      now: at("08:00"),
      digest: withCourseWin(),
      headless: sheetShooter({ sheetFails: true }),
      loadVariants: abVariants,
    }),
    /course_win_sheet_not_ready/,
  );
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  const headless = sheetShooter({ sheetFails: true });
  await plan({
    now: at("08:35"),
    digest: withCourseWin(),
    headless,
    loadVariants: abVariants,
  });
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.content_type.sent, "a");
  assert.match(
    draft.source_data.content_type.fallback_reason,
    /^course_win:sheet_capture_failed: screenshot_component_missing/,
  );
  assert.ok(headless.calls.some((c) => c.url.includes("tab=sonar")));
});

test("型 b: 作り直し（一覧の版が変わった）でも、その日の型（b）を変えない", async () => {
  await plan({
    digest: withCourseWin(),
    headless: sheetShooter(),
    loadVariants: abVariants,
  });
  const d = withCourseWin();
  const again = await plan({
    now: at("07:55"),
    digest: { ...d, day: { ...d.day, generated_at: `${DATE}T06:30:00Z` } },
    headless: sheetShooter(),
    // 設定が a だけになっても、作った下書きの型を引き継ぐ
    loadVariants: () => ({ ...abVariants(), experiment: { start: null } }),
  });
  assert.equal(again.report.items[0].outcome, "rebuilt");
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.content_type.sent, "b");
  assert.match(draft.caption_text, /^47回中42回。/);
});

test("リポジトリの config: 比べの開始日が入るまでは型 b を選ばない（全部 a）", async () => {
  await plan({ digest: withCourseWin(), headless: sheetShooter() });
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.content_type.sent, "a");
  assert.equal(
    draft.source_data.content_type.fallback_reason,
    "no_schedule_row",
  );
});

test("型 b: 比べの a の日にも、その日に b を出せたか（b_feasible）を残す。比べの外の日は残さない", async () => {
  const v = abVariants();
  // DATE が組の a の日になる開始日を選ぶ
  const aConfig = ["2037-10-16", DATE, "2037-10-15", "2037-10-14"]
    .map((start) => ({ ...v, experiment: { ...v.experiment, start } }))
    .find((c) => {
      const s = pickExperimentSide(
        normalizeTodayExperiment(c.experiment),
        DATE,
      );
      return s.side === "a" && s.pair !== null;
    });
  assert.ok(aConfig);
  await plan({
    digest: withCourseWin(),
    headless: sheetShooter(),
    loadVariants: () => aConfig,
  });
  let draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.content_type.sent, "a");
  assert.equal(draft.source_data.content_type.b_feasible, true);
  await clearDrafts();
  await plan({
    digest: withCourseWin({
      v: 1,
      status: "unavailable",
      reason: "rpc_missing",
    }),
    headless: sheetShooter(),
    loadVariants: () => aConfig,
  });
  draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.content_type.b_feasible, false);
  assert.equal(draft.source_data.content_type.b_reason, "rpc_missing");
  await clearDrafts();
  await plan({ digest: withCourseWin(), headless: sheetShooter() });
  draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.content_type.b_feasible, undefined);
});

test("型 b: ページの指紋が計画と違う（別の行・窓で作られた）ときは撮らない。8:30 まではやり直し、過ぎたら型 a", async () => {
  await assert.rejects(
    plan({
      now: at("08:00"),
      digest: withCourseWin(),
      headless: sheetShooter({ pageKey: "deadbeef" }),
      loadVariants: abVariants,
    }),
    /course_win_sheet_not_ready/,
  );
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  await plan({
    now: at("08:35"),
    digest: withCourseWin(),
    headless: sheetShooter({ pageKey: "deadbeef" }),
    loadVariants: abVariants,
  });
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.content_type.sent, "a");
  assert.match(
    draft.source_data.content_type.fallback_reason,
    /^course_win:sheet_capture_failed/,
  );
});

test("型 b: 締切の無い候補が混ざっても落ちない（その行は載せない）", async () => {
  const cw = courseWinOf();
  const broken = {
    ...cw,
    candidates: [
      ...cw.candidates,
      { ...cw.candidates[0], race_id: `${DATE}-03-01`, start_time: null },
    ],
  };
  await plan({
    digest: withCourseWin(broken),
    headless: sheetShooter(),
    loadVariants: abVariants,
  });
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.content_type.sent, "b");
  assert.deepEqual(draft.source_data.course_win.k, { c1: 3, c4: 1 });
});

test("型 b: 作り直しで b を作れなくなった（一覧が変わり材料が無い）日は、黙らずに型 a へ倒し、理由を残して知らせる", async () => {
  await plan({
    digest: withCourseWin(),
    headless: sheetShooter(),
    loadVariants: abVariants,
  });
  const d = withCourseWin({
    v: 1,
    status: "unavailable",
    reason: "rpc_error",
  });
  const notes = [];
  const again = await plan({
    now: at("07:55"),
    digest: { ...d, day: { ...d.day, generated_at: `${DATE}T06:30:00Z` } },
    headless: sheetShooter(),
    notes,
    loadVariants: abVariants,
  });
  assert.equal(again.report.items[0].outcome, "rebuilt");
  const draft = await first("SELECT * FROM sns_drafts");
  const ct = draft.source_data.content_type;
  assert.equal(ct.side, "b");
  assert.equal(ct.sent, "a");
  assert.equal(ct.fallback_reason, "course_win:rpc_error");
  // b を割り当てた日に a へ倒れた日には、a の日用の b_feasible を付けない
  assert.equal(ct.b_feasible, undefined);
  assert.equal(draft.source_data.course_win, undefined);
  assert.match(draft.caption_text, /^本日のデータ一覧（/);
  assert.match(notes[0], /型 b の日だったが型 a で送る: rpc_error/);
});

test("型 b: 候補が100レースを超える日も、欠場・中止を100レースずつに分けて読み、後ろのレースの欠場も外す（Codex の審査 P1）", async () => {
  const n = 150;
  const races = Array.from({ length: n }, (_, i) => ({
    race_id: `${DATE}-${String(1 + (i % 24)).padStart(2, "0")}-${String(100 + i)}`,
    venue_code: 1 + (i % 24),
    race_number: 1 + (i % 12),
    start_time: "18:00:00",
  }));
  const w = { window_start: "2025-12-02", window_end: "2037-10-15" };
  const notes = buildCourseWinNotes({
    races,
    entries: races.map((r, i) => ({
      race_id: r.race_id,
      boat_number: 1,
      racer_id: 5000 + i,
      grade: "A1",
      player_name: `選手 ${i}`,
    })),
    rpcRows: [
      ...CW_BASE.map(([grade, course, runs, wins]) => ({
        scope: "grade",
        grade,
        course,
        runs,
        wins,
        ...w,
      })),
      // 最後のレースの選手がいちばん上に来る（1着の数が多い）
      ...races.map((r, i) => ({
        scope: "racer",
        racer_id: 5000 + i,
        course: 1,
        runs: 40,
        wins: i === n - 1 ? 39 : 30,
        off_frame_runs: 0,
        ...w,
      })),
    ],
    until: "2037-10-15",
  });
  const last = races[n - 1].race_id;
  const sizes = [];
  const base = raceDbOf({ absent: [`${last}:1`] });
  const raceDb = async (path) => {
    if (path.startsWith("race_entries"))
      sizes.push(
        decodeURIComponent(path)
          .match(/in\.\(([^)]*)\)/)[1]
          .split(",").length,
      );
    return base(path);
  };
  await plan({
    digest: withCourseWin(notes),
    headless: sheetShooter(),
    raceDb,
    loadVariants: abVariants,
  });
  assert.ok(sizes.length >= 2, String(sizes));
  assert.ok(
    sizes.every((s) => s <= 100),
    String(sizes),
  );
  const draft = await first("SELECT * FROM sns_drafts");
  assert.equal(draft.source_data.content_type.sent, "b");
  // 欠場の選手（最後のレース）は載せず、K からも外す
  assert.equal(draft.source_data.course_win.k.c1, n - 1);
  assert.notEqual(draft.source_data.course_win.featured.race_id, last);
});
