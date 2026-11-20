/**
 * verify-sns-bundle-import.js の後半の場面（1/4）。verify ではない。
 * 判定と期待値は分ける前の verify-sns-bundle-import.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import { matchRiskRules } from "../../lib/riskRuleMatcher.js";
import { checkRiskRules } from "../../lib/riskRules.js";
import assert from "node:assert/strict";
import { sha256, validateBundle } from "../../../api/_lib/snsBundleValidation.js";

let root, json, check, fixture, form, refreshHash, riskRules, sbiB2;
export let files, validated;

/** for (const [content, xIds] of cases) { の中身を割った 1/2 */
async function sbiA1({ content, handler, st, xIds }) {
  for (const platform of [
    "x",
    "youtube",
    "tiktok",
    null,
    undefined,
    "unknown",
  ]) {
    // 固定期待IDと、全経路の順序・最初の一致を検査する。
    const expected = riskRules
      .filter(
        (r) =>
          r.platforms === "all" ||
          !platform ||
          (Array.isArray(r.platforms) && r.platforms.includes(platform)),
      )
      .flatMap((r) => {
        const normalized = content
          .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) =>
            String.fromCharCode(c.charCodeAt(0) - 0xfee0),
          )
          .replace(/[ \u3000]/gu, "");
        const matchedPattern = r.patterns.find((p) =>
          normalized.includes(p),
        );
        return matchedPattern
          ? [
              {
                id: r.id,
                category: r.category,
                description: r.description,
                matchedPattern,
              },
            ]
          : [];
      });
    assert.deepEqual(
      matchRiskRules(content, platform, riskRules),
      expected,
    );
    assert.deepEqual(checkRiskRules(content, platform), expected);
    if (platform === "x")
      assert.deepEqual(
        expected.map((r) => r.id),
        xIds,
      );
    if (
      content === "本命 VS" &&
      ["tiktok", null, undefined].includes(platform)
    ) {
      assert.equal(expected[0].matchedPattern, "本命");
    }
    // 2026-10-10 ユーザー判断: YouTubeはXと同じくgambling-connotation-words対象外。
    if (content === "本命 VS" && ["x", "youtube"].includes(platform)) {
      assert.deepEqual(
        expected.map((r) => r.id),
        [],
      );
    }
    st.insight = { status: "proposed", insight_text: content, platform };
    const response = await handler(
      new Request("https://local.invalid/insights/test/approve", {
        method: "POST",
      }),
    );
    assert.equal(response.status, 200);
    assert.deepEqual(
      (await response.json()).riskWarnings,
      expected.map(({ id, category, matchedPattern }) => ({
        id,
        category,
        matchedPattern,
      })),
    );
  }
  const result = await validateBundle(
    form(
      await fixture({ title: content, script: content, x_text: content }),
    ),
    riskRules,
  );
  return { result };
}

/** for (const [content, xIds] of cases) { の中身を割った 2/2 */
function sbiA2({ content, result }) {
  for (const platform of ["x", "youtube"]) {
    assert.deepEqual(
      result.riskFlags[platform],
      checkRiskRules(content, platform),
    );
  }
}

/** await check( の中身を割った 1/5 */
function sbiB1() {
  const approvePath = new URL(
    "api/admin/sns-hub/insights/[id]/approve.js",
    root,
  );
  return { approvePath };
}

/** await check( の中身を割った 3/5 */
async function sbiB3({ source }) {
  const handler = (
    await import("data:text/javascript," + encodeURIComponent(source))
  ).default;
  const casesA = [
    ["競艇", ["banned-term-kyoutei"]],
    ["本命 VS", []],
    ["必ず当たる", ["guaranteed-hit"]],
    ["稼げる", ["gambling-incitement"]],
    ...[
      "必ず当たります",
      "必ず的中する",
      "必ず勝つ",
      "絶対当たる",
      "絶対に当たる",
      "絶対的中",
      "絶対に的中する",
      "絶対勝つ",
      "絶対に勝つ",
      "確実に当たる",
      "確実に的中する",
      "確実に勝つ",
      "100%当たる",
      "100％当たる",
      "100%的中",
      "100％的中",
      "的中を保証",
      "的中保証",
      "必勝パターン",
    ].map((text) => [text, ["guaranteed-hit"]]),
    ...[
      "稼ぐ",
      "稼いで",
      "稼いだ",
      "稼ごう",
      "副業になる",
      "副業にできる",
      "副業にする",
      "副収入",
      "収益を保証",
      "利益を保証",
    ].map((text) => [text, ["gambling-incitement"]]),
  ];
  return { handler, casesA };
}

