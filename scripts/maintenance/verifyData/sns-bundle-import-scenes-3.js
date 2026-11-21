/**
 * verify-sns-bundle-import.js の後半の場面（3/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-bundle-import.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { checkRiskRules } from "../../lib/riskRules.js";
import assert from "node:assert/strict";
import { validateBundle, BUNDLE_SCHEMA } from "../../../api/_lib/snsBundleValidation.js";
import { importValidatedBundle } from "../../../api/_lib/snsBundleImport.js";
import { validated } from "./sns-bundle-import-scenes-1.js";
import { store } from "./sns-bundle-import-scenes-2.js";

let check, fixture, form, riskRules, db, mockHandler;

/** for (const [name, platform, field, content, warn] of cases) { の中身を割った 1/1 */
async function sbiC1({ content, enabled, field, name, platform, rows, rules, warn }) {
  const expected = warn || !enabled;
  const nodeField = ["title", "script", "scene"].includes(field)
    ? "body"
    : field;
  const node = checkRiskRules(content, platform, nodeField, rules).some(
    (r) => r.id === "banned-term-kyoutei",
  );
  const draft = {
    platform,
    status: "pending_review",
    title: "件数",
    caption_text: "確認",
  };
  const bundle = {};
  if (field === "hashtags") {
    draft.hashtags = [content];
    bundle[platform === "x" ? "x_hashtags" : "youtube_tags"] = [content];
  }
  if (field === "body") {
    draft.caption_text = content;
    bundle.x_text = content;
  }
  if (field === "description") {
    draft.caption_text = content;
    bundle.youtube_description = content;
  }
  if (field === "title") {
    draft.title = content;
    bundle.title = content;
  }
  if (field === "script") {
    draft.caption_text = content;
    draft.source_data = { bundle: { script: content } };
    bundle.script = content;
  }
  if (field === "scene") {
    bundle.scenes = Array.from({ length: 3 }, () => ({
      seconds: 6,
      tab: "観測",
      component: "件数",
      lines: [content],
    }));
    draft.source_data = { bundle: { scenes: bundle.scenes } };
  }
  const handler = await mockHandler(
    "api/admin/sns-hub/drafts/[id]/approve.js",
    draft,
    false,
    true,
    rules,
  );
  const response = await handler(
    new Request("https://local.invalid/drafts/test/approve", {
      method: "POST",
      body: JSON.stringify({ approverId: "mock" }),
    }),
  );
  assert.equal(response.status, 200);
  const api = (await response.json()).riskWarnings.some(
    (r) => r.id === "banned-term-kyoutei",
  );
  // v0 bundleはX/YouTubeのみ。他媒体は汎用matcherの保守的判定を確認する。
  const result = await validateBundle(form(await fixture(bundle)), rules);
  const bundleHit =
    platform === "tiktok"
      ? null
      : result.riskFlags[platform].some(
          (r) => r.id === "banned-term-kyoutei",
        );
  assert.equal(node, expected, name);
  assert.equal(api, expected, name);
  if (bundleHit !== null) assert.equal(bundleHit, expected, name);
  rows.push({
    enabled,
    name,
    expected: expected ? "警告" : "許可",
    Node: node,
    API: api,
    bundle: bundleHit,
  });
}

/** await check( の中身を割った 1/1 */
async function sbiD1() {
  const cases = [
    ["Xタグ", "x", "hashtags", "#競艇", false],
    ["X本文", "x", "body", "確認 #競艇", true],
    ["X別タグ", "x", "hashtags", "#競艇場", true],
    ["タグ裸語", "x", "hashtags", "競艇", true],
    ["タグ内文", "x", "hashtags", "説明 #競艇", true],
    ["YouTubeタグ", "youtube", "hashtags", "#競艇", false],
    [
      "YouTube末尾",
      "youtube",
      "description",
      "件数を確認\n#競艇 #Shorts",
      false,
    ],
    ["YouTube本文残存", "youtube", "description", "競艇の件数\n#競艇", true],
    ["YouTube途中", "youtube", "description", "#競艇 の件数", true],
    ["YouTube別タグ", "youtube", "description", "件数\n#競艇場", true],
    ["ナレーション", "youtube", "script", "確認\n#競艇", true],
    ["動画内文字", "youtube", "scene", "#競艇", true],
    ["タイトル", "youtube", "title", "#競艇", true],
    ["他媒体タグ", "tiktok", "hashtags", "#競艇", true],
  ];
  const rows = [];
  for (const enabled of [true, false]) {
    const rules = structuredClone(riskRules);
    rules.find(
      (r) => r.id === "banned-term-kyoutei",
    ).hashtag_exception.enabled = enabled;
    for (const [name, platform, field, content, warn] of cases) {
      await sbiC1({ content, enabled, field, name, platform, rows, rules, warn });
    }
  }
  console.table(rows);
  // optional欄も型検査し、ナレーションとタグ欄を混同しない。
  await assert.rejects(
    validateBundle(form(await fixture({ x_hashtags: "invalid" })), riskRules),
    /タグ欄/,
  );
}

