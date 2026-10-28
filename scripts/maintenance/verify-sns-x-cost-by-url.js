// X の送信の月の予約を、送る文の URL の有無で決める（マイグレーション 188）の再現テスト。
// PGlite に 182 までと 188 を当て、本番と同じ承認（approve_sns_x_send）・claim（transition_sns_x_send → transition_sns_send_139）で通す。
// 外部接続なし。X へは何も送らない
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import twitterText from "twitter-text";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const loadMedia = async () => new Uint8Array([1, 2, 3]);
const T0 = Date.parse("2026-10-27T03:00:00Z");
const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();
const DEADLINE = 300;
const hash = () => randomBytes(32).toString("hex");
const MD5_182 = "c2b4835c416ff6e824a43fe9025c6518";
const md5 = (s) => createHash("md5").update(s).digest("hex");
const migration = (file) =>
  readFile(new URL("../../docs/db-migration/" + file, import.meta.url), "utf8");
/** CREATE OR REPLACE FUNCTION public.transition_sns_send_139 の $$ と $$ の間（pg_proc.prosrc と同じ文字列） */
const transitionBody = (sql) => {
  const start = sql.indexOf(
    "CREATE OR REPLACE FUNCTION public.transition_sns_send_139",
  );
  const open = sql.indexOf("AS $$", start) + "AS $$".length;
  return sql.slice(open, sql.indexOf("$$;", open));
};
/** 188 の sns_x_post_url_priced をファイルのとおりに戻す（本文の md5 を 188 と同じにする。190 の照合がこれを見る） */
const restore188UrlPriced = async () => {
  const sql = await migration("188_sns_x_cost_by_url.sql");
  const start = sql.indexOf("CREATE FUNCTION public.sns_x_post_url_priced");
  const end = sql.indexOf("$$;", sql.indexOf("AS $$", start)) + 3;
  await db.exec(
    sql
      .slice(start, end)
      .replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION"),
  );
};
let autoApprover;
let seq = 0;

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
    "161_sns_full_picture_items.sql",
    "172_sns_full_picture_shorts.sql",
    "176_sns_finals_image_items.sql",
    "177_sns_finals_replies.sql",
    "179_sns_research_image_items.sql",
    "180_sns_research_image_send.sql",
    "182_sns_x_kind_reserves.sql",
  ])
    await db.exec((await migration(file)).replaceAll("now()", "test_now()"));
  // 188 の前の本番の値（153-runbook）。188 はこのときだけ料金表の値に直す
  await db.exec(
    "UPDATE sns_x_send_control SET attempt_ceiling_microusd=250000, ceiling_x_url_microusd=250000, ceiling_x_plain_microusd=30000",
  );
  // 試験の 182 は now() を test_now() にしたので prosrc の md5 が本番と違う。188 の照合はその値に差し替えて当てる
  const tested = md5(
    transitionBody(
      (await migration("182_sns_x_kind_reserves.sql")).replaceAll(
        "now()",
        "test_now()",
      ),
    ),
  );
  await db.exec(
    (await migration("188_sns_x_cost_by_url.sql"))
      .replaceAll("now()", "test_now()")
      .replaceAll(MD5_182, tested),
  );
  autoApprover = (
    await first(
      "SELECT auto_approver_id id FROM sns_auto_send_control WHERE channel='x'",
    )
  ).id;
});
beforeEach(async () => {
  await db.exec(`
    DELETE FROM sns_metric_jobs; UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    DELETE FROM sns_x_kind_reserves;
    INSERT INTO sns_x_kind_reserves(kind, daily_count) VALUES ('digest',1),('finals_image',3);
    UPDATE sns_auto_send_control SET mode='auto', dry_run=false, finals_image_enabled=(channel='x');
    UPDATE test_clock SET value='${at(0)}';
    UPDATE sns_x_send_control SET paused=false,timing_approved=true,schedule_minutes=60,expiry_minutes=30,
      daily_limit=1000,daily_limit_x=8,daily_limit_youtube=2,daily_external_count=0,
      daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date,max_source_age_seconds=14400,
      period_start='2026-10-01T00:00:00Z',period_end='2026-11-01T00:00:00Z',budget_microusd=10000000,
      ceiling_x_url_microusd=10000,ceiling_x_plain_microusd=1000,reserved_microusd=0;`);
});
after(() => db.close());

