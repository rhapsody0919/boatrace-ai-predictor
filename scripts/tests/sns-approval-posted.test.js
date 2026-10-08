import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

for (const platform of ['x', 'youtube']) {
  test(`${platform}: 投稿済みの編集を拒否し承認記録とjobを保持`, async () => {
    const db = new PGlite();
    try {
      await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;');
      const files = ['035_sns_marketing_hub_schema.sql', '042_content_drafts_columns.sql',
        '135_sns_preview_bundle_import.sql', '137_sns_x_send.sql', '139_sns_deadline_queue.sql',
        '140_sns_mobile_approval.sql', '141_sns_edit_assist.sql', '142_sns_shorts_send.sql'];
      if (!process.env.SNS_APPROVAL_POSTED_BASELINE) files.push('144_sns_posted_approval_guard.sql');
      for (const file of files) await db.exec(await readFile(new URL(`../../docs/db-migration/${file}`, import.meta.url), 'utf8'));
      const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
      const approver = (await first("SELECT id FROM sns_approvers WHERE display_name='本人'")).id;
      const draft = await first(`INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,video_storage_path,
        status,approver_id,approved_at,x_approved_hash) VALUES(gen_random_uuid(),'short',$1,'ja','観測した件数','a.mp4',
        'approved',$2,now(),'saved-hash') RETURNING *`, [platform, approver]);
      const job = await first(`INSERT INTO sns_x_send_jobs(draft_id,state,snapshot,snapshot_text,approved_hash,
        approver_id,approved_at,scheduled_at,channel) VALUES($1,'posted','{}','{}','saved-hash',$2,now(),now(),$3) RETURNING *`,
      [draft.id, approver, platform]);
      // jobだけがpostedの不一致状態でも、監査記録を失わせない。
      for (const edit of ["caption_text='編集'", "video_storage_path='b.mp4'", "platform='instagram'"]) {
        await assert.rejects(db.query(`UPDATE sns_drafts SET ${edit} WHERE id=$1`, [draft.id]), /投稿済み/);
      }
      assert.deepEqual(await first('SELECT * FROM sns_x_send_jobs WHERE id=$1', [job.id]), job);
      await db.query("UPDATE sns_drafts SET status='posted',posted_at=now() WHERE id=$1", [draft.id]);
      await db.query('DELETE FROM sns_x_send_jobs WHERE id=$1', [job.id]);
      // 手動投稿などjobのないposted下書きも保護。
      await assert.rejects(db.query("UPDATE sns_drafts SET cover_image_path='new.jpg' WHERE id=$1", [draft.id]), /投稿済み/);
      const saved = await first('SELECT * FROM sns_drafts WHERE id=$1', [draft.id]);
      assert.equal(saved.x_approved_hash, draft.x_approved_hash);
      assert.equal(saved.approver_id, draft.approver_id);
      assert.deepEqual(saved.approved_at, draft.approved_at);
      // 未送信下書きは従来どおり承認失効。
      const pending = await first(`INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,status,
        approver_id,approved_at,x_approved_hash) VALUES(gen_random_uuid(),'short',$1,'ja','原文','approved',$2,now(),'hash') RETURNING id`, [platform, approver]);
      await db.query("UPDATE sns_drafts SET caption_text='編集' WHERE id=$1", [pending.id]);
      const invalidated = await first('SELECT * FROM sns_drafts WHERE id=$1', [pending.id]);
      assert.equal(invalidated.status, 'pending_review');
      assert.equal(invalidated.x_approved_hash, null);
      assert.equal(invalidated.approver_id, null);
      assert.equal(invalidated.approved_at, null);
    } finally { await db.close(); }
  });
}
