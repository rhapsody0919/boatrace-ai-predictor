import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

test("F04/F05 API: 媒体hash取得は直列、X動画・画像の署名プレビューを返す", async () => {
  const baseline = process.env.SNS_MOBILE_TEST_BASELINE;
  let text = baseline
    ? execFileSync(
        "git",
        ["show", `${baseline}:api/admin/sns-hub/mobile-approval.js`],
        { encoding: "utf8" },
      )
    : await readFile(
        new URL("../../api/admin/sns-hub/mobile-approval.js", import.meta.url),
        "utf8",
      );
  const state = {
    active: 0,
    maxActive: 0,
    rows: [
      {
        draft: { id: "video", platform: "x", video_storage_path: "x/only.mp4" },
        revision: "r",
      },
      {
        draft: { id: "image", platform: "x", cover_image_path: "x/only.png" },
        revision: "r",
      },
    ],
  };
  globalThis.__mobileApiTest = state;
  try {
    const mock =
      "data:text/javascript," +
      encodeURIComponent(`
   export const requireAdminAuth=async()=>null;
   export const isConfigured=()=>true, isValidUuid=()=>true;
   export const jsonResponse=(data,status=200)=>Response.json(data,{status});
   export const signStoragePaths=async paths=>Object.fromEntries(paths.map(p=>[p,'http://localhost/'+p]));
   export const loadXMedia=async()=>new Uint8Array([1]);
   export const xSendStore={mobileRace:async()=>globalThis.__mobileApiTest.rows};
   export const prepareMobileReview=async()=>{const s=globalThis.__mobileApiTest;s.active++;s.maxActive=Math.max(s.maxActive,s.active);await new Promise(r=>setTimeout(r,0));s.active--;return {versionHash:'version',holds:[]};};
   export const approveMobileReview=async()=>({});
   export const saveDraftInspection=async()=>({findings:[]});
  `);
    text = text
      .replace(
        /from ["'][^"'\n]+(?:adminAuth|snsHubHelpers|snsXSendStore|snsMobileApproval|snsEditAssist)\.js["']/g,
        `from ${JSON.stringify(mock)}`,
      )
      .replace(/import riskRules from [^;]+;/, `const riskRules={rules:[]};`);
    const handler = (
      await import("data:text/javascript," + encodeURIComponent(text))
    ).default;
    const response = await handler(
      new Request("http://localhost/mobile?group=group"),
    );
    assert.equal(response.status, 200);
    const { data } = await response.json();
    assert.equal(data[0].videoUrl, "http://localhost/x/only.mp4");
    assert.equal(data[1].imageUrl, "http://localhost/x/only.png");
    assert.equal(data[1].videoUrl, null);
    assert.equal(state.maxActive, 1, "hash読込を並列にしない");
  } finally {
    delete globalThis.__mobileApiTest;
  }
});

test("編集指摘の判断で「本人」以外の承認者を選んだ場合は固定の安全な文言を返す（汎用500にしない）", async () => {
  const baseline = process.env.SNS_MOBILE_TEST_BASELINE;
  let text = baseline
    ? execFileSync(
        "git",
        ["show", `${baseline}:api/admin/sns-hub/mobile-approval.js`],
        { encoding: "utf8" },
      )
    : await readFile(
        new URL("../../api/admin/sns-hub/mobile-approval.js", import.meta.url),
        "utf8",
      );
  const draftId = "00000000-0000-4000-8000-000000000001",
    approverId = "00000000-0000-4000-8000-000000000002";
  try {
    const mock =
      "data:text/javascript," +
      encodeURIComponent(`
   export const requireAdminAuth=async()=>null;
   export const isConfigured=()=>true, isValidUuid=()=>true;
   export const jsonResponse=(data,status=200)=>Response.json(data,{status});
   export const signStoragePaths=async paths=>Object.fromEntries(paths.map(p=>[p,'http://localhost/'+p]));
   export const loadXMedia=async()=>new Uint8Array([1]);
   export const xSendStore={
     mobileRace:async()=>[{draft:{id:${JSON.stringify(draftId)},platform:'x'},revision:'version'}],
     decideFinding:async()=>{throw new Error('本人の判断が必要です');},
   };
   export const prepareMobileReview=async()=>({versionHash:'version',holds:[]});
   export const approveMobileReview=async()=>({});
   export const saveDraftInspection=async()=>({findings:[]});
  `);
    text = text
      .replace(
        /from ["'][^"'\n]+(?:adminAuth|snsHubHelpers|snsXSendStore|snsMobileApproval|snsEditAssist)\.js["']/g,
        `from ${JSON.stringify(mock)}`,
      )
      .replace(/import riskRules from [^;]+;/, `const riskRules={rules:[]};`);
    const handler = (
      await import("data:text/javascript," + encodeURIComponent(text))
    ).default;
    const response = await handler(
      new Request("http://localhost/mobile?group=group", {
        method: "POST",
        body: JSON.stringify({
          draftId,
          approverId,
          action: "edit-decision",
          inspectionId: draftId,
          findingId: "f1",
          decision: "ignored",
          versionHash: "version",
        }),
      }),
    );
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.error, "本人の判断が必要です");
  } finally {
    delete globalThis.__mobileApiTest;
  }
});
