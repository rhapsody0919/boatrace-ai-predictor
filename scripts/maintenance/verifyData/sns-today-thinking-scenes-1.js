/**
 * verify-sns-today-thinking.js の後半の場面（1/3）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-thinking.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { finalsStatus, resultLine } from "../../sns/push-finals-image.js";
import { createReadCurrent } from "../../../api/_lib/snsClaimCheck.js";

let all,
  at,
  BASE_FILES,
  claim,
  db,
  DEADLINE,
  first,
  md5,
  MD5_182,
  MD5_188,
  MIGRATION,
  migration189ForTest,
  NOW,
  POLL,
  post,
  push,
  RACE,
  readTables,
  replyBundle,
  saved,
  setClock,
  slotAsked,
  sqlOf,
  stageCalls,
  store,
  transition,
  transitionBody;
export let readCurrent;

/** test("push の3本: 本投稿（画像4枚）・投票のリプ・展示後のリプが下書き・item・job になる。キーは today_thin の中身を割った 1/2 */
async function sttA1() {
  const main = await push();
  assert.equal(main.reasons, undefined, JSON.stringify(main));
  assert.equal(main.kind, "today_thinking");
  assert.ok(main.job_id && main.poll_job_id);
  // 段は読まない（race_conditions は一般戦のまま通る）
  assert.deepEqual(stageCalls, []);
  assert.deepEqual(slotAsked, [["today_thinking", 2]]);
  const items = await all(
    "SELECT kind, variant, state FROM sns_auto_send_items ORDER BY variant",
  );
  assert.deepEqual(
    items.map((i) => [i.kind, i.variant, i.state]),
    [
      ["today_thinking", "thinking", "notified"],
      ["today_thinking", "thinking_poll", "notified"],
    ],
  );
  const drafts = await all(
    "SELECT format, title, source_data FROM sns_drafts ORDER BY title",
  );
  for (const d of drafts) {
    assert.equal(d.format, "today_thinking_image");
    assert.deepEqual(
      Object.keys(d.source_data).filter((k) =>
        [
          "digest",
          "full_picture",
          "finals_image",
          "research_image",
          "today_thinking",
        ].includes(k),
      ),
      ["today_thinking"],
    );
    assert.equal(d.source_data.today_thinking.race_id, RACE);
    assert.equal(
      d.source_data.release_evidence.reference,
      "today_thinking_image",
    );
    assert.match(d.title, /^\/today 思考の順/);
  }
  assert.ok(saved.every(([p]) => p.startsWith(`today-thinking/${RACE}/`)));
  assert.equal(saved.length, 4);
  assert.match(main.notes[0], /\/today の思考投稿/);
  assert.match(main.notes[0], /today_thinking_enabled = false/);
  const mainJob = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    main.job_id,
  ]);
  const pollJob = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    main.poll_job_id,
  ]);
  assert.equal(pollJob.parent_job_id, mainJob.id);
  // 期限は締切の5分前（3本とも）
  assert.equal(mainJob.expires_at.toISOString(), "2037-10-26T07:25:00.000Z");
  assert.equal(pollJob.expires_at.toISOString(), "2037-10-26T07:25:00.000Z");
  assert.deepEqual(JSON.parse(pollJob.snapshot_text).poll, {
    options: POLL,
    closes_at: DEADLINE,
  });
  // 本投稿を送り、投票のリプを送る
  await setClock(NOW);
  await post(main.job_id, "1890000000000000021", "2037-10-26T07:15:30Z");
  await setClock(at("16:16:00"));
  const pollClaim = await claim(main.poll_job_id);
  assert.equal(pollClaim.state, "sending", JSON.stringify(pollClaim));
  await transition(main.poll_job_id, "begin_post");
  await transition(main.poll_job_id, "complete", {
    id: "1890000000000000022",
    posted_at: "2037-10-26T07:16:30Z",
  });
  // 展示後のリプ（締切の25〜13分前）
  await setClock(at("16:10:00"));
  const reply = await push(replyBundle(), { now: at("16:10:00") });
  assert.equal(reply.reasons, undefined, JSON.stringify(reply));
  assert.equal(reply.part, "reply");
  const replyJob = await first("SELECT * FROM sns_x_send_jobs WHERE id=$1", [
    reply.job_id,
  ]);
  assert.equal(replyJob.parent_job_id, main.job_id);
  assert.equal(JSON.parse(replyJob.snapshot_text).media.length, 4);
  assert.deepEqual(
    await first("SELECT kind, variant FROM sns_auto_send_items WHERE id=$1", [
      reply.item_id,
    ]),
    { kind: "today_thinking", variant: "thinking_reply" },
  );
  return { reply };
}

