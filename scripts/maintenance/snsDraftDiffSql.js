// snsDraftDiff.js のSQL の部（実SQL、認証前DB不接続、行ロック下の版照合）。verify-sns-bundle-import.js → snsDraftDiff.js から呼ぶ。文は分ける前の snsDraftDiff.js のまま（100行の線で関数に割り、外の名前は引数で受ける）。

import assert from "node:assert/strict";

async function applyMigrations(db, readFile) {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  for (const name of [
    "035_sns_marketing_hub_schema.sql",
    "042_content_drafts_columns.sql",
    "135_sns_preview_bundle_import.sql",
    "137_sns_x_send.sql",
    "138_sns_external_operations.sql",
    "139_sns_deadline_queue.sql",
    "140_sns_mobile_approval.sql",
    "145_sns_edit_assist.sql",
    "146_sns_shorts_send.sql",
    "147_sns_draft_diff.sql",
  ]) {
    if (
      name === "147_sns_draft_diff.sql" &&
      process.argv.includes("--without-diff-migration")
    )
      continue;
    try {
      await db.exec(
        await readFile(
          new URL(`../../docs/db-migration/${name}`, import.meta.url),
          "utf8",
        ),
      );
    } catch (e) {
      throw new Error(`${name}: ${e.message}`);
    }
  }
}

function helpersOf(db, draftContent) {
  const first = async (sql, args = []) => {
    try {
      return (await db.query(sql, args)).rows[0];
    } catch (e) {
      throw new Error(e.message);
    }
  };
  const read = async (id) =>
    (await first("SELECT read_sns_draft_diff($1) AS data", [id])).data;
  const save = async (row, media = {}) =>
    (
      await first("SELECT save_sns_draft_diff($1,$2,$3) AS data", [
        row.draft.id,
        row.revision,
        { content: draftContent(row.draft), media },
      ])
    ).data;
  return { first, read, save };
}

async function sceneLineage({ db, first, read, save, compareDraftSnapshots }) {
  const old = await first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,title,caption_text,source_data) VALUES(gen_random_uuid(),'short','x','ja','旧版','件数30','{\"n\":30}') RETURNING *",
  );
  let row = await read(old.id);
  await save(row);
  assert.equal((await read(old.id)).previous, null);
  // 承認の瞬間を保存。本文変更・失効後も最後の承認版は残る。
  await db.query(
    "UPDATE sns_drafts SET approved_at=now(),status='approved' WHERE id=$1",
    [old.id],
  );
  await db.query(
    "UPDATE sns_drafts SET title='新タイトル',caption_text='件数31',source_data='{\"n\":31}' WHERE id=$1",
    [old.id],
  );
  await assert.rejects(() => save(row), /表示した版が変わりました/);
  row = await read(old.id);
  const saved = await save(row);
  assert.equal(saved.previous.content.caption_text, "件数30");
  assert.equal(saved.approved.content.caption_text, "件数30");
  assert.equal(saved.current.content.caption_text, "件数31");
  assert.equal(
    (await save(await read(old.id))).previous.content.caption_text,
    "件数30",
    "再読込で基準を動かさない",
  );
  const child = await first(
    "INSERT INTO sns_drafts(content_group_id,parent_draft_id,format,platform,language,caption_text) VALUES($1,$2,'short','x','ja','件数32') RETURNING *",
    [old.content_group_id, old.id],
  );
  row = await read(child.id);
  assert.equal(row.previous.content.caption_text, "件数31");
  assert.equal(row.approved.content.caption_text, "件数30");
  // 同一パスのファイル置換は、過去を再hashせず保存されたhashで比較。
  await save(row, { video: { path: "same.mp4", sha256: "a" } });
  const overwritten = await save(await read(child.id), {
    video: { path: "same.mp4", sha256: "b" },
  });
  assert.equal(overwritten.previous.media.video.sha256, "a");
  assert.equal(
    compareDraftSnapshots(overwritten.previous, overwritten.current).media[0]
      .state,
    "replaced",
  );
  return { old, child };
}

async function sceneApprovedAndGuards({ db, first, read, save, old, child }) {
  // 表示後に媒体が変わっても、承認版のhashは送信snapshotから採る。
  const owner = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
  const approvedAt = "2026-10-08T12:00:00Z";
  await db.query(
    "UPDATE sns_drafts SET video_storage_path='same.mp4' WHERE id=$1",
    [old.id],
  );
  await save(await read(old.id), {
    video: { path: "same.mp4", sha256: "old-display" },
  });
  await db.query(
    "INSERT INTO sns_x_send_jobs(draft_id,state,snapshot,snapshot_text,approved_hash,approver_id,approved_at,scheduled_at) VALUES($1,'cancelled',$2,'{}','actual-hash',$3,$4,$4)",
    [
      old.id,
      { media: [{ path: "same.mp4", sha256: "actual-approved" }] },
      owner,
      approvedAt,
    ],
  );
  await db.query(
    "UPDATE sns_drafts SET approved_at=$2,x_approved_hash='actual-hash',status='approved' WHERE id=$1",
    [old.id, approvedAt],
  );
  assert.equal(
    (await read(old.id)).approved.media.video.sha256,
    "actual-approved",
  );
  await db.query(
    "UPDATE sns_drafts SET approved_at='2026-10-08T13:00:00Z',x_approved_hash=NULL WHERE id=$1",
    [old.id],
  );
  assert.equal(
    (await read(old.id)).approved.media,
    null,
    "送信snapshotのない通常承認に古いhashを流用しない",
  );
  // 不正な系統、cycle、一般ロールからの読込を拒否。
  await db.query("UPDATE sns_drafts SET parent_draft_id=id WHERE id=$1", [
    child.id,
  ]);
  await assert.rejects(() => read(child.id), /履歴を確認できません/);
  await db.exec("SET ROLE anon");
  await assert.rejects(() => read(old.id), /permission denied/);
  await db.exec("RESET ROLE");
}

export async function runDraftDiffSql({ draftContent, compareDraftSnapshots, readFile }) {
  const { PGlite } = await import("@electric-sql/pglite");
  const db = new PGlite();
  try {
    await applyMigrations(db, readFile);
    const { first, read, save } = helpersOf(db, draftContent);
    const { old, child } = await sceneLineage({ db, first, read, save, compareDraftSnapshots });
    await sceneApprovedAndGuards({ db, first, read, save, old, child });
    console.log(
      "[OK] draft diff SQL: last displayed / approved / parent / overwrite / stale / cycle / RLS",
    );
  } finally {
    await db.close();
  }
}