async function sbi3Scene1() {
  await check(
    "重複・同時リクエスト・共通group・NULL型・公開情報NULL",
    async () => {
      const results = await Promise.all([
        importValidatedBundle(validated, store),
        importValidatedBundle(validated, store),
      ]);
      assert(
        results.every((r) => r.drafts.every((d) => d.result === "duplicate")),
      );
      const drafts = (await db.query("SELECT * FROM sns_drafts")).rows;
      assert.equal(drafts.length, 2);
      assert.equal(drafts[0].content_group_id, drafts[1].content_group_id);
      for (const draft of drafts) {
        assert.equal(draft.status, "pending_review");
        assert.equal(draft.template_variant_id, null);
        assert.equal(draft.publish_blocked, true);
        assert.equal(draft.bundle_import_id, draft.content_group_id);
        assert.equal(
          draft.caption_text,
          draft.platform === "x"
            ? validated.bundle.x_text
            : validated.bundle.script,
        );
      }
      const imported = (await db.query("SELECT * FROM sns_bundle_imports"))
        .rows[0];
      assert.equal(imported.release_evidence.release_status, null);
      assert(imported.release_evidence.missing_reason);
    },
  );
  await check(
    "片側DB失敗は全体rollback、再試行で2件、残存片側も補完",
    async () => {
      const other = await validateBundle(
        form(await fixture({ title: "別の素材版" })),
      );
      await db.exec(`CREATE FUNCTION mock_fail_youtube() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.platform = 'youtube' THEN RAISE EXCEPTION 'mock片側失敗'; END IF; RETURN NEW; END; $$;
    CREATE TRIGGER mock_fail_youtube BEFORE INSERT ON sns_drafts FOR EACH ROW EXECUTE FUNCTION mock_fail_youtube();`);
      await assert.rejects(() => importValidatedBundle(other, store), /片側失敗/);
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM sns_bundle_imports"))
          .rows[0].n,
        1,
      );
      assert.equal(
        (await db.query("SELECT count(*)::int AS n FROM sns_drafts")).rows[0].n,
        2,
      );
      await db.exec("DROP TRIGGER mock_fail_youtube ON sns_drafts;");
      const result = await importValidatedBundle(other, store);
      assert(result.drafts.every((d) => d.result === "created"));
      await db.query(
        "DELETE FROM sns_drafts WHERE bundle_version_hash=$1 AND platform='youtube'",
        [other.versionHash],
      );
      const repaired = await importValidatedBundle(other, store);
      assert.deepEqual(
        repaired.drafts.map((d) => d.result),
        ["duplicate", "created"],
      );
      assert.equal(repaired.content_group_id, result.content_group_id);
    },
  );
  await check("DB公開禁止・由来の除去禁止・通常下書きへの非干渉", async () => {
    for (const patch of [
      "publish_blocked=false",
      "status='approved'",
      "status='posted'",
      "bundle_import_id=NULL,bundle_version_hash=NULL",
    ]) {
      await assert.rejects(
        () => db.exec(`UPDATE sns_drafts SET ${patch} WHERE platform='x'`),
        /v0/,
      );
    }
    await db.exec(
      "INSERT INTO sns_drafts(content_group_id,format,platform,language,status) VALUES(gen_random_uuid(),'normal','x','ja','approved')",
    );
  });
}

async function sbi3Scene2() {
  await check(
    "anon/authenticatedはRPC不可・service_role実行権限あり・RLS有効",
    async () => {
      for (const role of ["anon", "authenticated"]) {
        await db.exec(`SET ROLE ${role}`);
        await assert.rejects(
          () =>
            db.query(
              "SELECT import_sns_preview_bundle($1,$2,$3,$4,$5,$6,$7,$8)",
              [validated.versionHash, BUNDLE_SCHEMA, {}, {}, [], [], [], {}],
            ),
          /permission denied/,
        );
        await db.exec("RESET ROLE");
      }
      assert.equal(
        (
          await db.query(
            "SELECT has_function_privilege('service_role','import_sns_preview_bundle(text,text,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb)','EXECUTE') AS ok",
          )
        ).rows[0].ok,
        true,
      );
      assert.equal(
        (
          await db.query(
            "SELECT relrowsecurity FROM pg_class WHERE relname='sns_bundle_imports'",
          )
        ).rows[0].relrowsecurity,
        true,
      );
      // 既存テーブルのservice role権限はSupabaseの既定権限を再現する。
      await db.exec(
        "GRANT SELECT, INSERT, UPDATE ON sns_drafts TO service_role; SET ROLE service_role;",
      );
      const result = await importValidatedBundle(validated, store);
      assert(result.drafts.every((d) => d.result === "duplicate"));
      await db.exec("RESET ROLE");
    },
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・fixture・form・riskRules・db・mockHandler） */
export async function runSnsBundleImportScenes8(env) {
  ({ check, fixture, form, riskRules, db, mockHandler } = env);
  await sbi3Scene1();
  await sbi3Scene2();
}

async function sbi3Scene3() {
  await check(
    "ハッシュタグ例外はNode・承認API・bundle・編集補助で一致しenabled一つで解除",
    async () => {
      await sbiD1();
    },
  );
  await check("承認APIとYouTube公開APIは副作用前に409・認証なし401", async () => {
    for (const name of ["approve", "publish-youtube"]) {
      const path = `api/admin/sns-hub/drafts/[id]/${name}.js`;
      for (const data of [
        { publish_blocked: true },
        { bundle_import_id: "import" },
        { bundle_version_hash: validated.versionHash },
      ]) {
        const handler = await mockHandler(path, {
          ...data,
          status: "pending_review",
          platform: "youtube",
        });
        const response = await handler(
          new Request(`https://local.invalid/drafts/id/${name}`, {
            method: "POST",
            body: JSON.stringify({ approverId: "mock" }),
          }),
        );
        assert.equal(response.status, 409);
        assert((await response.json()).error.includes("公開不可"));
      }
      const handler = await mockHandler(path, {}, true);
      assert.equal(
        (
          await handler(
            new Request(`https://local.invalid/drafts/id/${name}`, {
              method: "POST",
            }),
          )
        ).status,
        401,
      );
    }
  });
}

/** verify から呼ぶ入口。env は verify 側の束縛（check・fixture・form・riskRules・db・mockHandler） */
export async function runSnsBundleImportScenes9(env) {
  ({ check, fixture, form, riskRules, db, mockHandler } = env);
  await sbi3Scene3();
}
