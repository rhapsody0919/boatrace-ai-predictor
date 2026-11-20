/**
 * verify-sns-today-thinking.js の後半の場面（3/3）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-today-thinking.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import {
  draftRow,
  createRestStore,
  checkTodayThinkingImage,
  finalsStatus,
  resultLine,
} from "../../sns/push-finals-image.js";
import { createXSnapshot } from "../../../api/_lib/snsXSend.js";
import { readCurrent } from "./sns-today-thinking-scenes-1.js";

let openDb,
  db,
  first,
  all,
  riskRules,
  RACE,
  DAY,
  DEADLINE,
  at,
  NOW,
  setClock,
  CONTROL_SQL,
  CLEAR_SQL,
  store,
  slotAsked,
  bundle,
  push,
  transition,
  claim,
  post,
  counts,
  NOTHING,
  readTables;

/** 188 まで・188＋189 の PGlite で同じ claim を並べる（優勝戦・数字で見たら・/today） */
async function claimScenario(pg) {
  const q = async (sql, args = []) => (await pg.query(sql, args)).rows[0];
  await pg.exec(CLEAR_SQL);
  await setClock(NOW, pg);
  await pg.exec(CONTROL_SQL);
  const approver = (
    await q(
      "SELECT auto_approver_id id FROM sns_auto_send_control WHERE channel='x'",
    )
  ).id;
  let seq = 0;
  const makeJob = async (kind, expiresBefore) => {
    seq += 1;
    const deadline = new Date(NOW.getTime() + 90 * 60000).toISOString();
    const draft = await q(
      `INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,send_lane,publish_blocked,source_data)
       VALUES(gen_random_uuid(),$1,'x','ja',$2,'A',false,jsonb_build_object('deadline_queue',$3::jsonb)) RETURNING *`,
      [
        {
          finals_image: "finals_image",
          research_image: "research_image",
          digest: "today_digest",
        }[kind],
        `${kind} ${seq}`,
        {
          deadline_at: deadline,
          expires_at: new Date(
            Date.parse(deadline) - expiresBefore * 60000,
          ).toISOString(),
          source_revision: `r${seq}`,
          source_observed_at: NOW.toISOString(),
        },
      ],
    );
    await pg.query(
      `INSERT INTO sns_auto_send_items(kind,draft_id,channel,variant,race_id,deadline_at,notify_by,veto_until,state,checks,stop_token_hash,notified_at)
       VALUES($1,$2,'x',$3,$4,$5,$6,$7,'notified',$8,$9,$7)`,
      [
        kind,
        draft.id,
        kind === "finals_image" ? "finals" : "main",
        kind === "research_image"
          ? `research:2037-10-${10 + seq}:r${seq}`
          : `R${seq}`,
        deadline,
        new Date(NOW.getTime() - 60000).toISOString(),
        NOW.toISOString(),
        { passed: true },
        randomBytes(32).toString("hex"),
      ],
    );
    return (
      await q("SELECT approve_sns_x_send($1,$2,$3,$4) r", [
        draft.id,
        approver,
        await createXSnapshot(draft, async () => new Uint8Array([1, 2, 3])),
        NOW.toISOString(),
      ])
    ).r;
  };
  const claimOf = async (job) => {
    const r = await transition(job.id, "claim", {}, pg);
    return [r.state, r.error_code];
  };
  const out = [];
  out.push(await claimOf(await makeJob("finals_image", 5)));
  out.push(await claimOf(await makeJob("research_image", 60)));
  out.push(await claimOf(await makeJob("digest", 30)));
  // 期限の型が違う（5分の kind に30分）は deadline_policy_changed
  out.push(await claimOf(await makeJob("finals_image", 30)));
  out.push(await claimOf(await makeJob("digest", 5)));
  // 許可が off
  await pg.exec(
    "UPDATE sns_auto_send_control SET finals_image_enabled=false, research_image_enabled=false",
  );
  out.push(await claimOf(await makeJob("finals_image", 5)));
  out.push(await claimOf(await makeJob("research_image", 60)));
  await pg.exec(CONTROL_SQL);
  // 取り置き: finals の取り置き3を使い切った後の4本目は kind_slot_full
  for (let i = 0; i < 3; i++)
    out.push(await claimOf(await makeJob("finals_image", 5)));
  // 期限切れ
  const late = await makeJob("digest", 30);
  await setClock(new Date(NOW.getTime() + 61 * 60000), pg);
  await pg.exec(
    "UPDATE sns_x_send_control SET daily_baseline_date=(test_now() AT TIME ZONE 'Asia/Tokyo')::date",
  );
  out.push(await claimOf(late));
  return out;
}

