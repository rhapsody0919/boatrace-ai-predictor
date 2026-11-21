/**
 * verify-full-picture-scene2.js の後半の場面（2/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { runFullPictureScene2A13 } from "./full-picture-scene2-a-6.js";
import { runFullPictureScene2B12 } from "./full-picture-scene2-b-11.js";
import { runFullPictureScene2B13 } from "./full-picture-scene2-b-12.js";
import { runFullPictureScene2B14 } from "./full-picture-scene2-b-13.js";
import { realEnv } from "./full-picture-scene2-d-1.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let buildAll, entryScenes, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, validate, readFileSync, gunzipSync, FX, fixtures, riskRules;
export let buildBundleB439, checkBundleB439, chaptersOk, raceHeader, utmUrl, jaWidth, fullLine1, FULL_URL_SLOT, BUNDLE_VERSION, checkFullPicture;

export const load = (f) =>
  JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8"));

const VENUE = { "01": "桐生", 15: "丸亀", 24: "大村", 19: "下関" };

export const qaAll = {
  contract: true,
  text: true,
  post: true,
  entry_max59s: true,
  full_size: true,
  shorts_vertical: true,
  shorts_max_60s: true,
  shorts_size: true,
  full_min185s: true,
  chapters: true,
};

export const CH = "0:00 条件\n0:22 6艇比較\n1:07 類似レース\n1:43 展開";

// 締切・グレードは固定の材料に無い（BOA-989 より前の写し）ので、ここで足す
const RACE = { "2026-10-12-01-12": { startTime: "16:40:00", grade: "G1" } };

export const bundleOf = (f, qa = qaAll) => {
  const m = load(f);
  const race = RACE[m.raceId] ?? null;
  const [, mo, da, vc, rn] = m.raceId.split("-");
  const scenes = buildAll(m);
  const facts = {
    venue90:
      scenes
        .find((x) => x.id === "scene1")
        .data.steps.find((st) => st.id === "s1-venue90")?.facts ?? null,
    overview: scenes.find((x) => x.id === "scene2").data.radar.overview.facts,
    conclusion:
      scenes.find((x) => x.id === "scene4").data.conclusion?.facts ?? null,
  };
  return buildBundleB439({
    raceId: m.raceId,
    venue: VENUE[vc],
    raceNo: Number(rn),
    month: Number(mo),
    day: Number(da),
    round: m.api.facts.today.round,
    grade: race?.grade ?? null,
    deadline: race?.startTime ?? null,
    facts,
    chapters: CH,
    fullSeconds: 211,
    qa,
  });
};

async function scene1() {
  await runFullPictureScene2B12({ R, MATERIALS_SCHEMA, validate });
  await runFullPictureScene2B13({ R, validate, MATERIALS_SCHEMA });
  await runFullPictureScene2B14({ validate, realEnv });
  // ---- 後半の場面（verifyData/full-picture-scene2-a-6.js） ----
  await runFullPictureScene2A13({ R, buildAll, entryScenes, ENTRY_MAX_FRAMES, validate, readFileSync, gunzipSync, FX, fixtures });
  // ---- 送信の道に渡す bundle（2026-10-20 オーケストレーターの分担 a・b・c、送信レーンとの Shorts の契約 bundle_version 2）----
  ({
    buildBundle: buildBundleB439,
    checkBundle: checkBundleB439,
    chaptersOk,
    raceHeader,
    utmUrl,
    jaWidth,
    fullLine1,
    FULL_URL_SLOT,
    BUNDLE_VERSION,
  } = await import(`${R}/scripts/full-picture/bundle.mjs`));
  ({ checkFullPicture } = await import("../../sns/push-full-picture.js"));
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・entryScenes・ENTRY_MAX_FRAMES・MATERIALS_SCHEMA・validate・readFileSync・gunzipSync・FX・fixtures） */
export async function runFullPictureScene2D3(env) {
  ({ buildAll, entryScenes, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, validate, readFileSync, gunzipSync, FX, fixtures } = env);
  await scene1();
}

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene2() {
  const { default: twitterText } = await import("twitter-text");
  const weighted = (s) => twitterText.parseTweet(s).weightedLength;
  const input = {
    raceId: "202611040212",
    venue: "福岡",
    raceNo: 12,
    month: 11,
    day: 4,
    round: "yusho",
    grade: "G1",
    deadline: "16:44:00",
    facts: {},
    chapters: CH,
    fullSeconds: 211,
    qa: qaAll,
  };
  const extra = {
    seriesDayText: "最終日",
    raceTitle: "第68回 ボートレースダービー",
  };
  const old = buildBundleB439(input);
  const b = buildBundleB439({ ...input, ...extra });
  assert.equal(
    b.youtube_shorts.title,
    "G1 福岡12R 優勝戦 11/4（水）締切16:44 1号艇は堅い？ 同じ並びの過去の着順",
  );
  assert.equal(b.x_text.split("\n")[1], "11/4（水）最終日 締切16:44");
  assert.equal(b.x_text.split("\n")[2], extra.raceTitle);
  assert.ok(weighted(b.x_text) <= 280);
  for (const k of ["youtube_full", "youtube_shorts"]) {
    assert.ok(
      b[k].description.includes(
        "ボートレース 11/4（水）最終日 福岡12R 優勝戦 締切16:44",
      ),
    );
    const rows = b[k].description.split("\n");
    assert.equal(
      rows[rows.findIndex((r) => r.startsWith("ボートレース 11/4")) + 1],
      extra.raceTitle,
    );
  }
  assert.equal(
    b.youtube_full.title,
    old.youtube_full.title,
    "完全版の題は変えない",
  );
  assert.equal(
    old.youtube_shorts.title,
    "福岡12R 優勝戦（11/4）1号艇は堅い？ 同じ並びの過去の着順",
    "省略した呼び出しは旧題",
  );
  assert.equal(
    raceHeader({
      year: 2026,
      month: 11,
      day: 4,
      venue: "福岡",
      raceNo: 12,
      round: "yusho",
      deadline: "16:44:00",
    }),
    "11/4（水）福岡12R 優勝戦 締切16:44",
    "f01 の見出しは従来どおり",
  );
  return { weighted, input, extra, old };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
function scene3({ weighted, input, extra, old }) {
  for (const grade of ["SG", "G1", "G2", "G3", "ippan"]) {
    const v = buildBundleB439({ ...input, ...extra, grade });
    assert.equal(
      v.youtube_shorts.title.startsWith(`${grade} `),
      grade !== "ippan",
    );
    assert.equal(
      v.x_text.includes(extra.raceTitle),
      ["SG", "G1"].includes(grade),
    );
    for (const k of ["youtube_full", "youtube_shorts"])
      assert.equal(
        v[k].description.includes(extra.raceTitle),
        ["SG", "G1"].includes(grade),
      );
  }
  const none = buildBundleB439({
    ...input,
    seriesDayText: null,
    raceTitle: null,
  });
  assert.equal(
    none.x_text,
    old.x_text,
    "日目・大会名が null なら X は旧本文",
  );
  const longName = buildBundleB439({
    ...input,
    ...extra,
    raceTitle: "あ".repeat(80),
  });
  assert.ok(!longName.x_text.includes("あ".repeat(80)), "大会名を先に落とす");
  assert.ok(
    longName.x_text.includes("最終日"),
    "大会名を落としても日目は残す",
  );
  assert.ok(weighted(longName.x_text) <= 280);
  // 日目だけで超過する境界を作る（既存の本文は上限以内）。
  let near = null;
  for (let n = 1; n < 100; n++) {
    const v = {
      ...input,
      facts: {
        conclusion: {
          form: "あ".repeat(n),
          n: 1000,
          boat: 1,
          count: 700,
          pct: 70,
        },
      },
    };
    const w = weighted(buildBundleB439(v).x_text);
    if (w <= 280 && w + 7 > 280) {
      near = v;
      break;
    }
  }
  assert.ok(near, "日目の有無で上限をまたぐ仮入力");
  assert.equal(
    buildBundleB439({ ...near, ...extra }).x_text,
    buildBundleB439(near).x_text,
    "大会名の次に日目を落とす",
  );
  const over = {
    ...input,
    facts: {
      venue90: {
        venue: "福岡",
        races: 600,
        rate: 60,
        national: 54,
        diffPt: 6,
        direction: "高い",
      },
      conclusion: { form: "123456", n: 1000, boat: 1, count: 700, pct: 70 },
    },
  };
  assert.ok(weighted(buildBundleB439(over).x_text) > 280);
  return { input, extra, over };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene4({ input, extra, over }) {
  assert.equal(
    buildBundleB439({ ...over, ...extra }).x_text,
    buildBundleB439(over).x_text,
    "元から超過する本文は一字一句同じ（新しい停止を足さない）",
  );
  // 100字の直前・直後: グレード→レース名→後半の順。
  const titleOf = (n) =>
    buildBundleB439({
      ...input,
      ...extra,
      facts: { hero: { title: "あ".repeat(n) } },
    }).youtube_shorts.title;
  const prefix = "G1 福岡12R 優勝戦 11/4（水）締切16:44 1号艇は堅い？ ";
  const n = 100 - prefix.length;
  assert.equal(titleOf(n).length, 100);
  assert.equal(
    titleOf(n + 1),
    prefix.replace("G1 ", "") + "あ".repeat(n + 1),
    "グレードを先に落とす",
  );
  assert.equal(
    titleOf(n + 4),
    prefix.replace("G1 ", "").replace(" 優勝戦", "") + "あ".repeat(n + 4),
    "次にレース名を落とす",
  );
  assert.ok(titleOf(200).length <= 100);
  assert.match(titleOf(200), /11\/4（水）締切16:44 1号艇は堅い？ /);
  assert.ok(titleOf(200).endsWith("…"));
}

async function scene5() {
  assert.ok(riskRules.length > 0, "禁止表現の規則を読めた");
  {
    const s1 = await scene2();
    const s2 = scene3(s1);
    scene4(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・entryScenes・ENTRY_MAX_FRAMES・MATERIALS_SCHEMA・validate・readFileSync・gunzipSync・FX・fixtures・riskRules） */
export async function runFullPictureScene2D4(env) {
  ({ buildAll, entryScenes, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, validate, readFileSync, gunzipSync, FX, fixtures, riskRules } = env);
  await scene5();
}
