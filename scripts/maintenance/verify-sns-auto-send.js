// SQL153・154・158（SNS の自動送信・取り込みジョブ・通り道 A/B・/today・月の自動切り替え）の再現テスト。PGlite、外部接続なし。
// 設計: docs/design/sns-pdca-loop/plan.md、ADR 0094。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { PGlite } from "@electric-sql/pglite";

import { PRE_153, runSnsAutoSendScenes1, runSnsAutoSendScenes2 } from "./verifyData/sns-auto-send-scenes-1.js";
import { runSnsAutoSendScenes3 } from "./verifyData/sns-auto-send-scenes-2.js";
import { runSnsAutoSendScenes4, runSnsAutoSendScenes5 } from "./verifyData/sns-auto-send-scenes-3.js";
import { runSnsAutoSendScenes6, runSnsAutoSendScenes7 } from "./verifyData/sns-auto-send-scenes-4.js";

const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
const all = async (sql, args = []) => (await db.query(sql, args)).rows;
const loadMedia = async () => new Uint8Array([1, 2, 3]);
// JST 12:00・太平洋時間 10/12 20:00。60分＋αずらしても日付をまたがない
const T0 = Date.parse("2026-10-13T03:00:00Z");
const at = (minutes) => new Date(T0 + minutes * 60000).toISOString();
const setClock = (minutes) =>
  db.query("UPDATE test_clock SET value=$1", [at(minutes)]);
const transition = async (id, action, result = {}) =>
  (
    await first("SELECT transition_sns_x_send($1,$2,$3) r", [
      id,
      action,
      result,
    ])
  ).r;

// ---- 後半の場面（verifyData/sns-auto-send-scenes-1.js） ----
runSnsAutoSendScenes1({ db, first, all, loadMedia, at, setClock, transition });

// import.meta は verifyData へ移せないので、migration の読みだけ verify に残す（before の中身は verifyData へ移る）
const readMigration = (file) =>
  readFile(new URL("../../docs/db-migration/" + file, import.meta.url), "utf8");

// ---- 後半の場面（verifyData/sns-auto-send-scenes-1.js・sns-auto-send-scenes-2.js・sns-auto-send-scenes-3.js） ----
runSnsAutoSendScenes2({ db, first, all, loadMedia, at, setClock, transition, readMigration });
runSnsAutoSendScenes3({ db, first, at, setClock, transition });
runSnsAutoSendScenes4({ db, first, all, at, setClock, transition });

test("153-runbook.md の手順1・手順3の md5 が、置き換え前（本番と一致した版）と 153・154 の定義に合う", async () => {
  const runbook = await readFile(
    new URL("../../docs/db-migration/153-runbook.md", import.meta.url),
    "utf8",
  );
  const blocks = [...runbook.matchAll(/```sql\n([\s\S]*?)```/g)].map(
    (m) => m[1],
  );
  const md5Query = (block) => block.slice(0, block.indexOf(";"));
  const allOk = async (pg, block) =>
    (await pg.query(md5Query(block))).rows.map((row) => [row.proname, row.ok]);
  const before = new PGlite();
  try {
    // now() を置き換えない素の SQL で入れる（md5 は本番と同じ定義の文字列で比べる）
    await before.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off');",
    );
    for (const file of PRE_153)
      await before.exec(
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        ),
      );
    const pre = await allOk(before, blocks[0]);
    assert.equal(pre.length, 5);
    assert.ok(
      pre.every(([, ok]) => ok),
      JSON.stringify(pre),
    );
    for (const file of [
      "153_sns_auto_send.sql",
      "154_sns_tokens_metric_jobs.sql",
    ])
      await before.exec(
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        ),
      );
    const post = await allOk(before, blocks[1]);
    assert.equal(post.length, 11);
    assert.ok(
      post.every(([, ok]) => ok),
      JSON.stringify(post),
    );
  } finally {
    await before.close();
  }
});

// ---- 後半の場面（verifyData/sns-auto-send-scenes-3.js・sns-auto-send-scenes-4.js） ----
runSnsAutoSendScenes5({ db, first, all, at, setClock, transition });
runSnsAutoSendScenes6({ db, first, at, setClock, transition });

test("158-runbook.md の手順1・手順3の md5 が、153・154 の定義と 158 の定義に合う", async () => {
  const runbook = await readFile(
    new URL("../../docs/db-migration/158-runbook.md", import.meta.url),
    "utf8",
  );
  const blocks = [...runbook.matchAll(/```sql\n([\s\S]*?)```/g)].map(
    (m) => m[1],
  );
  const okRows = async (pg, block) =>
    (await pg.query(block.slice(0, block.indexOf(";")))).rows;
  const pg = new PGlite();
  try {
    await pg.exec(
      "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE scrape_job_state(job TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'off');",
    );
    for (const file of [
      ...PRE_153,
      "153_sns_auto_send.sql",
      "154_sns_tokens_metric_jobs.sql",
    ])
      await pg.exec(
        await readFile(
          new URL("../../docs/db-migration/" + file, import.meta.url),
          "utf8",
        ),
      );
    const pre = await okRows(pg, blocks[0]);
    assert.equal(pre.length, 3);
    assert.ok(
      pre.every((r) => r.ok),
      JSON.stringify(pre),
    );
    await pg.exec(
      await readFile(
        new URL(
          "../../docs/db-migration/158_sns_lanes_digest_period.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const post = await okRows(pg, blocks[1]);
    assert.equal(post.length, 4);
    assert.ok(
      post.every((r) => r.ok),
      JSON.stringify(post),
    );
  } finally {
    await pg.close();
  }
});

// ---- 後半の場面（verifyData/sns-auto-send-scenes-4.js） ----
runSnsAutoSendScenes7({ db, first, at, setClock, transition });
