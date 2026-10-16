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
  TODAY_URL,
  createTodayStore,
  runTodayPlan,
  todaySchedule,
} from "../lib/snsTodayPlanner.js";

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
    DELETE FROM sns_post_tracking; DELETE FROM sns_mobile_reviews; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE test_clock SET value=NULL;`);
});
after(() => db.close());

// PostgREST の store と同じ契約を SQL で（URL の形は下の別のテストで確かめる）
const sqlStore = {
  async todayState(date) {
    return {
      draft:
        (await first(
          "SELECT * FROM sns_drafts WHERE send_lane='A' AND format='today_digest' AND source_data->'digest'->>'date'=$1 AND status<>'archived'",
          [date],
        )) ?? null,
      item:
        (await first(
          "SELECT * FROM sns_auto_send_items WHERE kind='digest' AND race_id=$1",
          [`today:${date}`],
        )) ?? null,
    };
  },
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
      `UPDATE sns_drafts SET caption_text=$2,cover_image_path=$3,source_data=$4,risk_flags=$5
       WHERE id=$1 AND status IN ('pending_review','approved') RETURNING *`,
      [
        id,
        p.caption_text,
        p.cover_image_path,
        p.source_data,
        JSON.stringify(p.risk_flags),
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
      "UPDATE sns_auto_send_items SET state=$3,checks=$4,held_reason=$5 WHERE id=$1 AND state=$2 RETURNING *",
      [id, from, p.state, p.checks, p.held_reason],
    );
    if (!row) throw new Error("item を更新できない");
    return row;
  },
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
  1: "07:30:00",
  2: "12:00:00",
  3: "10:00:00",
  4: "09:30:00",
  5: "11:00:00",
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
      start_time: "16:20:00",
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
      start_time: NIGE_TIME[i + 1] ?? "13:00:00",
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
      start_time: "09:00:00",
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
      start_time: "09:00:00",
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
      start_time: "14:00:00",
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
      start_time: "15:00:00",
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
      start_time: "16:10:00",
      racer_name: "逃がし\u30001",
      boat_number: 5,
      sample_size: 50,
    },
    { section: "flying", rank: 1, racer_name: "フライング1" },
    { section: "returned", rank: 1, racer_name: "帰郷1" },
  ],
});
const FEATURED_LINE =
  "注目レース：平和島12R 16:20締切｜1号艇 注目 1｜1コースで逃げ切った割合 84.13%（全国63走）・この会場の平均 58.4%";
const EXPECTED_LINES = [
  "［逃げ］全国で1コースに入ったとき逃げ切った割合70%以上の1号艇",
  "［まくり］そのコースでまくりで1着の割合25%以上の選手",
  "",
  "［まくり］戸田5R 09:00締切｜3号艇 まくり 1｜全国31走",
  "［逃げ］平和島3R 10:00締切｜1号艇 逃げ 3｜全国40走",
  "［逃げ］平和島5R 11:00締切｜1号艇 逃げ 5｜全国40走",
  "［逃げ］平和島2R 12:00締切｜1号艇 逃げ 2｜全国40走",
  "［まくり］戸田7R 14:00締切｜2号艇 まくり 3｜全国33走",
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
          start_time: "10:00:00",
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
  now = at("05:40"),
  mode = "live",
  digest = digestOf(),
  headless = shooter(),
  notes = [],
  saved = [],
  raceDb = raceDbOf(),
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
    },
  );
}
const loadMedia = async () => PNG;
async function approve(draft) {
  const { r: revision } = await first(
    "SELECT sns_mobile_revision(d) r FROM sns_drafts d WHERE id=$1",
    [draft.id],
  );
  return (
    await first("SELECT approve_sns_mobile_channel($1,$2,$3,$4,$5,30) r", [
      draft.id,
      me,
      revision,
      await createXSnapshot(draft, loadMedia),
      draft.scheduled_at,
    ])
  ).r;
}

test("5:40 に一覧を撮って下書き・item（digest）を作り、本人が承認でき、7:45 に送る job ができる。送る直前の検査も通る", async () => {
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
        "平和島12R 16:20締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-02-05?tab=sonar`,
        ".af-hep .af-dark",
        "戸田5R 09:00締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-04-03?tab=sonar`,
        ".af-hep .af-dark",
        "平和島3R 10:00締切",
      ],
      [
        `https://www.boat-ai.jp/race/${DATE}-04-05?tab=sonar`,
        ".af-hep .af-dark",
        "平和島5R 11:00締切",
      ],
    ],
  );
  assert.ok(
    headless.calls.every(
      (c) => c.requiredSelectors === SCREEN_MARKERS["race-sonar"],
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
      `）\n\n${FEATURED_LINE}\n\n${EXPECTED_LINES}\n\n過去の実績は当日の結果を保証しません。展示後は進入と展示タイムも確認してください。\nhttps://`,
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
  assert.ok(
    draft.caption_text.endsWith(
      `${TODAY_URL}?utm_source=x&utm_medium=social&utm_campaign=today_digest&utm_content=${DATE}`,
    ),
  );
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
    ["today_digest", DATE],
  );
  assert.equal(notes.length, 1);
  assert.match(notes[0], /7:45 までに個別承認の画面で承認/);
  assert.match(
    notes[0],
    /画像1: https:\/\/signed\/today\/[^\n]+-1\.png\n画像2: [^\n]+\n画像3: [^\n]+\n画像4: [^\n]+-4\.png/,
  );
  // 本人の個別承認（140 の DB 側の条件も通る）→ 7:45 の job
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
      now: () => at("07:46").getTime(),
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
  const again = await plan({ now: at("06:00"), notes });
  assert.equal(again.report.items[0].outcome, "unchanged");
  assert.equal(notes.length, 0);
  const rebuilt = await plan({ now: at("06:35"), digest: digestOf(24), notes });
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

test("5:30 より前・7:45 以降・一覧が未公開は何もしない。shadow は撮らず書かない", async () => {
  for (const now of [at("05:29"), at("07:45")])
    assert.equal(
      (await plan({ now })).report.items[0].reason,
      "outside_window",
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
    now: at("06:35"),
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
        `sns_auto_send_items?kind=eq.digest&race_id=eq.today:${DATE}`,
      ),
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

test("承認の画面の指摘: /today の本文（加重で280超え）は、長文の1投稿として指摘しない", async () => {
  const { inspectDraft } = await import("../../api/_lib/snsEditAssist.js");
  await plan();
  const [draft] = await all("SELECT * FROM sns_drafts");
  const long = {
    ...draft,
    caption_text: draft.caption_text + "あ".repeat(200),
  };
  assert.equal(
    inspectDraft(long, []).find((f) => f.rule === "x-weighted-length"),
    undefined,
  );
});

test("runbook の L2 の SQL（153-runbook.md）を流すと、承認した /today の job が 7:45 に claim まで進む。dry_run の間は claim しない", async () => {
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
  await db.query("UPDATE test_clock SET value=$1", [at("05:40")]);
  await db.exec(sql.replaceAll("now()", "test_now()"));
  // runbook の期間（2026-10）は、テストの日付（2037 年。実際の時計で期限を判定する部品があるため未来に置く）に合わせて動かす
  await db.exec(
    "UPDATE sns_x_send_control SET period_start = test_now() - interval '1 day', period_end = test_now() + interval '30 days'",
  );
  await plan({ now: at("05:40") });
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
  await db.query("UPDATE test_clock SET value=$1", [at("07:46")]);
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
  const again = await plan({ now: at("05:45") });
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
      "［逃げ］平和島6R 13:00締切｜1号艇 逃げ 6｜全国40走",
    ),
    draft.caption_text,
  );
  assert.ok(
    draft.caption_text.includes(
      "［まくり］戸田8R 15:00締切｜2号艇 まくり 4｜全国40走",
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
      "）\n\n［逃げ］全国で1コースに入ったとき逃げ切った割合72%以上の1号艇\n\n［逃げ］平和島3R 10:00締切｜1号艇 逃げ 3｜全国40走\n［逃げ］平和島5R 11:00締切｜1号艇 逃げ 5｜全国40走\n［逃げ］平和島2R 12:00締切｜1号艇 逃げ 2｜全国40走\n\n過去の実績は",
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

test("注目レース: 先頭に置き一覧に重ねない。逃がしからの注目・7:45 より前・欠場の注目は載せない", async () => {
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
      start_time: "10:00:00",
      racer_name: "逃げ\u30003",
    }),
  );
  assert.match(same.text, /注目レース：平和島3R 10:00締切｜1号艇 逃げ 3｜/);
  assert.equal(same.text.split("逃げ 3｜").length - 1, 1);
  assert.match(same.text, /［逃げ］平和島6R 13:00締切｜1号艇 逃げ 6｜/);
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
    build((f) => Object.assign(f, { start_time: "07:40:00" })).text,
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
    /^本日のデータ一覧（[^\n]+）\n\n注目レース：[^\n]+\n\n過去の実績/,
  );
  assert.deepEqual(onlyFeatured.picks, [
    { race_id: `${DATE}-04-12`, boat_number: 1 },
  ]);
});

test("龍神ソナーの図がそろわないうちは 7:00 までやり直し、7:00 を過ぎたら撮れた分で作る", async () => {
  const saved = [];
  const notReady = [`${DATE}-02-05`];
  await assert.rejects(
    plan({ now: at("06:30"), headless: shooter({ notReady }), saved }),
    /sonar_not_ready（2037-10-17-02-05: screenshot_component_missing）/,
  );
  assert.equal(saved.length, 0);
  assert.equal((await all("SELECT * FROM sns_drafts")).length, 0);
  await plan({ now: at("07:05"), headless: shooter({ notReady }), saved });
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

test("各回の結果をその日の分だけ cursor に残す（7:45 を過ぎても朝の経過を読める）。時間外は残さず、日付が変わったら空から、最新30件", async () => {
  const { nextTodayLog } = await import("../lib/snsTodayPlanner.js");
  let log = nextTodayLog(
    null,
    { outcome: "error", reason: "sonar_not_ready（x）" },
    at("06:00"),
  );
  log = nextTodayLog(log, { outcome: "manual", item_id: "i1" }, at("07:05"));
  log = nextTodayLog(
    log,
    { outcome: "skipped", reason: "outside_window" },
    at("08:00"),
  );
  assert.deepEqual(log, {
    date: DATE,
    events: [
      {
        at: at("06:00").toISOString(),
        outcome: "error",
        reason: "sonar_not_ready（x）",
      },
      { at: at("07:05").toISOString(), outcome: "manual", reason: null },
    ],
  });
  const next = nextTodayLog(
    log,
    { outcome: "error", reason: "x" },
    new Date(at("06:00").getTime() + 86400000),
  );
  assert.equal(next.events.length, 1);
  let many = null;
  for (let i = 0; i < 35; i++)
    many = nextTodayLog(
      many,
      { outcome: "error", reason: String(i) },
      at("06:00"),
    );
  assert.equal(many.events.length, 30);
  assert.equal(many.events.at(-1).reason, "34");
});