function stt3Scene1() {
  test("期限は締切の5分前: 過ぎたら deadline_expired。5分前でない期限は deadline_policy_changed", async () => {
    const out = await push();
    await setClock(at("16:25:00"));
    const late = await claim(out.job_id);
    assert.deepEqual(
      [late.state, late.error_code],
      ["held", "deadline_expired"],
    );
    await db.exec(CLEAR_SQL);
    await db.query("INSERT INTO races VALUES($1,$2,'16:30:00',NULL)", [
      RACE,
      DAY,
    ]);
    await setClock(NOW);
    const again = await push();
    // 期限を締切の3分前にずらすと、today_thinking の5分と合わない
    await db.query(
      "UPDATE sns_x_send_jobs SET expires_at=expires_at + interval '2 minutes' WHERE id=$1",
      [again.job_id],
    );
    const changed = await claim(again.job_id);
    assert.equal(changed.error_code, "deadline_policy_changed");
  });
  test("取り置き: today_thinking の取り置きは本投稿と投票の2本で数え、入らなければ claim で held（kind_slot_full）", async () => {
    // 上限6・他の出し物の取り置き（digest 1・finals 3・research 月曜 1）＝5 なので、today_thinking は1本しか入らない
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=6");
    const room = (
      await first(
        "SELECT sns_x_slot_room('today_thinking', 2, true, NULL, NULL) r",
      )
    ).r;
    assert.deepEqual(
      [room.ok, room.reason, room.reserve],
      [false, "kind_slot_full", 6],
    );
    const out = await push();
    assert.match(
      out.reasons.join(),
      /X の日の枠に today_thinking（2本）が入らない/,
    );
    // 押し込んだ job も claim で held（作られた後に枠が埋まった場合）
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=11");
    const ok = await push();
    await db.exec("UPDATE sns_x_send_control SET daily_limit_x=6");
    const r = await claim(ok.job_id);
    assert.deepEqual([r.state, r.error_code], ["held", "kind_slot_full"]);
  });
}

function stt3Scene2() {
  test("readCurrent の today_thinking の枝: 段を読まず、item の kind・許可・送ったかを見る。kind が食い違えば投げる", async () => {
    await push();
    const draft = await first(
      "SELECT * FROM sns_drafts WHERE source_data->'today_thinking'->>'part'='main'",
    );
    readTables.length = 0;
    assert.deepEqual(await readCurrent(draft.id), {
      withdrawn: false,
      cancelled: false,
      deadline_at: DEADLINE,
      source_revision: draft.source_data.today_thinking.revision,
      // リンクを置かない型なので、送る直前の表示の確認（Chromium）の代わりに文にリンクが無いことを見る（審査 P3）
      public_check: "none",
    });
    assert.ok(!readTables.includes("race_conditions"));
    await db.exec(
      "UPDATE sns_auto_send_control SET today_thinking_enabled=false",
    );
    await assert.rejects(readCurrent(draft.id), /today_thinking_disabled/);
    await db.exec(
      "UPDATE sns_auto_send_control SET today_thinking_enabled=(channel='x')",
    );
    await db.exec(
      "UPDATE sns_auto_send_items SET state='sent' WHERE variant='thinking'",
    );
    await assert.rejects(readCurrent(draft.id), /thinking_already_sent/);
    // 投票のリプは自分の種類だけを見る（本投稿を送った後も止まらない）
    const pollDraft = await first(
      "SELECT * FROM sns_drafts WHERE source_data->'today_thinking'->>'part'='poll'",
    );
    assert.equal((await readCurrent(pollDraft.id)).cancelled, false);
    // 下書きは today_thinking のキーなのに item が別の kind（優勝戦）にひもづく
    await db.exec(
      "UPDATE sns_auto_send_items SET kind='finals_image', variant='finals_poll' WHERE variant='thinking_poll'",
    );
    await assert.rejects(readCurrent(pollDraft.id), /thinking_item_mismatch/);
    // item のレース・本数の種類（variant）が下書きと食い違っても投げる（審査 P3）
    await db.exec(
      "UPDATE sns_auto_send_items SET kind='today_thinking', variant='thinking_reply' WHERE variant='finals_poll'",
    );
    await assert.rejects(readCurrent(pollDraft.id), /thinking_item_mismatch/);
    await db.exec(
      "UPDATE sns_auto_send_items SET variant='thinking_poll', race_id='2037-10-27-01-01' WHERE variant='thinking_reply'",
    );
    await assert.rejects(readCurrent(pollDraft.id), /thinking_item_mismatch/);
    // 下書きに優勝戦のキーを入れない（入れると優勝戦の枝に振り分けられる）
    const row = draftRow(bundle(), {
      revision: "r",
      when: { send_at: "x", deadline_at: DEADLINE, expires_at: DEADLINE },
      observedAt: "o",
      kind: "today_thinking",
    });
    assert.equal(row.source_data.finals_image, undefined);
    assert.equal(row.source_data.digest, undefined);
  });
  test("マイグレーションの前（許可の列が無く PostgREST が 400）: 優勝戦は今のまま読め、思考投稿は off として扱う", async () => {
    const asked = [];
    const fetchImpl = async (url) => {
      asked.push(url);
      const select = new URL(url).searchParams.get("select") ?? "";
      if (select.includes("today_thinking_enabled"))
        return new Response('{"code":"42703"}', { status: 400 });
      const row = (channel) => ({
        channel,
        mode: "auto",
        dry_run: false,
        auto_approver_id: "a",
        ...(select.includes("finals_image_enabled")
          ? { finals_image_enabled: channel === "x" }
          : {}),
      });
      return new Response(JSON.stringify([row("x"), row("youtube")]), {
        status: 200,
      });
    };
    const rest = createRestStore({
      url: "https://db.test",
      key: "k",
      fetchImpl,
    });
    const finals = await rest.controls();
    assert.equal(finals.x.finals_image_enabled, true);
    assert.ok(!asked.some((u) => u.includes("today_thinking_enabled")));
    const thinking = await rest.controls("today_thinking_enabled");
    assert.equal(thinking.x.today_thinking_enabled, undefined);
    assert.equal(thinking.x.mode, "auto");
    await assert.rejects(
      rest.controls("x_enabled"),
      /許可の列 x_enabled を知らない/,
    );
    // 思考投稿の push は列が無いと off（何も書かない）
    const off = await push(
      bundle(),
      {},
      { ...store, controls: () => thinking },
    );
    assert.equal(off.disabled, true);
    assert.deepEqual(await counts(), NOTHING);
  });
}

