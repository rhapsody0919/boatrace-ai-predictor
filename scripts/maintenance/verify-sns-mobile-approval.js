import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { mobileHolds, sendHolds } from "../../api/_lib/snsMobileApproval.js";
import { createXSnapshot } from "../../api/_lib/snsXSend.js";
import { inspectDraft } from "../../api/_lib/snsEditAssist.js";
const db = new PGlite();
const first = async (sql, args = []) => (await db.query(sql, args)).rows[0];
let approver;
const media = async () => new Uint8Array([1, 2, 3]);
const source = () => ({
  race_id: "2026-10-07-11-10",
  stage: "exhibition",
  bundle: {
    claims: [
      {
        source: "layer",
        path: ["count"],
        value: 12,
        count: 12,
        scope: "当日の出走選手",
      },
    ],
  },
  source_manifest: [
    {
      name: "layer.json",
      hash_verified: true,
      sha256: "a".repeat(64),
      stage: "exhibition",
      source_url: "https://example.com/source",
      fetched_at: new Date().toISOString(),
    },
  ],
  qa: { pass: true, numeric_claims_match: true },
  release_evidence: { status: "released", url: "https://example.com/release" },
  deadline_queue: {
    deadline_at: new Date(Date.now() + 7200000).toISOString(),
    expires_at: new Date(Date.now() + 3600000).toISOString(),
  },
});
before(async () => {
  await db.exec(
    "CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;",
  );
  for (const f of [
    "035_sns_marketing_hub_schema.sql",
    "042_content_drafts_columns.sql",
    "135_sns_preview_bundle_import.sql",
    "137_sns_x_send.sql",
    "139_sns_deadline_queue.sql",
    "140_sns_mobile_approval.sql",
    "145_sns_edit_assist.sql",
    "163_drop_sns_mobile_approval.sql",
  ])
    await db.exec(
      await readFile(
        new URL("../../docs/db-migration/" + f, import.meta.url),
        "utf8",
      ),
    );
  approver = (
    await first("SELECT id FROM sns_approvers WHERE display_name='本人'")
  ).id;
});
after(() => db.close());
async function draft(platform = "x", group = null) {
  return first(
    "INSERT INTO sns_drafts(content_group_id,format,platform,language,caption_text,title,video_storage_path,source_data,risk_flags) VALUES(coalesce($1::uuid,gen_random_uuid()),'short',$2,'ja','ボートレースの発見','タイトル','demo/a.mp4',$3,'[]') RETURNING *",
    [group, platform, source()],
  );
}
// 版（140 sns_mobile_revision）は 145 の編集指摘・147 の差分が使うので、163 の後も残る
async function row(d) {
  const { revision } = await first(
    "SELECT sns_mobile_revision(d) revision FROM sns_drafts d WHERE id=$1",
    [d.id],
  );
  return { draft: d, revision };
}
// 個別承認の RPC（approve_sns_mobile_channel）は 163 で削除。承認は approve_sns_x_send で行う
const approve = async (d) =>
  (
    await first("SELECT approve_sns_x_send($1,$2,$3,NULL) result", [
      d.id,
      approver,
      await createXSnapshot(d, media),
    ])
  ).result;