const transition = async (id, action) =>
  (
    await first("SELECT transition_sns_x_send($1,$2,'{}'::jsonb) r", [
      id,
      action,
    ])
  ).r;

/** 自動送信の承認者で承認した X の job（送る時刻は今）。kind は digest（/today）か finals_image（優勝戦） */
async function makeJob(kind, text, { variant, parentJobId = null } = {}) {
  seq += 1;
  const draft = await first(
    `INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,send_lane,publish_blocked,source_data)
     VALUES(gen_random_uuid(),$1,'x','ja',$2,'A',false,jsonb_build_object('deadline_queue',$3::jsonb)) RETURNING *`,
    [
      kind === "digest" ? "today_digest" : "finals_image",
      text,
      {
        deadline_at: at(DEADLINE),
        expires_at: at(DEADLINE - (kind === "finals_image" ? 5 : 30)),
        source_revision: `r${seq}`,
        source_observed_at: at(0),
        ...(parentJobId ? { parent_job_id: parentJobId } : {}),
      },
    ],
  );
  await db.query(
    `INSERT INTO sns_auto_send_items(kind,draft_id,channel,variant,race_id,deadline_at,notify_by,veto_until,state,checks,stop_token_hash,notified_at)
     VALUES($1,$2,'x',$3,$4,$5,$6,$7,'notified',$8,$9,$10)`,
    [
      kind,
      draft.id,
      variant ?? (kind === "finals_image" ? "finals" : "main"),
      `R${seq}`,
      at(DEADLINE),
      at(-180),
      at(0),
      { passed: true },
      hash(),
      at(0),
    ],
  );
  return (
    await first("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
      draft.id,
      autoApprover,
      await createXSnapshot(draft, loadMedia),
      at(0),
    ])
  ).r;
}
const reserved = async () =>
  Number((await first("SELECT reserved_microusd r FROM sns_x_send_control")).r);

test("188: 料金表の値（URL あり $0.200・無し $0.015）に直す。今の値が 250000・30000 のときだけ。予算と attempt_ceiling は変えない", async () => {
  // before() で 250000・30000 から当てた直後の値は、beforeEach が試験用に上書きする前に読めないので、関数の本文と一緒に別の DB で見る
  const fresh = new PGlite();
  try {
    await fresh.exec(
      "CREATE TABLE sns_x_send_control(id boolean PRIMARY KEY, ceiling_x_url_microusd bigint, ceiling_x_plain_microusd bigint, attempt_ceiling_microusd bigint, budget_microusd bigint)",
    );
    const sql = await migration("188_sns_x_cost_by_url.sql");
    const block = sql.slice(
      sql.indexOf("DO $$\nBEGIN\n  IF (SELECT ceiling_x_url_microusd"),
    );
    const update = block.slice(0, block.indexOf("END $$;") + "END $$;".length);
    await fresh.exec(
      "INSERT INTO sns_x_send_control VALUES(true,250000,30000,250000,20000000)",
    );
    await fresh.exec(update);
    assert.deepEqual(
      (await fresh.query("SELECT * FROM sns_x_send_control")).rows[0],
      {
        id: true,
        ceiling_x_url_microusd: 200000,
        ceiling_x_plain_microusd: 15000,
        attempt_ceiling_microusd: 250000,
        budget_microusd: 20000000,
      },
    );
    // オーナーが別に決めた値は触らない
    await fresh.exec(
      "UPDATE sns_x_send_control SET ceiling_x_url_microusd=123, ceiling_x_plain_microusd=45",
    );
    await fresh.exec(update);
    assert.deepEqual(
      Object.values(
        (
          await fresh.query(
            "SELECT ceiling_x_url_microusd, ceiling_x_plain_microusd FROM sns_x_send_control",
          )
        ).rows[0],
      ),
      [123, 45],
    );
  } finally {
    await fresh.close();
  }
});

