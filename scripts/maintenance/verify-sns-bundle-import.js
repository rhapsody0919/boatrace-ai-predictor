/** 本番接続なし。検査・保存モック・実SQL(PGlite)・公開APIガードを検証する。 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  BUNDLE_SCHEMA,
  BUNDLE_LIMITS,
  validateBundle,
  readBundleForm,
  sha256,
} from "../../api/_lib/snsBundleValidation.js";
import { importValidatedBundle } from "../../api/_lib/snsBundleImport.js";

const root = new URL("../../", import.meta.url);
const encode = (s) => new TextEncoder().encode(s);
const json = (v) => encode(JSON.stringify(v));
let count = 0;
async function check(label, run) {
  await run();
  console.log(`[OK] ${label}`);
  count++;
}
async function fixture(change = {}) {
  const bundle = {
    schema_version: BUNDLE_SCHEMA,
    race_id: "2026-10-07-11-10",
    stage: "racecard",
    local_only: true,
    release_verified: false,
    approval_status: "draft",
    format: "sonar-counts-v0",
    template_variant_id: "loc_win",
    title: "準優勝戦の展望",
    script: "観測した件数を確認",
    x_text: "過去の結果は今日を保証しません",
    scenes: Array.from({ length: 3 }, () => ({
      seconds: 6,
      tab: "差がつく材料",
      component: "観測件数",
      lines: ["件数を確認"],
    })),
    claims: [{ source: "facts", path: ["count"], value: 30 }],
    source_data: {},
    ...change,
  };
  const files = new Map([
    ["bundle.json", json(bundle)],
    ["qa.json", json({ pass: true, human_review: "pending" })],
    ["script.txt", encode(bundle.script)],
    ["x-draft.txt", encode(bundle.x_text)],
    [
      "draft.mp4",
      new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]),
    ],
    ...[1, 2, 3].map((i) => [
      `scene-${i}.png`,
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, i]),
    ]),
  ]);
  for (const source of ["facts", "similar", "scenario", "layer"]) {
    const raw = json({ count: 30 });
    files.set(`${source}.json`, raw);
    files.set(
      `${source}.meta.json`,
      json({
        url: `https://www.boat-ai.jp/api/analogy/${source}/${bundle.race_id}?stage=racecard`,
        stage: "racecard",
        fetched_at: "2026-10-07T05:34:29Z",
        http_status: 200,
        sha256: await sha256(raw),
      }),
    );
  }
  const integrity = {};
  for (const [name, bytes] of files)
    if (!name.includes(".meta.") && name !== "qa.json")
      integrity[name] = await sha256(bytes);
  files.set("integrity.json", json(integrity));
  return files;
}
function form(files, mimeOverride) {
  const data = new FormData();
  for (const [name, bytes] of files)
    data.append(
      "files",
      new Blob([bytes], {
        type:
          mimeOverride ||
          (name.endsWith(".json")
            ? "application/json"
            : name.endsWith(".txt")
              ? "text/plain"
              : name.endsWith(".png")
                ? "image/png"
                : "video/mp4"),
      }),
      name,
    );
  return data;
}
async function refreshHash(files, name) {
  const integrity = JSON.parse(
    new TextDecoder().decode(files.get("integrity.json")),
  );
  integrity[name] = await sha256(files.get(name));
  files.set("integrity.json", json(integrity));
}
const files = await fixture();
const validated = await validateBundle(form(files));
const riskRules = JSON.parse(
  await fs.readFile(
    new URL("sns-video-studio/remotion/risk-rules.json", root),
    "utf8",
  ),
).rules;
await check(
  "既存riskルールをチャネル別に照合し、QA自己申告に依存しない",
  async () => {
    const source = await fixture({
      script: "万舟券を主役にする",
      x_text: "過去の観測",
    });
    const result = await validateBundle(form(source), riskRules);
    assert(
      result.riskFlags.youtube.some((r) => r.id === "gambling-incitement"),
    );
    assert(!result.riskFlags.x.some((r) => r.id === "gambling-incitement"));
  },
);
await check("v0正常・全17添付・UUID型に自動対応しない", async () => {
  assert.equal(validated.bundle.template_variant_id, "loc_win");
  assert.equal(validated.missing.length, 0);
  assert.equal(validated.files.size, 17);
  assert(validated.holds.some((h) => h.includes("v0")));
});
await check(
  "qa/integrity/*.meta.jsonは自己申告のため未検証でも保留理由を増やさない",
  async () => {
    // integrity.jsonは自分自身・qa.json・meta.jsonを外部から固定する手段が無いため、
    // 正常なbundleでもこの6ファイルは構造上verified=falseになる。holdsには出さず、
    // manifestにverification:"self_attested"の印だけを残す（2026-10-07レビュー対応）。
    const selfAttestedNames = [
      "qa.json",
      "integrity.json",
      "facts.meta.json",
      "similar.meta.json",
      "scenario.meta.json",
      "layer.meta.json",
    ];
    assert.equal(
      validated.holds.filter((h) =>
        h.includes("外部manifestで固定されたハッシュがありません"),
      ).length,
      0,
    );
    for (const name of selfAttestedNames) {
      const entry = validated.manifest.find((m) => m.name === name);
      assert.equal(
        entry.hash_verified,
        false,
        `${name}はhash_verified=falseのはず`,
      );
      assert.equal(
        entry.verification,
        "self_attested",
        `${name}にself_attestedの印が必要`,
      );
    }
    // 除外は上記6ファイルに限定され、それ以外（script.txt）がintegrity.jsonから漏れた場合は
    // 従来どおり保留される（exemptionが過剰に効いていないことの確認）
    const integrity = JSON.parse(
      new TextDecoder().decode(files.get("integrity.json")),
    );
    delete integrity["script.txt"];
    const broken = new Map(files).set("integrity.json", json(integrity));
    const result = await validateBundle(form(broken));
    const unverifiedHolds = result.holds.filter((h) =>
      h.includes("外部manifestで固定されたハッシュがありません"),
    );
    assert.deepEqual(unverifiedHolds, [
      "script.txt: 外部manifestで固定されたハッシュがありません",
    ]);
  },
);
await check("multipart実バイト数の制限と正常読込", async () => {
  const req = new Request("https://local.invalid/import", {
    method: "POST",
    body: form(files),
  });
  assert.equal(
    (await validateBundle(await readBundleForm(req))).versionHash,
    validated.versionHash,
  );
  const huge = new FormData();
  huge.append(
    "files",
    new Blob([new Uint8Array(BUNDLE_LIMITS.request + 1)]),
    "draft.mp4",
  );
  await assert.rejects(
    () =>
      readBundleForm(
        new Request("https://local.invalid", { method: "POST", body: huge }),
      ),
    /4 MiB/,
  );
  await assert.rejects(
    () =>
      readBundleForm(
        new Request("https://local.invalid", { method: "POST", body: "x" }),
      ),
    /multipart/,
  );
});
await check(
  "未知schema・不正型・過容量・重複名・JSON破損・ハッシュ改変を拒否",
  async () => {
    const unsupported = await fixture({ schema_version: "ryujin-preview/1" });
    await assert.rejects(() => validateBundle(form(unsupported)), /schema/);
    await assert.rejects(() => validateBundle(form(files, "text/html")), /型/);
    const big = new Map(files).set(
      "draft.mp4",
      new Uint8Array(BUNDLE_LIMITS.media + 1),
    );
    await assert.rejects(() => validateBundle(form(big)), /容量/);
    const repeated = form(files);
    repeated.append(
      "files",
      new Blob([files.get("bundle.json")]),
      "bundle.json",
    );
    await assert.rejects(() => validateBundle(repeated), /重複/);
    const broken = new Map(files).set("qa.json", encode("{"));
    await assert.rejects(() => validateBundle(form(broken)), /JSON/);
    const changed = new Map(files).set(
      "scene-2.png",
      new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 99]),
    );
    await assert.rejects(() => validateBundle(form(changed)), /ハッシュ不一致/);
    const wrongSignature = new Map(files).set(
      "draft.mp4",
      encode("this is not mp4"),
    );
    await assert.rejects(() => validateBundle(form(wrongSignature)), /MP4/);
    const traversal = new Map(files).set(
      "../scene.png",
      files.get("scene-1.png"),
    );
    await assert.rejects(() => validateBundle(form(traversal)), /ファイル名/);
  },
);

await check("不足は保留、QA不合格・数値不一致も公開不可", async () => {
  const incomplete = new Map(files);
  incomplete.delete("scene-3.png");
  incomplete.delete("facts.json");
  const result = await validateBundle(form(incomplete));
  assert(result.holds.some((h) => h.includes("不足")));
  assert.notEqual(result.versionHash, validated.versionHash);
  const failed = new Map(files).set("qa.json", json({ pass: false }));
  assert(
    (await validateBundle(form(failed))).holds.some((h) =>
      h.includes("QA不合格"),
    ),
  );
  const wrongClaim = await fixture({
    claims: [{ source: "facts", path: ["count"], value: 999 }],
  });
  assert(
    (await validateBundle(form(wrongClaim))).holds.some((h) =>
      h.includes("数値照合不合格"),
    ),
  );
  const wrongSource = new Map(files).set("facts.json", json({ count: 999 }));
  await refreshHash(wrongSource, "facts.json");
  await assert.rejects(
    () => validateBundle(form(wrongSource)),
    /出典ハッシュ不一致/,
  );
});
await check("公開フラグ書き換え・選択順変更で解除できない", async () => {
  const released = await validateBundle(
    form(
      await fixture({
        local_only: false,
        release_verified: true,
        approval_status: "approved",
      }),
    ),
  );
  assert(released.holds.some((h) => h.includes("ローカル保留")));
  const reverse = await validateBundle(form(new Map([...files].reverse())));
  assert.equal(reverse.versionHash, validated.versionHash);
});

const db = new PGlite();
await db.exec(
  `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;`,
);
await db.exec(
  await fs.readFile(
    new URL("docs/db-migration/035_sns_marketing_hub_schema.sql", root),
    "utf8",
  ),
);
await db.exec("ALTER TABLE sns_drafts ADD COLUMN title TEXT;");
const migration = await fs.readFile(
  new URL("docs/db-migration/135_sns_preview_bundle_import.sql", root),
  "utf8",
);
await db.exec(migration);
await db.exec(migration);
const rpc = async (payload) => {
  const result = await db.query(
    "SELECT import_sns_preview_bundle($1,$2,$3,$4,$5,$6,$7,$8) AS result",
    Object.values(payload),
  );
  return result.rows[0].result;
};
let saved = new Map();
let failAt = "scene-2.png";
const store = {
  async saveFile(path, file) {
    if (path.endsWith(failAt)) throw new Error("mock保存失敗");
    saved.set(path, file);
  },
  register: rpc,
};
await check("media途中失敗では下書きなし、同じパスで再試行", async () => {
  await assert.rejects(
    () => importValidatedBundle(validated, store),
    /保存失敗/,
  );
  assert.equal(
    (await db.query("SELECT count(*)::int AS n FROM sns_drafts")).rows[0].n,
    0,
  );
  failAt = "never";
  const result = await importValidatedBundle(validated, store);
  assert(result.drafts.every((d) => d.result === "created"));
  assert.equal(saved.size, files.size);
});
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

// API本体を読み、依存境界だけモックに差し替える。鍵・本番接続は不要。
async function mockHandler(path, draft, denied = false) {
  let source = await fs.readFile(new URL(path, root), "utf8");
  const mock =
    "data:text/javascript," +
    encodeURIComponent(`
    export const jsonResponse=(body,status=200)=>new Response(JSON.stringify(body),{status});
    export const isConfigured=()=>true; export const isValidDraftId=()=>true;
    export const getDraftById=async()=>(${JSON.stringify(draft)});
    export const updateDraft=async()=>{throw new Error('更新してはいけない')};
    export const signStoragePath=async()=>{throw new Error('署名してはいけない')};
    export const requireAdminAuth=async()=>${denied ? "new Response('denied',{status:401})" : "null"};
    export const getYoutubeAccessToken=async()=>{throw new Error('投稿してはいけない')};
    export const uploadYoutubeVideo=getYoutubeAccessToken; export const uploadYoutubeThumbnail=getYoutubeAccessToken;
  `);
  source = source.replace(
    /"[^"\n]+_lib\/(snsHubHelpers|adminAuth|youtubeUpload)\.js"/g,
    JSON.stringify(mock),
  );
  source = source.replace(
    /"[^"\n]+_lib\/snsBundleValidation\.js"/g,
    JSON.stringify(new URL("api/_lib/snsBundleValidation.js", root).href),
  );
  const storageMock =
    "data:text/javascript," +
    encodeURIComponent(`
    export { importValidatedBundle } from ${JSON.stringify(new URL("api/_lib/snsBundleImport.js", root).href)};
    export const bundleStore = {saveFile:async()=>{},register:async(p)=>({publish_blocked:true,version_hash:p.p_version_hash,hold_reasons:p.p_hold_reasons})};
  `);
  source = source.replace(
    /"[^"\n]+_lib\/snsBundleImport\.js"/g,
    JSON.stringify(storageMock),
  );
  source = source.replace(
    /"[^"\n]+risk-rules\.json"/g,
    JSON.stringify(
      "data:text/javascript," +
        encodeURIComponent(
          `export default ${JSON.stringify({ rules: riskRules })}`,
        ),
    ),
  );
  return (await import("data:text/javascript," + encodeURIComponent(source)))
    .default;
}
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
await check(
  "取り込みAPIの正常・不正schema・multipart不備・認証なし",
  async () => {
    const handler = await mockHandler("api/admin/sns-hub/import-bundle.js", {});
    const ok = await handler(
      new Request("https://local.invalid/import", {
        method: "POST",
        body: form(files),
      }),
    );
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).data.publish_blocked, true);
    const unsupported = await fixture({ schema_version: "ryujin-preview/1" });
    assert.equal(
      (
        await handler(
          new Request("https://local.invalid/import", {
            method: "POST",
            body: form(unsupported),
          }),
        )
      ).status,
      400,
    );
    assert.equal(
      (
        await handler(
          new Request("https://local.invalid/import", {
            method: "POST",
            body: "{}",
          }),
        )
      ).status,
      400,
    );
    const denied = await mockHandler(
      "api/admin/sns-hub/import-bundle.js",
      {},
      true,
    );
    assert.equal(
      (
        await denied(
          new Request("https://local.invalid/import", { method: "POST" }),
        )
      ).status,
      401,
    );
  },
);
await db.close();

const sample = process.argv.find((a) => a.startsWith("--sample="))?.slice(9);
if (sample)
  await check(
    "提供実例の全integrity・API原文ハッシュ・数値を照合",
    async () => {
      const entries = await fs.readdir(sample);
      const sampleFiles = new Map();
      for (const name of entries)
        sampleFiles.set(name, await fs.readFile(`${sample}/${name}`));
      const result = await validateBundle(form(sampleFiles));
      assert.equal(result.missing.length, 0);
      assert(!result.holds.some((h) => h.includes("数値照合不合格")));
      console.log(
        `  ${result.files.size} files, version ${result.versionHash}`,
      );
    },
  );
console.log(
  `${count} checks passed (PGliteの同時リクエストは同一接続内で直列化。本番並行接続は未検証)`,
);