test("動画未完成、QA失敗、出典/件数/範囲/公開証拠欠落、v0は保留", async () => {
  const d = await draft("youtube");
  for (const change of [
    (v) => (v.video_storage_path = null),
    (v) => (v.source_data.qa.pass = false),
    (v) => (v.source_data.source_manifest = []),
    (v) => delete v.source_data.bundle.claims[0].count,
    (v) => delete v.source_data.bundle.claims[0].scope,
    (v) => delete v.source_data.release_evidence,
    (v) => (v.bundle_version_hash = "v0"),
    (v) => (v.risk_flags = [{ id: "L0" }]),
  ]) {
    const v = structuredClone(d);
    change(v);
    assert.ok(sendHolds(v).length > 0);
  }
});
test("素材 v1: 照合の結果と表示の確認がそろえば保留なし、照合の未完了・版の不一致・公開保留は保留（tasks 11）", () => {
  const future = new Date(Date.now() + 3600000).toISOString();
  const v1 = {
    status: "pending_review",
    platform: "x",
    bundle_import_id: "b1",
    bundle_version_hash: "h1",
    publish_blocked: false,
    publication_hold_reasons: [],
    risk_flags: [],
    video_storage_path: "bundle-imports/h1/draft-x.mp4",
    source_data: {
      schema_version: "ryujin-preview/1",
      bundle: { claims: [{ id: "c1", text: "t", value: 30, source: { endpoint: "/api/analogy/facts/2026-10-16-11-12", path: ["count"] } }] },
      qa: { pass: true, numeric_claims_match: true },
      release_evidence: { status: "released", url: "https://www.boat-ai.jp/race/2026-10-16-11-12?tab=sonar" },
      claim_check: { ok: true, revision: "r1" },
      deadline_queue: { expires_at: future, deadline_at: future, source_revision: "r1" },
    },
  };
  assert.deepEqual(sendHolds(v1), []);
  assert.equal(mobileHolds, sendHolds);
  const cases = [
    [(v) => delete v.source_data.claim_check, "数値の照合が未完了・不一致"],
    [(v) => (v.source_data.claim_check.ok = false), "数値の照合が未完了・不一致"],
    [(v) => (v.source_data.deadline_queue.source_revision = "r0"), "数値の照合が未完了・不一致"],
    [(v) => (v.publish_blocked = true), "公開保留素材"],
    [(v) => delete v.source_data.release_evidence, "正式公開証拠なし"],
    [(v) => (v.source_data.qa.numeric_claims_match = false), "QA未確認・失敗"],
  ];
  for (const [change, reason] of cases) {
    const v = structuredClone(v1);
    change(v);
    assert.ok(sendHolds(v).includes(reason), reason);
  }
  // v0 は bundle 由来なら publish_blocked に関係なく保留のまま
  const v0 = structuredClone(v1);
  v0.source_data.schema_version = "ryujin-preview/0";
  assert.ok(sendHolds(v0).includes("公開保留素材"));
});
test("163: 個別承認の表・RPC は無く、版の関数は残って一般ロールに公開しない", async () => {
  assert.equal(
    (await first("SELECT to_regclass('public.sns_mobile_reviews') r")).r,
    null,
  );
  for (const sig of [
    "public.read_sns_mobile_race(uuid)",
    "public.approve_sns_mobile_channel(uuid,uuid,text,jsonb,timestamptz,integer)",
  ])
    assert.equal((await first("SELECT to_regprocedure($1) r", [sig])).r, null);
  assert.ok(
    (await first("SELECT to_regprocedure('public.sns_mobile_revision(sns_drafts)') r")).r,
  );
  await db.exec("SET ROLE authenticated");
  await assert.rejects(() =>
    db.query("SELECT sns_mobile_revision(d) FROM sns_drafts d LIMIT 1"),
  );
  await db.exec("RESET ROLE");
});

test("承認後のrisk変更で承認を消しjobを取消", async () => {
  const d = await draft();
  await approve(d);
  await db.query("UPDATE sns_drafts SET risk_flags=$2 WHERE id=$1", [
    d.id,
    [{ id: "L0" }],
  ]);
  assert.equal(
    (await first("SELECT x_approved_hash FROM sns_drafts WHERE id=$1", [d.id]))
      .x_approved_hash,
    null,
  );
  assert.equal(
    (await first("SELECT state FROM sns_x_send_jobs WHERE draft_id=$1", [d.id]))
      .state,
    "cancelled",
  );
});

test("版hash（sns_mobile_revision）は接続のTimeZone設定に依存しない", async () => {
  const d = await draft();
  await db.query(
    "UPDATE sns_drafts SET scheduled_at=now()+interval '2 hours' WHERE id=$1",
    [d.id],
  );
  await db.exec("SET TimeZone='Asia/Tokyo'");
  const jst = (
    await first(
      "SELECT sns_mobile_revision(sns_drafts) h FROM sns_drafts WHERE id=$1",
      [d.id],
    )
  ).h;
  await db.exec("SET TimeZone='America/Los_Angeles'");
  const pst = (
    await first(
      "SELECT sns_mobile_revision(sns_drafts) h FROM sns_drafts WHERE id=$1",
      [d.id],
    )
  ).h;
  await db.exec("RESET TimeZone");
  assert.equal(jst, pst, "TimeZoneが違う接続でも同じ下書きは同じ版hashになる");
});