function stt3Scene3() {
  test("優勝戦・数字で見たら・/today の claim は 188 と同じ結果（188 までを当てた PGlite と並べる）", async () => {
    const base = await openDb(false);
    try {
      const expected = await claimScenario(base);
      const actual = await claimScenario(db);
      assert.deepEqual(actual, expected);
      // 並べた結果が何も試していない（全部同じ状態）でないこと
      assert.deepEqual(
        [...new Set(expected.map(([s, e]) => `${s}:${e}`))].sort(),
        [
          "held:deadline_expired",
          "held:deadline_policy_changed",
          "held:finals_image_disabled",
          "held:kind_slot_full",
          "held:research_image_disabled",
          "sending:null",
        ],
      );
    } finally {
      await base.close();
    }
  });
  test("BOA-1208: poll・poll_text の無い today_thinking_image は通り、本投稿だけを作る（投票のリプの item・下書きなし、取り置きは1本）。reply も無くても --status は完了", async () => {
    const { poll: _poll, poll_text: _pollText, ...noPoll } = bundle();
    assert.deepEqual(checkTodayThinkingImage(noPoll, riskRules), []);
    // 片方だけは拒否（半端な束を送らない）
    assert.match(
      checkTodayThinkingImage(
        bundle({ poll_text: undefined }),
        riskRules,
      ).join(),
      /poll_text が無い/,
    );
    const main = await push(noPoll);
    assert.equal(main.reasons, undefined, JSON.stringify(main));
    assert.equal(main.kind, "today_thinking");
    assert.ok(main.job_id);
    assert.equal(main.poll_draft_id, undefined);
    assert.equal(main.poll_job_id, undefined);
    assert.deepEqual(slotAsked, [["today_thinking", 1]]);
    assert.deepEqual(
      (
        await all(
          "SELECT kind, variant, state FROM sns_auto_send_items ORDER BY variant",
        )
      ).map((i) => [i.kind, i.variant, i.state]),
      [["today_thinking", "thinking", "notified"]],
    );
    assert.deepEqual(await counts(), {
      drafts: 1,
      items: 1,
      jobs: 1,
      saved: 4,
    });
    assert.equal(
      (
        await first(
          "SELECT count(*) n FROM sns_x_send_jobs WHERE parent_job_id IS NOT NULL",
        )
      ).n,
      0,
    );
    await setClock(NOW);
    await post(main.job_id, "1890000000000000061", "2037-10-26T07:15:30Z");
    const status = await finalsStatus(RACE, { store, kind: "today_thinking" });
    assert.equal(status.job_state, "posted");
    assert.equal(status.poll, null);
    assert.equal(status.reply, null);
    const line = resultLine(RACE, main, status);
    assert.equal(line.code, 0);
    assert.match(line.text, /"outcome":"posted"/);
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（openDb・db・first・all・riskRules・RACE・DAY・DEADLINE・at・NOW・setClock・CONTROL_SQL・CLEAR_SQL・store・slotAsked・bundle・push・transition・claim・post・counts・NOTHING・readTables） */
export function runSnsTodayThinkingScenes3(env) {
  ({
    openDb,
    db,
    first,
    all,
    riskRules,
    RACE,
    DAY,
    DEADLINE,
    at,
    NOW,
    setClock,
    CONTROL_SQL,
    CLEAR_SQL,
    store,
    slotAsked,
    bundle,
    push,
    transition,
    claim,
    post,
    counts,
    NOTHING,
    readTables,
  } = env);
  stt3Scene1();
  stt3Scene2();
  stt3Scene3();
}
