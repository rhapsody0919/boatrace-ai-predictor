/**
 * verify-upset-win.js の後半の場面（5/5）。verify ではない。
 * 判定と期待値は分ける前の verify-upset-win.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { shapeRace } from "../../../sns-video-studio/remotion/src/upsetWin/model.js";
import { db, all } from "./upset-win-scenes-2.js";
import { push } from "./upset-win-scenes-3.js";

let at, UPSET_ID, bundle;

function upw5Scene1() {
  test("中止の判定: confirmed かつ1着が無いときだけ中止。confirmed のまま結果がある・tentative は行われたレースとして数える（/code-review の指摘）", () => {
    const base = {
      race_id: "2026-11-03-17-10",
      race_date: "2026-11-03",
      venue_code: 17,
      race_number: 10,
    };
    const done = { rank1: 4, winning_technique: "まくり", race_status: "normal" };
    assert.equal(
      shapeRace({
        race: { ...base, cancellation_status: "confirmed" },
        result: done,
      }).cancelled,
      false,
    );
    assert.equal(
      shapeRace({
        race: { ...base, cancellation_status: "tentative" },
        result: done,
      }).cancelled,
      false,
    );
    assert.equal(
      shapeRace({
        race: { ...base, cancellation_status: "confirmed" },
        result: null,
      }).cancelled,
      true,
    );
    assert.equal(
      shapeRace({ race: { ...base, cancellation_status: null }, result: { ...done, race_status: "no_race" } }).no_race,
      true,
    );
  });
  test("作りかけの item（job の無い notified）は、作ってから5分の間は止めない（並行の push が作りかけを止めない）。5分を過ぎたら作り直す（/code-review の指摘）", async () => {
    await db.query(
      `WITH draft AS (INSERT INTO sns_drafts(content_group_id,platform,language,format,caption_text)
       VALUES(gen_random_uuid(), 'youtube', 'ja', 'upset_win_short', 'x') RETURNING id)
     INSERT INTO sns_auto_send_items(kind,variant,draft_id,channel,race_id,deadline_at,notify_by,veto_until,state,checks,notified_at,stop_token_hash,created_at)
     SELECT 'upset_win_short','main',id,'youtube',$1,$2::timestamptz+interval '2h',$2::timestamptz-interval '1 minute',$2::timestamptz+interval '10 minutes','notified','{"passed":true}',$2::timestamptz,md5('x'),$2::timestamptz FROM draft`,
      [UPSET_ID, at("07:02:00").toISOString()],
    );
    const fresh = await push();
    assert.equal(fresh.already, true, JSON.stringify(fresh.reasons));
    const later = await push(bundle(), { now: at("07:08:00") });
    assert.ok(later.job_id, JSON.stringify(later));
    const items = await all(
      "SELECT state FROM sns_auto_send_items ORDER BY created_at",
    );
    assert.deepEqual(
      items.map((i) => i.state),
      ["stopped", "notified"],
    );
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（at・UPSET_ID・bundle） */
export function runUpsetWinScenes6(env) {
  ({ at, UPSET_ID, bundle } = env);
  upw5Scene1();
}