/** test("push の3本: 本投稿（画像4枚）・投票のリプ・展示後のリプが下書き・item・job になる。キーは today_thin の中身を割った 2/2 */
async function sttA2({ reply }) {
  assert.ok(
    saved
      .slice(4)
      .every(
        ([p]) =>
          p.startsWith(`today-thinking/${RACE}/`) && p.includes("/reply-"),
      ),
  );
  const status = await finalsStatus(RACE, { store, kind: "today_thinking" });
  assert.equal(status.tweet_id, "1890000000000000021");
  assert.equal(status.poll.tweet_id, "1890000000000000022");
  assert.equal(status.reply.job_id, reply.job_id);
  // 優勝戦の記録は空のまま（種類で分かれる）
  assert.equal(await finalsStatus(RACE, { store }), null);
  // 2回目は何もしない（exit 4）、結果の行に kind
  const again = await push(replyBundle(), { now: at("16:10:00") });
  assert.equal(again.already, true);
  const line = resultLine(RACE, again);
  assert.equal(line.code, 4);
  assert.match(line.text, /^FINALS_RESULT \{.*"kind":"today_thinking"/);
  // 優勝戦の行は今までと同じバイト列（kind を足さない、審査 P3）
  const finalsLine = resultLine(RACE, { ...again, kind: "finals_image" });
  assert.doesNotMatch(finalsLine.text, /"kind"/);
  assert.equal(
    finalsLine.text,
    line.text.replace(',"kind":"today_thinking"', ""),
  );
}

function stt1Scene1() {
  readCurrent = createReadCurrent({
    db: async (p) => {
      const table = p.split("?")[0];
      readTables.push(table);
      if (table === "sns_drafts")
        return all(
          "SELECT bundle_import_id, source_data FROM sns_drafts WHERE id=$1",
          [p.match(/id=eq\.([0-9a-f-]+)/)[1]],
        );
      if (table === "races")
        return all(
          "SELECT race_date::text, start_time::text, cancellation_status FROM races WHERE race_id=$1",
          [decodeURIComponent(p.match(/race_id=eq\.([^&]+)/)[1])],
        );
      if (table === "sns_auto_send_items" && /draft_id=eq\./.test(p))
        return all(
          "SELECT kind, race_id, variant FROM sns_auto_send_items WHERE draft_id=$1",
          [p.match(/draft_id=eq\.([0-9a-f-]+)/)[1]],
        );
      if (table === "sns_auto_send_items")
        return all(
          "SELECT id FROM sns_auto_send_items WHERE kind=$1 AND variant=$2 AND race_id=$3 AND state='sent'",
          [
            p.match(/kind=eq\.([a-z_]+)/)[1],
            p.match(/variant=eq\.([a-z_]+)/)[1],
            decodeURIComponent(p.match(/race_id=eq\.([^&]+)/)[1]),
          ],
        );
      if (table === "sns_auto_send_control")
        return all(
          `SELECT ${p.match(/select=([a-z_]+)/)[1]} FROM sns_auto_send_control WHERE channel='x'`,
        );
      return [];
    },
  });
}

function stt1Scene2() {
  test("189 の土台: 188 の transition の本文の md5 が ce1cd6fa…（182 は c2b4835c…）。189 は 188 から3か所だけ変える（v_ceiling・v_rest は変えない）", async () => {
    assert.equal(
      md5(transitionBody(await sqlOf("182_sns_x_kind_reserves.sql"))),
      MD5_182,
    );
    const before = transitionBody(await sqlOf(BASE_FILES.at(-1)));
    const after = transitionBody(await sqlOf(MIGRATION));
    assert.equal(md5(before), MD5_188);
    // 行の差（最長共通部分列）。変わったまとまりが3つで、消えた行・足した行はこの3か所のものだけ
    const a = before.split("\n");
    const b = after.split("\n");
    const L = Array.from({ length: a.length + 1 }, () =>
      new Array(b.length + 1).fill(0),
    );
    for (let i = a.length - 1; i >= 0; i--)
      for (let j = b.length - 1; j >= 0; j--)
        L[i][j] =
          a[i] === b[j]
            ? L[i + 1][j + 1] + 1
            : Math.max(L[i + 1][j], L[i][j + 1]);
    const removed = [];
    const added = [];
    let hunks = 0;
    let inHunk = false;
    for (let i = 0, j = 0; i < a.length || j < b.length;) {
      if (i < a.length && j < b.length && a[i] === b[j]) {
        inHunk = false;
        i++;
        j++;
        continue;
      }
      if (!inHunk) hunks++;
      inHunk = true;
      if (j < b.length && (i === a.length || L[i][j + 1] >= L[i + 1][j]))
        added.push(b[j++]);
      else removed.push(a[i++]);
    }
    assert.equal(hunks, 3, [...removed, "---", ...added].join("\n"));
    assert.equal(removed.length, 2, removed.join("\n"));
    for (const line of removed)
      assert.match(
        line,
        /v_expiry_min := CASE WHEN v_kind='finals_image' THEN 5|ai\.kind IN \('digest','finals_image','research_image'\)/,
      );
    assert.equal(added.length, 4, added.join("\n"));
    for (const line of added) assert.match(line, /today_thinking/);
    assert.ok(!added.some((line) => /v_ceiling|v_rest/.test(line)));
    // 189 の先頭は control → items の順に LOCK し、md5 で照合する（LIKE ではない）
    const text = await sqlOf(MIGRATION);
    const lockControl = text.indexOf(
      "LOCK TABLE public.sns_auto_send_control IN ACCESS EXCLUSIVE MODE;",
    );
    const lockItems = text.indexOf(
      "LOCK TABLE public.sns_auto_send_items IN ACCESS EXCLUSIVE MODE;",
    );
    assert.ok(text.indexOf("SET LOCAL lock_timeout = '10s';") < lockControl);
    assert.ok(lockControl > 0 && lockControl < lockItems);
    assert.ok(lockItems < text.indexOf("md5(prosrc) = '" + MD5_188 + "'"));
    // 取り置き・上限はマイグレーションに入れない（transition の本文の外。本文は claim で予約額を書く）
    const outside =
      text.slice(0, text.indexOf("CREATE OR REPLACE FUNCTION")) +
      text.slice(
        text.indexOf("REVOKE ALL ON FUNCTION public.transition_sns_send_139"),
      );
    assert.doesNotMatch(
      outside.replace(/--.*$/gm, ""),
      /sns_x_kind_reserves|sns_x_send_control|daily_limit_x/,
    );
  });
  test("189 の先頭の照合: transition の本文が 188 でなければ（189 を当てた後にもう一度当てても）全体を戻す", async () => {
    const again = await migration189ForTest();
    await assert.rejects(
      db.exec(again),
      /189: transition_sns_send_139 の本文が 188 でない/,
    );
    await db.exec("ROLLBACK");
    // 戻ったので列は1つ（2回足されていない）、CHECK も1組
    assert.equal(
      Number(
        (
          await first(
            "SELECT count(*) n FROM pg_attribute WHERE attrelid='public.sns_auto_send_control'::regclass AND attname='today_thinking_enabled' AND NOT attisdropped",
          )
        ).n,
      ),
      1,
    );
  });
}

function stt1Scene3() {
  test("189: today_thinking の item は X・下書きにひもづく・variant は thinking 系だけ。finals と thinking は同じレースで両立。許可は既定 false・x の行だけ", async () => {
    const insert = (
      kind,
      channel,
      variant,
      { bundleImportId = null, raceId = "r189" } = {},
    ) =>
      db.query(
        `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
         VALUES(gen_random_uuid(), $2, 'ja', 'today_thinking_image', '189') RETURNING id)
       INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,bundle_import_id)
       SELECT $1, $3, id, $2, $5, test_now()+interval '3h', test_now(), test_now()+interval '1h', $4 FROM draft`,
        [kind, channel, variant, bundleImportId, raceId],
      );
    await assert.rejects(
      insert("today_thinking", "youtube", "thinking"),
      /kind_source|variant_scope/,
    );
    await assert.rejects(
      insert("today_thinking", "x", "main"),
      /variant_scope/,
    );
    await assert.rejects(
      insert("today_thinking", "x", "finals"),
      /variant_scope/,
    );
    await assert.rejects(
      insert("finals_image", "x", "thinking"),
      /variant_scope/,
    );
    await assert.rejects(
      insert("digest", "x", "thinking_poll"),
      /variant_scope/,
    );
    await assert.rejects(
      insert("today_thinking", "x", "thinking", {
        bundleImportId: "00000000-0000-4000-8000-0000000000aa",
      }),
      /kind_source/,
    );
    for (const variant of ["thinking", "thinking_poll", "thinking_reply"])
      await insert("today_thinking", "x", variant);
    // 同じレースの優勝戦の3本・全貌（main）と両立し、種類ごとに1レース1件（一意の索引）
    for (const variant of ["finals", "finals_poll", "finals_reply"])
      await insert("finals_image", "x", variant);
    await insert("full_picture", "x", "main");
    await assert.rejects(
      insert("today_thinking", "x", "thinking"),
      /sns_auto_send_items_race_channel/,
    );
    // research_image の main も今までどおり入る
    await insert("research_image", "x", "main", {
      raceId: "research:2037-10-26:a",
    });
    const def = await first(
      "SELECT column_default d FROM information_schema.columns WHERE table_name='sns_auto_send_control' AND column_name='today_thinking_enabled'",
    );
    assert.equal(def.d, "false");
    await assert.rejects(
      db.query(
        "UPDATE sns_auto_send_control SET today_thinking_enabled=true WHERE channel='youtube'",
      ),
      /today_thinking_x_only/,
    );
  });
  test("push の3本: 本投稿（画像4枚）・投票のリプ・展示後のリプが下書き・item・job になる。キーは today_thinking だけ、Storage は today-thinking/", async () => {
    const { reply } = await sttA1();
    await sttA2({ reply });
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（BASE_FILES・MIGRATION・MD5_182・MD5_188・sqlOf・md5・transitionBody・migration189ForTest・db・first・all・RACE・DEADLINE・at・NOW・setClock・saved・stageCalls・store・slotAsked・POLL・replyBundle・push・transition・claim・post・readTables） */
export function runSnsTodayThinkingScenes1(env) {
  ({
    readTables,
    post,
    claim,
    transition,
    push,
    replyBundle,
    POLL,
    slotAsked,
    store,
    stageCalls,
    saved,
    setClock,
    NOW,
    at,
    DEADLINE,
    RACE,
    all,
    first,
    db,
    migration189ForTest,
    transitionBody,
    md5,
    sqlOf,
    MD5_188,
    MD5_182,
    MIGRATION,
    BASE_FILES,
  } = env);
  stt1Scene1();
  stt1Scene2();
  stt1Scene3();
}
