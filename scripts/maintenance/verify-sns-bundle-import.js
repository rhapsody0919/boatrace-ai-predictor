import "./snsDraftDiff.js";

/** 本番接続なし。検査・保存モック・実SQL(PGlite)・公開APIガードを検証する。 */
import "./snsRawErrors.js";


import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import {
  BUNDLE_SCHEMA,
  BUNDLE_SCHEMA_V1,
  X_VIDEO,
  validateBundle,
  sha256,
} from "../../api/_lib/snsBundleValidation.js";
import { importValidatedBundle } from "../../api/_lib/snsBundleImport.js";

import {
  prepareBundle,
  summarize as summarizeBundle,
} from "../sns/push-bundle.js";
import {
  runSnsBundleImportScenes1,
  runSnsBundleImportScenes2,
  runSnsBundleImportScenes3,
} from "./verifyData/sns-bundle-import-scenes-1.js";
import {
  runSnsBundleImportScenes4,
  runSnsBundleImportScenes5,
  runSnsBundleImportScenes6,
  runSnsBundleImportScenes7,
} from "./verifyData/sns-bundle-import-scenes-2.js";
import { runSnsBundleImportScenes8, runSnsBundleImportScenes9 } from "./verifyData/sns-bundle-import-scenes-3.js";
import {
  runSnsBundleImportScenes10,
  runSnsBundleImportScenes11,
  runSnsBundleImportScenes12,
  runSnsBundleImportScenes13,
  runSnsBundleImportScenes14,
} from "./verifyData/sns-bundle-import-scenes-4.js";

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
    video: {width:1080,height:1920,duration_seconds:18,fps:30,has_audio:true},
    video_probe: {tool:"ffprobe",width:1080,height:1920,duration_seconds:18,fps:30,has_audio:true,
      sha256:await sha256(new Uint8Array([0,0,0,20,102,116,121,112,105,115,111,109]))},
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
await check("会場18の戸田誤表記・原文レース違いは拒否せず警告を保存", async () => {
  const files = await fixture({race_id:"2026-10-07-18-10", venueName:"戸田", script:"戸田の10R", source_data:{venueCode:18}});
  files.set("facts.json", json({today:{race_id:"2026-10-07-18-09",venue_code:18}, similar:[{race_id:"2026-10-06-02-01"}]}));
  const meta = JSON.parse(new TextDecoder().decode(files.get("facts.meta.json")));
  meta.sha256 = await sha256(files.get("facts.json"));
  files.set("facts.meta.json", json(meta));
  await refreshHash(files, "facts.json");
  const result = await validateBundle(form(files));
  assert(result.riskFlags.x.some(w => w.id === "bundle-venue-mismatch"));
  assert(result.riskFlags.youtube.some(w => w.id === "bundle-body-venue-2"));
  assert(result.riskFlags.x.some(w => w.id === "bundle-race-mismatch"));
  assert(!result.riskFlags.x.some(w => w.matchedPattern.includes("similar")));
  let saved;
  await importValidatedBundle(result, {saveFile:async()=>{}, register:async payload => {saved=payload;}});
  assert.deepEqual(saved.p_risk_flags, result.riskFlags);
  assert(saved.p_hold_reasons.some(h => h.includes("QA保留")));
});
await check("source_dataのコード・scope不一致と唐津の名称境界", async () => {
  const bad = await validateBundle(form(await fixture({source_data:{race_code:"2026-10-07-11-09",venueCode:18,scope_key:"VC:18:test"}})));
  assert(bad.riskFlags.x.some(w => w.id === "bundle-race-mismatch"));
  assert(bad.riskFlags.x.some(w => w.matchedPattern === "source_data.venueCode"));
  assert(bad.riskFlags.x.some(w => w.matchedPattern === "source_data.scope_key"));
  const good = await validateBundle(form(await fixture({race_id:"2026-10-07-23-10",title:"唐津の展望"})));
  assert(!good.riskFlags.x.some(w => w.id.startsWith("bundle-body-venue")));
});
for (const title of ["唐 津の展望", "唐　津の展望"]) {
  await check(`対象会場の空白入り表記「${title}」は津の警告を付けない`, async () => {
    const result = await validateBundle(form(await fixture({race_id:"2026-10-07-23-10",title})));
    for (const platform of ["x", "youtube"]) {
      assert(!result.riskFlags[platform].some(w => w.id === "bundle-body-venue-9"));
    }
    const other = await validateBundle(form(await fixture({race_id:"2026-10-07-23-10",title:`${title}と津の比較`})));
    for (const platform of ["x", "youtube"]) {
      assert(other.riskFlags[platform].some(w => w.id === "bundle-body-venue-9"));
    }
  });
}

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-1.js） ----
await runSnsBundleImportScenes1({ root, json, check, fixture, form, refreshHash, sbiB2 });
const riskRules = JSON.parse(
  await fs.readFile(
    new URL("sns-video-studio/remotion/risk-rules.json", root),
    "utf8",
  ),
).rules;

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-1.js） ----
runSnsBundleImportScenes2({ root, json, check, fixture, form, refreshHash, riskRules, sbiB2 });