/** await check( の中身を割った 4/5 */
function sbiB4({ casesA }) {
  const casesB = [
    ...[
      "当たり",
      "的中",
      "的中率を公開",
      "選手の稼ぎ頭",
      "賞金を稼ぎ出した選手",
      "副業の経験",
      "収益を集計",
      "利益の推移",
    ].map((text) => [text, []]),
    ["必ず当たるとは限らない", ["guaranteed-hit"]], // 否定・引用でも部分一致の警告。
    ["稼げるという表現を避ける", ["gambling-incitement"]],
    ...[
      "賞金を稼ぐ選手",
      "賞金を稼いだ選手",
      "賞金を 稼ぐ 選手",
      "あなたも賞金を稼ぐ選手になれる",
      "賞金を稼ぐ選手を目指そう",
    ].map((text) => [text, ["gambling-incitement"]]),
    ...[
      "百発百中",
      "外れない",
      "必ず当てる",
      "絶対に外さない",
      "絶対外さない",
      "必ず当てます",
      "確実に当てる",
      "必ず外さない",
      "外れません",
      "外すことはない",
      "必ず 当たる",
      "１００％当たる",
      "１００%的中",
      "百発 百中",
    ].map((text) => [text, ["guaranteed-hit"]]),
    ["賞金を稼ぐ選手。あなたも稼ぐ", ["gambling-incitement"]],
    ["賞金を稼いだ選手。必勝", ["gambling-incitement", "guaranteed-hit"]],
    ["賞金を稼ぐ方法", ["gambling-incitement"]],
    ["賞金を稼げる選手", ["gambling-incitement"]],
    ["必ず当てるとは限らない", ["guaranteed-hit"]],
    ["『外れない』という表現", ["guaranteed-hit"]],
    ["競\n艇", []],
    ["競\r\n艇", []],
    ["必ず\n当たる", []],
    ["必ず\t当たる", []],
    ["必ず　当たる", ["guaranteed-hit"]],
    ["ＶＳ", []],
    ["稼ぐ 必勝", ["gambling-incitement", "guaranteed-hit"]],
    ["ボートレースの観測件数", []],
    [
      "穴狙い 本命狙い 儲かる 万舟券 競艇 VS",
      [
        "banned-term-kyoutei",
        "deprecated-model-names",
        "gambling-incitement",
      ],
    ],
  ];
  const cases = [...casesA, ...casesB];
  return { cases };
}

/** await check( の中身を割った 5/5 */
async function sbiB5({ cases, handler, st }) {
  try {
    for (const [content, xIds] of cases) {
      const { result } = await sbiA1({ content, handler, st, xIds });
      sbiA2({ content, result });
    }
    console.table(
      cases.map(([text, expected]) => ({
        text,
        expected: expected.join(",") || "なし",
        actual:
          checkRiskRules(text, "x")
            .map((r) => r.id)
            .join(",") || "なし",
      })),
    );
    // bundle の別欄をつなぐ改行を越えて登録語を作らない。
    for (const [title, script, x_text] of [
      ["競", "艇", "艇"],
      ["必ず", "当たる", "当たる"],
    ]) {
      const result = await validateBundle(
        form(await fixture({ title, script, x_text })),
        riskRules,
      );
      for (const platform of ["x", "youtube"])
        assert.deepEqual(result.riskFlags[platform], []);
    }
    assert.equal(st.updates, cases.length * 6); // 警告があっても承認は継続する。
    assert.deepEqual(matchRiskRules("VS", "x", []), []);
  } finally {
    delete globalThis.__riskRuleTest;
  }
}

async function sbi1Scene1() {
  await check("動画の宣言・scene合計・実hashの不一致と不足は警告のみ", async () => {
    const mp4 = (await fixture()).get("draft.mp4");
    const video = {width:1080,height:1920,duration_seconds:18,fps:30,has_audio:true};
    const video_probe = {...video,tool:"ffprobe",sha256:await sha256(mp4)};
    const ok = await validateBundle(form(await fixture({video,video_probe})));
    assert(!ok.riskFlags.x.some(w => w.id.startsWith("bundle-video")));
    const bad = await validateBundle(form(await fixture({video:{...video,width:720,has_audio:false}, video_probe:{...video_probe,duration_seconds:19,sha256:"0".repeat(64)}})));
    for (const id of ["bundle-video-mismatch","bundle-video-scenes-mismatch","bundle-video-hash-mismatch"])
      assert(bad.riskFlags.youtube.some(w => w.id === id), id);
    const missing = await validateBundle(form(await fixture({video_probe:{}})));
    assert(missing.riskFlags.x.some(w => w.id === "bundle-video-probe-missing"));
  });
  await check("正準表を副作用なしで共有し、類似レースの識別子は照合しない", async () => {
    const {VENUE_NAMES} = await import("../../lib/venueNames.js");
    assert.equal(Object.keys(VENUE_NAMES).length,24);
    assert.equal(VENUE_NAMES[18],"徳山");
    const files = await fixture({venue_name:"びわこ",source_data:{race_code:"2026-10-07-11-10",venue_code:11}});
    files.set("similar.json", json({neighbors:[{race_id:"2026-10-06-18-01",venue_code:18}]}));
    const meta = JSON.parse(new TextDecoder().decode(files.get("similar.meta.json")));
    meta.sha256=await sha256(files.get("similar.json"));
    files.set("similar.meta.json",json(meta));
    await refreshHash(files,"similar.json");
    const result=await validateBundle(form(files));
    assert(!result.riskFlags.x.some(w => /bundle-(race|venue|body)/.test(w.id)));
  });
  files = await fixture();
  validated = await validateBundle(form(files));
}

/** verify から呼ぶ入口。env は verify 側の束縛（root・json・check・fixture・form・refreshHash・sbiB2） */
export async function runSnsBundleImportScenes1(env) {
  ({ root, json, check, fixture, form, refreshHash, sbiB2 } = env);
  await sbi1Scene1();
}

/** verify から呼ぶ入口。env は verify 側の束縛（root・json・check・fixture・form・refreshHash・riskRules・sbiB2） */
export function runSnsBundleImportScenes2(env) {
  ({ root, json, check, fixture, form, refreshHash, riskRules, sbiB2 } = env);

}

async function sbi1Scene2() {
  await check(
    "共通リスク判定は既存3経路の結果・順序・返却形式を維持する",
    async () => {
      const { approvePath } = sbiB1();
      const { source, st } = await sbiB2({ approvePath });
      const { handler, casesA } = await sbiB3({ source });
      const { cases } = sbiB4({ casesA });
      await sbiB5({ cases, handler, st });
    },
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（root・json・check・fixture・form・refreshHash・riskRules・sbiB2） */
export async function runSnsBundleImportScenes3(env) {
  ({ root, json, check, fixture, form, refreshHash, riskRules, sbiB2 } = env);
  await sbi1Scene2();
}