test("編集指摘の冪等保存・採用/無視の追記履歴は本文と承認版を変えない", async () => {
  const d = await draft(),
    r = await row(d);
  const findings = inspectDraft(d, []);
  assert.ok(findings.length > 0);
  const save = async () =>
    (
      await first("SELECT save_sns_edit_inspection($1,$2,$3,$4) result", [
        d.id,
        r.revision,
        "test-v1",
        findings,
      ])
    ).result;
  const i = await save();
  assert.equal((await save()).id, i.id);
  const decide = async (decision) =>
    (
      await first("SELECT decide_sns_edit_finding($1,$2,$3,$4,$5,$6) result", [
        d.id,
        r.revision,
        i.id,
        findings[0].id,
        approver,
        decision,
      ])
    ).result;
  assert.equal((await decide("adopted")).decisions[findings[0].id], "adopted");
  assert.equal((await decide("ignored")).decisions[findings[0].id], "ignored");
  assert.equal(
    (
      await first(
        "SELECT count(*) n FROM sns_edit_decisions WHERE inspection_id=$1",
        [i.id],
      )
    ).n,
    2,
  );
  assert.equal((await row(d)).revision, r.revision);
  await approve(d);
  assert.equal(
    (await first("SELECT status FROM sns_drafts WHERE id=$1", [d.id])).status,
    "approved",
  );
});
test("他版・別下書き・存在しない指摘・本人以外の判断と一般ロールを拒否", async () => {
  const d = await draft(),
    r = await row(d),
    findings = inspectDraft(d, []);
  const i = (
    await first("SELECT save_sns_edit_inspection($1,$2,$3,$4) result", [
      d.id,
      r.revision,
      "test-v1",
      findings,
    ])
  ).result;
  const other = await draft(),
    guest = await first(
      "INSERT INTO sns_approvers(display_name) VALUES('点検係') RETURNING id",
    );
  const args = [d.id, r.revision, i.id, findings[0].id, approver, "ignored"];
  for (const [index, value] of [
    [0, other.id],
    [1, "old"],
    [3, "missing"],
    [4, guest.id],
    [5, "invalid"],
  ]) {
    const a = [...args];
    a[index] = value;
    await assert.rejects(() =>
      first("SELECT decide_sns_edit_finding($1,$2,$3,$4,$5,$6)", a),
    );
  }
  // 「本人」以外（自動承認等）を選んだ場合は、APIがこの固定文言だけを安全に
  // クライアントへ通す契約になっている（他の拒否理由は汎用文言に倒す）。
  const guestArgs = [...args];
  guestArgs[4] = guest.id;
  await assert.rejects(
    () => first("SELECT decide_sns_edit_finding($1,$2,$3,$4,$5,$6)", guestArgs),
    /本人の判断が必要です/,
  );
  await db.query("UPDATE sns_drafts SET caption_text='変更' WHERE id=$1", [
    d.id,
  ]);
  // 既に(draft,revision,engine)が存在する場合は、下書きの現在値を再検証しない
  // （冪等再保存の仕様。別テスト「同じ(draft,revision,engine)への再保存は…」参照）。
  // decide側（指摘の採用/無視、消費を伴う操作）は引き続き拒否することを以下で確認する。
  assert.equal(
    (
      await first("SELECT save_sns_edit_inspection($1,$2,$3,$4) result", [
        d.id,
        r.revision,
        "test-v1",
        findings,
      ])
    ).result.id,
    i.id,
  );
  await assert.rejects(
    () => first("SELECT decide_sns_edit_finding($1,$2,$3,$4,$5,$6)", args),
    /版が変わりました/,
  );
  await db.exec("SET ROLE authenticated");
  await assert.rejects(() => db.query("SELECT * FROM sns_edit_inspections"));
  await assert.rejects(() => db.query("SELECT * FROM sns_edit_decisions"));
  await assert.rejects(() =>
    db.query("SELECT read_sns_edit_inspection($1)", [i.id]),
  );
  await assert.rejects(() =>
    db.query("SELECT decide_sns_edit_finding($1,$2,$3,$4,$5,$6)", args),
  );
  await db.exec("RESET ROLE");
});

test("同じ(draft,revision,engine)への再保存は、下書きが別の値に変わっていても下書きを再検証しない", async () => {
  const d = await draft(),
    r = await row(d),
    findings = inspectDraft(d, []);
  const save = (revision) =>
    first("SELECT save_sns_edit_inspection($1,$2,$3,$4) result", [
      d.id,
      revision,
      "test-v1-skip-rewrite",
      findings,
    ]).then((row) => row.result);
  const i = await save(r.revision);
  // GETのたびに同じ版hashで呼ばれても、既存行を見つけたら下書きの行ロック・再検証を
  // 経由しない（過去のDisk IO Budget枯渇と同型の負荷を避ける）。本文を変えて実際の
  // 版hashをr.revisionから変化させた後でも、古いrevisionでの再保存は下書きの現在値を
  // 見ずに既存行をそのまま返すことを確認する。
  await db.query("UPDATE sns_drafts SET caption_text='別の本文' WHERE id=$1", [
    d.id,
  ]);
  assert.notEqual((await row(d)).revision, r.revision);
  assert.equal((await save(r.revision)).id, i.id);
});

test("/today の投稿（tasks 19b）は一覧の版が承認の版と同じときだけ保留にしない（素材の claims は見ない）", async () => {
  const draft = (revision, queueRevision) => ({
    platform: "x",
    status: "pending_review",
    publish_blocked: false,
    publication_hold_reasons: [],
    risk_flags: [],
    bundle_import_id: null,
    source_data: {
      digest: { date: "2026-10-17", revision },
      qa: { pass: true, numeric_claims_match: true, L0_hits: [] },
      release_evidence: { status: "released", url: "https://www.boat-ai.jp/today" },
      deadline_queue: {
        deadline_at: new Date(Date.now() + 7200000).toISOString(),
        expires_at: new Date(Date.now() + 3600000).toISOString(),
        source_revision: queueRevision,
      },
    },
  });
  assert.deepEqual(sendHolds(draft("r1", "r1")), []);
  assert.deepEqual(sendHolds(draft("r1", "r2")), ["一覧の版が未確認・不一致"]);
  assert.deepEqual(sendHolds(draft(null, null)), ["一覧の版が未確認・不一致"]);
});