test("188: 先頭の照合は 182 の本文の md5（本番の値 c2b4835c…）。置き換えた後に当て直すと止まる", async () => {
  const body182 = transitionBody(
    await migration("182_sns_x_kind_reserves.sql"),
  );
  assert.equal(md5(body182), MD5_182);
  // 抜き出し方が pg_proc.prosrc と同じ文字列になることを、試験の DB の 188 の本文で確かめる
  const body188 = transitionBody(
    (await migration("188_sns_x_cost_by_url.sql")).replaceAll(
      "now()",
      "test_now()",
    ),
  );
  assert.equal(
    (
      await first(
        "SELECT md5(prosrc) m FROM pg_proc WHERE proname='transition_sns_send_139'",
      )
    ).m,
    md5(body188),
  );
  await assert.rejects(
    db.exec(await migration("188_sns_x_cost_by_url.sql")),
    /188: transition_sns_send_139 が 182 の本文でない/,
  );
  // ファイルの BEGIN の中で止まったので戻す（db-apply は失敗で全体を戻す）
  await db.exec("ROLLBACK");
});

test("188: 182 との差は予約額の行だけ（v_ceiling・素材のスレッドの兄弟・自分の子）", async () => {
  const lines = (s) => transitionBody(s).split("\n");
  const old = lines(await migration("182_sns_x_kind_reserves.sql"));
  const now = lines(await migration("188_sns_x_cost_by_url.sql"));
  const removed = old.filter((l) => !now.includes(l));
  const added = now.filter((l) => !old.includes(l));
  assert.deepEqual(
    removed.map((l) => l.trim()),
    [
      "v_base INTEGER; v_own INTEGER := 0; v_room JSONB; v_max_age INTEGER;",
      "WHEN d.thread_index=0 THEN coalesce(c.ceiling_x_url_microusd,c.attempt_ceiling_microusd)",
      "SELECT count(*) INTO v_need FROM public.sns_drafts WHERE bundle_import_id=d.bundle_import_id AND platform='x' AND status<>'archived';",
      "v_rest := (v_need-1)*coalesce(c.ceiling_x_plain_microusd,c.attempt_ceiling_microusd);",
      "SELECT count(*), count(*) FILTER (WHERE cj.parent_job_id=j.id) INTO v_children, v_own FROM public.sns_x_send_jobs cj",
      "v_rest := v_rest + v_children*coalesce(c.ceiling_x_url_microusd,c.attempt_ceiling_microusd);",
    ],
  );
  assert.ok(
    added.every((l) =>
      /v_child_cost|sns_x_post_has_url|sns_x_post_url_priced|'media', CASE WHEN sd\.video_storage_path|OR jsonb_array_length\(coalesce\(sd\.source_data->'image_paths'|ceiling_x_(url|plain)_microusd|^\s*-- (188|182 まで)|INTO v_need, v_rest|INTO v_children, v_own, v_child_cost|^\s*SELECT count\(\*\), count\(\*\) FILTER \(WHERE cj\.parent_job_id=j\.id\),$/.test(
        l,
      ),
    ),
    added.join("\n"),
  );
});

test("sns_x_post_has_url: twitter-text の extractUrls が URL と見る文は必ず真（取り逃すと予約が実額より少なくなる）。URL の無い文は偽", async () => {
  const has = async (t) =>
    (await first("SELECT sns_x_post_has_url($1) r", [t])).r;
  for (const t of [
    "今日の一覧はこちら：https://www.boat-ai.jp/today?utm_source=x",
    "http://example.com",
    "www.boat-ai.jp",
    "詳しくは boat-ai.jp で",
    "BOAT-AI.JP",
    "youtu.be/abcdefghijk",
    "amzn.to/xyz",
    "example.xyz",
    "boat.tokyo",
    "a.shop・b.online・c.club",
    "x.gg",
    "https://t.co/abcdef",
  ]) {
    assert.ok(
      twitterText.extractUrls(t).length > 0,
      `試験の文が URL でない: ${t}`,
    );
    assert.equal(await has(t), true, t);
  }
  for (const t of [
    "優勝戦 思考の順\n1号艇 逃げ切った割合 84.91%（全国53走）",
    "No.1 の 4.5 点",
    "",
  ]) {
    assert.equal(twitterText.extractUrls(t).length, 0, t);
    assert.equal(await has(t), false, t);
  }
  assert.equal(await has(null), false);
});

test("claim の予約: URL のある文は ceiling_x_url、無い文（優勝戦の本投稿）は ceiling_x_plain。182 は親を全部 ceiling_x_url で数えていた", async () => {
  const today = await makeJob(
    "digest",
    "本日のデータ一覧\n\n今日の一覧はこちら：https://www.boat-ai.jp/today",
  );
  assert.equal((await transition(today.id, "claim")).state, "sending");
  assert.equal(await reserved(), 10000);
  const finals = await makeJob("finals_image", "優勝戦 思考の順");
  const claimed = await transition(finals.id, "claim");
  assert.equal(claimed.state, "sending");
  assert.equal(Number(claimed.reserved_microusd), 1000);
  assert.equal(await reserved(), 11000);
});

test("claim の残りの見込み（v_rest）: まだ claim していない自分の子（投票のリプ）は、子の文で数える。URL の無い子は ceiling_x_plain", async () => {
  // 予算は親と子の plain の2本分だけ。182 は子を ceiling_x_url（10000）で数えて「月額上限です」になっていた
  await db.exec("UPDATE sns_x_send_control SET budget_microusd=2000");
  const main = await makeJob("finals_image", "優勝戦 思考の順");
  await makeJob("finals_image", "どれが来る？", {
    variant: "finals_poll",
    parentJobId: main.id,
  });
  const claimed = await transition(main.id, "claim");
  assert.equal(claimed.state, "sending");
  assert.equal(await reserved(), 1000);
  // 子に URL があれば ceiling_x_url で数え、予算に入らなければ claim しない
  await db.exec(`
    UPDATE sns_x_send_jobs SET parent_job_id=NULL; DELETE FROM sns_x_send_jobs; DELETE FROM sns_auto_send_items;
    ALTER TABLE sns_drafts DISABLE TRIGGER USER; DELETE FROM sns_drafts; ALTER TABLE sns_drafts ENABLE TRIGGER USER;
    UPDATE sns_x_send_control SET reserved_microusd=0, budget_microusd=2000`);
  const main2 = await makeJob("finals_image", "優勝戦 思考の順");
  await makeJob("finals_image", "詳しくは https://www.boat-ai.jp/race/x", {
    variant: "finals_poll",
    parentJobId: main2.id,
  });
  await assert.rejects(transition(main2.id, "claim"), /月額上限です/);
});

test("claim の残りの見込み（v_rest）: 今日 claim 済みの他の親の、まだ claim していない子も子の文で数える（URL の無い子は ceiling_x_plain）", async () => {
  const main = await makeJob("finals_image", "優勝戦 思考の順");
  await makeJob("finals_image", "どれが来る？", {
    variant: "finals_poll",
    parentJobId: main.id,
  });
  assert.equal((await transition(main.id, "claim")).state, "sending");
  // 他の親（優勝戦の本投稿）は claim 済み、その子（投票）はまだ。/today（URL つき 10000）＋他の親の子（plain 1000）が予算に入れば通る
  await db.exec(
    "UPDATE sns_x_send_control SET budget_microusd = reserved_microusd + 11000",
  );
  const today = await makeJob(
    "digest",
    "今日の一覧はこちら：https://www.boat-ai.jp/today",
  );
  assert.equal((await transition(today.id, "claim")).state, "sending");
});

test("transition は予約の判定を sns_x_post_url_priced(snapshot) だけに任せる（画像だけの投稿を URL つきで数える版は、この関数の置き換えだけで出せる）", async () => {
  const before = (
    await first(
      "SELECT md5(prosrc) m FROM pg_proc WHERE proname='transition_sns_send_139'",
    )
  ).m;
  await db.exec(`CREATE OR REPLACE FUNCTION public.sns_x_post_url_priced(p_snapshot JSONB)
    RETURNS BOOLEAN LANGUAGE sql IMMUTABLE SET search_path=public AS $$
      SELECT public.sns_x_post_has_url(p_snapshot->>'text') OR jsonb_array_length(coalesce(p_snapshot->'media','[]'::jsonb))>0;
    $$;`);
  try {
    // 媒体のある URL の無い投稿は URL つきの額、媒体も URL も無い投稿（投票）は plain
    const withMedia = await makeJob("finals_image", "優勝戦 思考の順");
    await db.query(
      "UPDATE sns_x_send_jobs SET snapshot = jsonb_set(snapshot, '{media}', '[{\"path\":\"a.png\"}]') WHERE id=$1",
      [withMedia.id],
    );
    assert.equal(
      Number((await transition(withMedia.id, "claim")).reserved_microusd),
      10000,
    );
    const plain = await makeJob("finals_image", "どれが来る？");
    assert.equal(
      Number((await transition(plain.id, "claim")).reserved_microusd),
      1000,
    );
    assert.equal(
      (
        await first(
          "SELECT md5(prosrc) m FROM pg_proc WHERE proname='transition_sns_send_139'",
        )
      ).m,
      before,
    );
  } finally {
    await restore188UrlPriced();
  }
});

test("190: sns_x_post_url_priced を媒体のある投稿も真にする版に置き換える（transition は変えない）。188 の本文でなければ止まる", async () => {
  const before = (
    await first(
      "SELECT md5(prosrc) m FROM pg_proc WHERE proname='transition_sns_send_139'",
    )
  ).m;
  const sql = await migration("190_sns_x_cost_media_as_url.sql");
  await restore188UrlPriced();
  await db.exec(sql);
  try {
    const has = async (snapshot) =>
      (await first("SELECT sns_x_post_url_priced($1) r", [snapshot])).r;
    assert.equal(await has({ text: "優勝戦 思考の順", media: [{}] }), true);
    assert.equal(await has({ text: "どれが来る？", media: [] }), false);
    assert.equal(await has({ text: "どれが来る？" }), false);
    assert.equal(
      await has({ text: "https://www.boat-ai.jp/today", media: [] }),
      true,
    );
    // 媒体のある URL の無い投稿は URL つきの額で予約する
    const withMedia = await makeJob("finals_image", "優勝戦 思考の順");
    await db.query(
      "UPDATE sns_x_send_jobs SET snapshot = jsonb_set(snapshot, '{media}', '[{\"path\":\"a.png\"}]') WHERE id=$1",
      [withMedia.id],
    );
    assert.equal(
      Number((await transition(withMedia.id, "claim")).reserved_microusd),
      10000,
    );
    assert.equal(
      (
        await first(
          "SELECT md5(prosrc) m FROM pg_proc WHERE proname='transition_sns_send_139'",
        )
      ).m,
      before,
    );
    // 当て直すと、関数の本文が 188 でないので全体を戻す
    await assert.rejects(
      db.exec(sql),
      /190: sns_x_post_url_priced が 188 の本文でない/,
    );
    await db.exec("ROLLBACK");
  } finally {
    await restore188UrlPriced();
  }
});