/** await check( の中身を割った 2/5 */
async function sbiB2({ approvePath }) {
  let source = await fs.readFile(approvePath, "utf8");
  const st = { insight: undefined, updates: 0 };
  globalThis.__riskRuleTest = {
    get: () => st.insight,
    update: (value) => {
      st.updates++;
      return value;
    },
  };
  const helpers =
    "data:text/javascript," +
    encodeURIComponent(`
    export const jsonResponse=(v,status=200)=>new Response(JSON.stringify(v),{status});
    export const isConfigured=()=>true; export const isValidUuid=()=>true;
    export const getInsightById=async()=>globalThis.__riskRuleTest.get();
    export const updateInsight=async(id,v)=>globalThis.__riskRuleTest.update(v);
    export const requireAdminAuth=async()=>null;
  `);
  source = source
    .replace(
      /"[^"\n]+_lib\/(snsHubHelpers|adminAuth)\.js"/g,
      JSON.stringify(helpers),
    )
    .replace(
      /"[^"\n]+lib\/riskRuleMatcher\.js"/g,
      JSON.stringify(new URL("scripts/lib/riskRuleMatcher.js", root).href),
    )
    .replace(
      /"[^"\n]+risk-rules\.json"/g,
      JSON.stringify(
        "data:text/javascript," +
          encodeURIComponent(
            `export default ${JSON.stringify({ rules: riskRules })}`,
          ),
      ),
    );
  return { source, st };
}

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-1.js・sns-bundle-import-scenes-2.js） ----
await runSnsBundleImportScenes3({ root, json, check, fixture, form, refreshHash, riskRules, sbiB2 });
await runSnsBundleImportScenes4({ encode, json, check, fixture, form, refreshHash, riskRules });

const db = new PGlite();

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-2.js） ----
await runSnsBundleImportScenes5({ encode, json, check, fixture, form, refreshHash, riskRules, db });
await db.exec(
  await fs.readFile(
    new URL("docs/db-migration/035_sns_marketing_hub_schema.sql", root),
    "utf8",
  ),
);

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-2.js） ----
await runSnsBundleImportScenes6({ encode, json, check, fixture, form, refreshHash, riskRules, db });
const migration = await fs.readFile(
  new URL("docs/db-migration/135_sns_preview_bundle_import.sql", root),
  "utf8",
);

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-2.js・sns-bundle-import-scenes-3.js） ----
await runSnsBundleImportScenes7({ encode, json, check, fixture, form, refreshHash, riskRules, db, migration });
await runSnsBundleImportScenes8({ check, fixture, form, riskRules, db, mockHandler });

