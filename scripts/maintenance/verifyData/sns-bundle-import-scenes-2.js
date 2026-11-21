/**
 * verify-sns-bundle-import.js の後半の場面（2/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-bundle-import.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { validateBundle, sha256, readBundleForm, BUNDLE_LIMITS } from "../../../api/_lib/snsBundleValidation.js";
import { importValidatedBundle } from "../../../api/_lib/snsBundleImport.js";
import { validated, files } from "./sns-bundle-import-scenes-1.js";

let encode, json, check, fixture, form, refreshHash, riskRules, db, migration;
let saved;

const rpc = async (payload) => {
  const result = await db.query(
    "SELECT import_sns_preview_bundle($1,$2,$3,$4,$5,$6,$7,$8) AS result",
    Object.values(payload),
  );
  return result.rows[0].result;
};

let failAt = "scene-2.png";

export const store = {
  async saveFile(path, file) {
    if (path.endsWith(failAt)) throw new Error("mock保存失敗");
    saved.set(path, file);
  },
  register: rpc,
};

async function sbi2Scene1() {
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
    "layerの固定段(racecard (fixed))はexhibition段のbundleでも拒否されない(F01対応)",
    async () => {
      // layerは出走表時点で固定して取得するため、bundle全体がexhibition段で
      // 組まれてもlayerの実際の取得URLは?stage=racecardのまま。修正前は
      // 「URLのstageはbundle.stageと一致」を全sourceに一律で求めていたため、
      // 展示後bundleに固定段layerを添えると常に拒否されていた。
      const exhibitionFiles = await fixture({ stage: "exhibition" });
      for (const source of ["facts", "similar", "scenario"]) {
        const raw = exhibitionFiles.get(`${source}.json`);
        exhibitionFiles.set(
          `${source}.meta.json`,
          json({
            url: `https://www.boat-ai.jp/api/analogy/${source}/2026-10-07-11-10?stage=exhibition`,
            stage: "exhibition",
            fetched_at: "2026-10-07T05:34:29Z",
            http_status: 200,
            sha256: await sha256(raw),
          }),
        );
      }
      const layerRaw = exhibitionFiles.get("layer.json");
      exhibitionFiles.set(
        "layer.meta.json",
        json({
          url: "https://www.boat-ai.jp/api/analogy/layer/2026-10-07-11-10?stage=racecard",
          stage: "racecard (fixed)",
          fetched_at: "2026-10-07T05:34:29Z",
          http_status: 200,
          sha256: await sha256(layerRaw),
        }),
      );
      const integrity = {};
      for (const [name, bytes] of exhibitionFiles)
        if (
          !name.includes(".meta.") &&
          name !== "qa.json" &&
          name !== "integrity.json"
        )
          integrity[name] = await sha256(bytes);
      exhibitionFiles.set("integrity.json", json(integrity));
      // 例外を投げず正常に検証を通ることが期待値（修正前はensureで400拒否されていた）
      const result = await validateBundle(form(exhibitionFiles));
      assert.equal(result.bundle.stage, "exhibition");
    },
  );
}

async function sbi2Scene2() {
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
    // FormDataをそのままRequestのbodyにして読み途中でcancelすると、Node 24のundiciが
    // 閉じたstreamへenqueueして未捕捉例外になる（undici側の不具合。本番の受信streamは別経路）。
    // 同じmultipartのバイト列を先に直列化し、通常のstreamとして渡す。
    const hugeResponse = new Response(huge);
    const hugeType = hugeResponse.headers.get("content-type");
    const hugeBytes = new Uint8Array(await hugeResponse.arrayBuffer());
    await assert.rejects(
      () =>
        readBundleForm(
          new Request("https://local.invalid", {
            method: "POST",
            headers: { "Content-Type": hugeType },
            body: hugeBytes,
          }),
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
}

async function sbi2Scene3() {
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（encode・json・check・fixture・form・refreshHash・riskRules） */
export async function runSnsBundleImportScenes4(env) {
  ({ encode, json, check, fixture, form, refreshHash, riskRules } = env);
  await sbi2Scene1();
  await sbi2Scene2();
  await sbi2Scene3();
}

async function sbi2Scene4() {
  await db.exec(
    `CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS;`,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（encode・json・check・fixture・form・refreshHash・riskRules・db） */
export async function runSnsBundleImportScenes5(env) {
  ({ encode, json, check, fixture, form, refreshHash, riskRules, db } = env);
  await sbi2Scene4();
}

async function sbi2Scene5() {
  await db.exec("ALTER TABLE sns_drafts ADD COLUMN title TEXT;");
}

/** verify から呼ぶ入口。env は verify 側の束縛（encode・json・check・fixture・form・refreshHash・riskRules・db） */
export async function runSnsBundleImportScenes6(env) {
  ({ encode, json, check, fixture, form, refreshHash, riskRules, db } = env);
  await sbi2Scene5();
}

async function sbi2Scene6() {
  await db.exec(migration);
  await db.exec(migration);
  saved = new Map();
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
}

/** verify から呼ぶ入口。env は verify 側の束縛（encode・json・check・fixture・form・refreshHash・riskRules・db・migration） */
export async function runSnsBundleImportScenes7(env) {
  ({ encode, json, check, fixture, form, refreshHash, riskRules, db, migration } = env);
  await sbi2Scene6();
}
