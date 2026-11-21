/**
 * verify-full-picture-scene2.js の後半の場面（4/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { has } from "./full-picture-scene2-a-1.js";
import { jaWidth, fullLine1, checkBundleB439, FULL_URL_SLOT, load, buildBundleB439, CH, qaAll, bundleOf, chaptersOk } from "./full-picture-scene2-d-2.js";
import { b0 } from "./full-picture-scene2-d-3.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let readFileSync, fixtures, tmpB439, runFull;
let mOk, TYPE_IMPL;
export let resolveType, lengthRange, lengthReason, listTypesB1211, reviewReasons, buildBundleB1211, checkBundle;

function scene1() {
  // C3: 1行目は40字を越えたら止めずに「ボートレース {会場}{R}」へ落とす
  {
    assert.equal(jaWidth("ab12"), 2, "半角は0.5");
    assert.equal(jaWidth("全角"), 2);
    const hero = "同じ並びの過去1,857件で1号艇の1着72.0%";
    assert.equal(
      fullLine1(hero, "住之江11R"),
      `${hero}｜ボートレース 住之江11R`,
      "収まる日はそのまま",
    );
    // 越えたら間の短い形を作らず、会場と R だけにする（条件の語を落として数字だけ残さない。youtube-channel P2-1）
    const long =
      "同じ並びの過去12,345件で1号艇の1着率は72.0%、2着は3号艇、3着は4号艇が多い";
    assert.ok(jaWidth(`${long}｜ボートレース 平和島12R`) > 40, "前提: 越える");
    assert.equal(fullLine1(long, "平和島12R"), "ボートレース 平和島12R");
    assert.equal(
      fullLine1(null, "平和島12R"),
      "ボートレース 平和島12R",
      "冒頭の数字が無い日",
    );
    const fl = b0.youtube_full.description.split("\n");
    has(
      checkBundleB439({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: ["あ".repeat(41), ...fl.slice(1)].join("\n"),
        },
      }),
      "40字を越える",
    );
    has(
      checkBundleB439({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: ["", ...fl.slice(1)].join("\n"),
        },
      }),
      "1行目が空",
    );
    has(
      checkBundleB439({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: [
            fl[0],
            fl[1].replace(
              "龍神ソナー:",
              "龍神ソナーを使ってください、とても長い文:",
            ),
            ...fl.slice(2),
          ].join("\n"),
        },
      }),
      "20字を越える",
    );
    has(
      checkBundleB439({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: [...fl.slice(0, -1), "#a #b #c #d"].join("\n"),
        },
      }),
      "3つを越える",
    );
  }
  // C1: 2・3行目の機能への導線が無ければ落ちる
  {
    const fl = b0.youtube_full.description.split("\n");
    has(
      checkBundleB439({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: [fl[0], fl[2], fl[1], ...fl.slice(3)].join("\n"),
        },
      }),
      "龍神ソナーへの導線",
    );
    has(
      checkBundleB439({
        ...b0,
        youtube_full: {
          ...b0.youtube_full,
          description: [fl[0], fl[1], "x", ...fl.slice(3)].join("\n"),
        },
      }),
      "思考アシストへの導線",
    );
  }
  has(
    checkBundleB439({ ...b0, x_text: b0.x_text.replace(/\?utm_[^\s]+/, "") }),
    "UTM つき",
  );
}

function scene2() {
  has(
    checkBundleB439({
      ...b0,
      youtube_full: {
        ...b0.youtube_full,
        description: b0.youtube_full.description.replace(/\?utm_[^\s]+/, ""),
      },
    }),
    "youtube_full.description",
  );
  has(
    checkBundleB439({
      ...b0,
      youtube_shorts: { ...b0.youtube_shorts, title: b0.youtube_full.title },
    }),
    "題名が同じ",
  );
  has(
    checkBundleB439({
      ...b0,
      youtube_shorts: { ...b0.youtube_shorts, description: "x" },
    }),
    "ちょうど1つ無い",
  );
  has(
    checkBundleB439({
      ...b0,
      youtube_shorts: {
        ...b0.youtube_shorts,
        description: `${FULL_URL_SLOT} ${FULL_URL_SLOT}`,
      },
    }),
    "ちょうど1つ無い",
  );
  has(checkBundleB439({ ...b0, x_text: "URL なし" }), "URL がちょうど1つ無い");
  // 全国との差が出せない日は、題名に「差は1ポイント未満」と書かず既定の文にする
  {
    const m = load(fixtures[0]);
    const b = buildBundleB439({
      raceId: m.raceId,
      venue: "桐生",
      raceNo: 12,
      month: 10,
      day: 12,
      facts: {
        venue90: {
          venue: "桐生",
          rate: 51.3,
          national: null,
          races: 600,
          diffPt: null,
          direction: null,
        },
        overview: null,
        conclusion: null,
      },
      chapters: CH,
      fullSeconds: 211,
      qa: qaAll,
    });
    assert.ok(
      !b.youtube_full.title.includes("1ポイント未満"),
      b.youtube_full.title,
    );
  }
  has(
    checkBundleB439(bundleOf(fixtures[0], { ...qaAll, full_size: false })),
    "機械の検査",
  );
  has(
    checkBundleB439(bundleOf(fixtures[0], { ...qaAll, full_min185s: false })),
    "機械の検査",
  );
  // 自動チャプターの条件: 0:00 から・3つ以上・各章10秒以上（実ファイルの尺で）
  assert.equal(chaptersOk(CH, 211), true);
  assert.equal(chaptersOk(CH, 110), false, "最後の章が10秒未満");
  assert.equal(
    chaptersOk("0:00 条件\n0:22 6艇比較", 211),
    false,
    "章が3つ未満",
  );
  assert.equal(
    chaptersOk("0:05 条件\n0:22 6艇比較\n1:07 類似レース", 211),
    false,
    "0:00 から始まらない",
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（readFileSync・fixtures） */
export function runFullPictureScene2D6(env) {
  ({ readFileSync, fixtures } = env);
  scene1();
  scene2();
}