// API本体を読み、依存境界だけモックに差し替える。鍵・本番接続は不要。
async function mockHandler(
  path,
  draft,
  denied = false,
  allowUpdate = false,
  rules = riskRules,
) {
  let source = await fs.readFile(new URL(path, root), "utf8");
  const mock =
    "data:text/javascript," +
    encodeURIComponent(`
    export const jsonResponse=(body,status=200)=>new Response(JSON.stringify(body),{status});
    export const isConfigured=()=>true; export const isValidDraftId=()=>true;
    export const getDraftById=async()=>(${JSON.stringify(draft)});
    export const updateDraft=async()=>{${allowUpdate ? "return {};" : "throw new Error('更新してはいけない');"}};
    export const signStoragePath=async()=>{throw new Error('署名してはいけない')};
    export const requireAdminAuth=async()=>${denied ? "new Response('denied',{status:401})" : "null"};
    export const getYoutubeAccessToken=async()=>{throw new Error('投稿してはいけない')};
    export const uploadYoutubeVideo=getYoutubeAccessToken; export const uploadYoutubeThumbnail=getYoutubeAccessToken;
    export const externalRpc=async()=>{throw new Error('外部操作してはいけない')};
    export const claimExternal=externalRpc; export const recordExternal=externalRpc; export const finishExternal=externalRpc;
    export const completedResponse=()=>{throw new Error('外部操作してはいけない')};
  `);
  source = source.replace(
    /"[^"\n]+_lib\/(snsHubHelpers|adminAuth|youtubeUpload|snsExternalOperations)\.js"/g,
    JSON.stringify(mock),
  );
  source = source.replace(
    /"[^"\n]+_lib\/snsBundleValidation\.js"/g,
    JSON.stringify(new URL("api/_lib/snsBundleValidation.js", root).href),
  );
  source = source.replace(
    /"[^"\n]+lib\/riskRuleMatcher\.js"/g,
    JSON.stringify(new URL("scripts/lib/riskRuleMatcher.js", root).href),
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
    /"[^"\n]+risk-rules\.json"(\s+with\s*\{[^}]*\})?/g,
    JSON.stringify(
      "data:text/javascript," +
        encodeURIComponent(`export default ${JSON.stringify({ rules })}`),
    ),
  );
  return (await import("data:text/javascript," + encodeURIComponent(source)))
    .default;
}

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-3.js・sns-bundle-import-scenes-4.js） ----
await runSnsBundleImportScenes9({ check, fixture, form, riskRules, db, mockHandler });
await runSnsBundleImportScenes10({ encode, check, fixture, form, db, mockHandler, fixtureV1 });

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
// v1（sns-pdca-loop tasks 6）: push-bundle だけが受け付ける。v0 の検査・恒久保留は変えない
const MP4 = new Uint8Array([0, 0, 0, 20, 102, 116, 121, 112, 105, 115, 111, 109]);

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-4.js） ----
runSnsBundleImportScenes11({ encode, check, fixture, form, db, mockHandler, MP4, fixtureV1 });
async function fixtureV1(change = {}, { withXVideo = true } = {}) {
  const v1 = {
    schema_version: BUNDLE_SCHEMA_V1,
    screen_key: "race-sonar",
    x_thread: [
      { index: 0, text: "準優勝戦の見どころ https://www.boat-ai.jp/race/202610071110", media: X_VIDEO },
      { index: 1, text: "観測した件数を確認", media: "scene-1.png" },
    ],
    claims: [
      { id: "c1", text: "類似30件", value: 30, source: { endpoint: "/api/analogy/facts/2026-10-07-11-10?stage=racecard", path: ["count"] } },
    ],
    local_only: undefined,
    release_verified: undefined,
    approval_status: undefined,
    x_text: undefined,
    template_variant_id: undefined,
    ...change,
  };
  const files = await fixture(v1);
  files.delete("x-draft.txt");
  if (withXVideo) files.set(X_VIDEO, MP4);
  // integrity.json は Codex の出力（draft-x.mp4 は push-bundle が後で作るので含まない）
  const integrity = JSON.parse(new TextDecoder().decode(files.get("integrity.json")));
  delete integrity["x-draft.txt"];
  files.set("integrity.json", json(integrity));
  return files;
}

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-4.js） ----
await runSnsBundleImportScenes12({ encode, check, fixture, form, db, mockHandler, MP4, fixtureV1 });
await check("v1: push-bundle はフォルダを読み、draft-x.mp4 が無ければ draft.mp4 から書き出して検査する（素材フォルダは変えない）", async () => {
  const { mkdtemp, writeFile, readdir, rm } = fs;
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(`${tmpdir()}/sns-v1-`);
  try {
    for (const [name, bytes] of await fixtureV1({}, { withXVideo: false }))
      await writeFile(`${dir}/${name}`, bytes);
    await writeFile(`${dir}/notes.md`, "無視される");
    const calls = [];
    const exec = async (cmd, args) => {
      calls.push([cmd, args]);
      await writeFile(args.at(-1), MP4);
    };
    const prepared = await prepareBundle(dir, { exec });
    assert.equal(calls[0][0], "ffmpeg");
    assert(calls[0][1].join(" ").includes("scale=720:1280"));
    assert.equal(calls[0][1][calls[0][1].indexOf("-i") + 1], `${dir}/draft.mp4`);
    assert.deepEqual(prepared.derived, [X_VIDEO]);
    assert.deepEqual(prepared.ignored, ["notes.md"]);
    assert(!(await readdir(dir)).includes(X_VIDEO));
    const summary = summarizeBundle(prepared);
    assert.equal(summary.schema_version, BUNDLE_SCHEMA_V1);
    assert.deepEqual(summary.risk_flags.x_thread, [0, 0]);
    // 既に draft-x.mp4 があれば書き出さない
    await writeFile(`${dir}/${X_VIDEO}`, MP4);
    const again = [];
    await prepareBundle(dir, { exec: async (...a) => again.push(a) });
    assert.equal(again.length, 0);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-4.js） ----
await runSnsBundleImportScenes13({ encode, check, fixture, form, db, mockHandler, MP4, fixtureV1 });
await check("push-bundle: v0 の素材には v0 の容量の上限（2 MiB）をかける（点検 08-15 D2）", async () => {
  const { mkdtemp, writeFile, rm } = fs;
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(`${tmpdir()}/sns-v0-`);
  try {
    const files = await fixture();
    const big = new Uint8Array(3 * 1024 * 1024);
    big.set(MP4);
    files.set("draft.mp4", big);
    await refreshHash(files, "draft.mp4");
    for (const [name, bytes] of files) await writeFile(`${dir}/${name}`, bytes);
    await assert.rejects(prepareBundle(dir), /容量超過/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
console.log(
  `${count} checks passed (PGliteの同時リクエストは同一接続内で直列化。本番並行接続は未検証)`,
);

// ---- 後半の場面（verifyData/sns-bundle-import-scenes-4.js） ----
await runSnsBundleImportScenes14({ encode, check, fixture, form, db, mockHandler, MP4, fixtureV1 });