async function scene3() {
  mOk = load(fixtures[0]);
  assert.equal(runFull(mOk), 0, "固定の材料なら文だけの実行は通る");
  // BOA-989: 冒頭の場面（完全版・入口版の最初の問い）と X の本文にレースの日時・レース名・締切
  assert.equal(
    runFull({ ...mOk, race: { startTime: "16:40:00", grade: "ippan" } }),
    0,
    "締切つきの材料でも通る",
  );
  {
    const HEADER = "10/12（月）桐生12R 優勝戦 締切16:40";
    const sc = JSON.parse(readFileSync(`${tmpB439}/out/scenes.json`, "utf8"));
    assert.equal(
      sc.scenes.find((x) => x.id === "scene1").data.steps[0].question,
      `${HEADER} 1号艇は堅い？`,
      "完全版の冒頭の問いに見出し",
    );
    const post = readFileSync(`${tmpB439}/out/post-entry.txt`, "utf8");
    assert.ok(
      post.startsWith(
        "【桐生12R 優勝戦｜10/12】1号艇は堅い？\n10/12（月）締切16:40\n",
      ),
      post,
    );
  }
  assert.equal(
    runFull({ ...mOk, api: { ...mOk.api, scenario: null } }),
    1,
    "場面4の材料が無ければ止める",
  );
  assert.equal(
    runFull({ ...mOk, schemaVersion: "full-picture-materials/0" }),
    1,
    "契約に合わなければ止める",
  );
  // ---- 投稿の型（hq PD02、type-spec.mjs・daily.mjs --type-spec）----
  // 型の表は今は空（オーナー 10/25: 中身を固めて試作を見てから載せる）。仕組みは試験用の表で確かめる
  ({
    resolveType,
    lengthRange,
    lengthReason,
    listTypes: listTypesB1211,
    TYPE_IMPL,
    reviewReasons,
  } = await import(`${R}/scripts/full-picture/type-spec.mjs`));
  ({ buildBundle: buildBundleB1211, checkBundle } = await import(
    `${R}/scripts/full-picture/bundle.mjs`
  ));
}

/** verify から呼ぶ入口。env は verify 側の束縛（readFileSync・fixtures・tmpB439・runFull） */
export async function runFullPictureScene2D7(env) {
  ({ readFileSync, fixtures, tmpB439, runFull } = env);
  await scene3();
}

function scene4() {
  // 型の表に載せるのは関門を通った型だけ。各型に審査の記録と変えてよい幅を持たせる（docs/design/full-picture-type-gate/spec.md の 7）
  assert.deepEqual(Object.keys(TYPE_IMPL), [
    "v2r1-answer-fill-explain",
    "f01-landscape-voice-full",
  ]);
  for (const [id, impl] of Object.entries(TYPE_IMPL))
    assert.deepEqual(reviewReasons(id, impl), [], `${id}: 審査の記録`);
}

/** verify から呼ぶ入口。env は verify 側の束縛（readFileSync・fixtures・tmpB439・runFull） */
export function runFullPictureScene2D8(env) {
  ({ readFileSync, fixtures, tmpB439, runFull } = env);
  scene4();
}
