/**
 * verify-full-picture-scene2.js の後半の場面（4/10）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { lineWidth, templateText, allBeats } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";
import { frameInSafeArea, FRAME_PAD } from "../../../sns-video-studio/remotion/src/fullPicture/scene2Layout.js";
import { s8Lay, summaryLayout, s8, statsBarRow, statsBarBox, STATS_BAR, restLines } from "./full-picture-scene2-a-3.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let buildAll, entryScenes, HERO_MIN_N, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures;
let row, bar;
export let MATERIALS_VERSION;

export const sumWidth = (ls) => (ls ?? []).reduce((w, l) => w + lineWidth(l), 0);

const venueZ1 = (f) => {
  const p0 = f.national / 100;
  return (f.rate / 100 - p0) / Math.sqrt((p0 * (1 - p0)) / f.races);
};

async function scene1() {
  assert.ok(s8Lay.rowH >= 76, `詰めても行の高さは 76 以上（${s8Lay.rowH}）`);
  assert.equal(
    summaryLayout(s8.groups, 1).rowH,
    84,
    "1行の締めなら行の高さは今までどおり",
  );
  // s3-rough: 棒は欄の幅いっぱい、値は棒の上、全国の値は棒の下（「全国 55.2%」が棒に重なっていた）
  row = statsBarRow(0);
  bar = statsBarBox(0);
  assert.ok(row.y + 20 + 36 * 1.3 + 72 * 1.2 <= bar.y, "値の行は棒より上");
  assert.ok(
    row.y + STATS_BAR.markLabelTop >= bar.y + bar.h + 12,
    "全国の値は棒（目印の線を含む）より下",
  );
  assert.ok(
    row.y + STATS_BAR.markLabelTop + 36 * 1.3 <= row.y + row.h,
    "全国の値は欄の中",
  );
  assert.ok(bar.w >= 800, "棒は大きく");
  assert.ok(
    frameInSafeArea(row) && row.y + row.h + FRAME_PAD <= 1252,
    "枠が画面内・吹き出しより上",
  );
  // s5: 重点でない艇は答えを出さず、最後に1枚にまとめる（拍2.2秒で答え0.8秒だった）
  assert.deepEqual(
    restLines([
      { axis: 3, second: 1 },
      { axis: 4, second: 1 },
      { axis: 5, second: 1 },
      { axis: 6, second: 1 },
    ]),
    ["3・4・5・6号艇が1着なら2着は1号艇"],
  );
  assert.deepEqual(
    restLines([
      { axis: 3, second: 1 },
      { axis: 4, second: 2 },
      { axis: 5, second: 1 },
    ]),
    ["3・5号艇が1着なら2着は1号艇", "4号艇が1着なら2着は2号艇"],
  );
  assert.deepEqual(
    restLines([
      { axis: 2, second: 1 },
      { axis: 4, second: 2 },
      { axis: 5, second: 3 },
    ]),
    ["1着→2着の最多（号艇）", "2→1・4→2・5→3"],
  );
  // ---- 固定の材料（4レースの最小の写し）----
  ({ MATERIALS_VERSION } = await import(
    `${R}/scripts/full-picture/fetch-materials.mjs`
  ));
  assert.ok(
    MATERIALS_SCHEMA.properties.schemaVersion.enum.includes(MATERIALS_VERSION),
    "Schema の版に取得の版がある（形を変えたら両方上げる）",
  );
  assert.equal(
    MATERIALS_VERSION,
    "full-picture-materials/2",
    "BOA-1310: race に seriesDayText・raceTitle を足した版",
  );
  assert.ok(
    MATERIALS_SCHEMA.properties.schemaVersion.enum.includes(
      "full-picture-materials/1",
    ),
    "/1 の固定材料も通す",
  );
  assert.equal(MATERIALS_SCHEMA.$id, MATERIALS_VERSION);
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・entryScenes・HERO_MIN_N・ENTRY_MAX_FRAMES・MATERIALS_SCHEMA・readFileSync・gunzipSync） */
export async function runFullPictureScene2A9(env) {
  ({ buildAll, entryScenes, HERO_MIN_N, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, readFileSync, gunzipSync } = env);
  await scene1();
}

function scene2() {
  assert.ok(fixtures.length >= 3, "固定の材料は3レース以上");
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・entryScenes・HERO_MIN_N・ENTRY_MAX_FRAMES・MATERIALS_SCHEMA・readFileSync・gunzipSync・FX・fixtures） */
export function runFullPictureScene2A10(env) {
  ({ buildAll, entryScenes, HERO_MIN_N, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures } = env);
  scene2();
}

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene3() {
  const load1 = (f) =>
    buildAll(
      JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8")),
    );
  // 風の段を外して当日の水面の日にする（固定の材料はどれも風がある）
  const noWind = (scenes) =>
    scenes.map((x) =>
      x.id === "scene1"
        ? {
            ...x,
            data: {
              ...x.data,
              steps: x.data.steps.filter((st) => st.id !== "s1-wind"),
            },
          }
        : x,
    );
  const low = noWind(load1("2026-10-12-01-12.json.gz"));
  const lowAns = templateText(allBeats(low)).answers;
  // BOA-1157: 当日の数は件数だけで、90日の1着率とも比べない（割合も書かない）
  assert.ok(
    !lowAns["s1-day"].some((l) => l.includes("90日") || l.includes("%")),
    `当日の水面の答えは件数だけ: ${lowAns["s1-day"]}`,
  );
  // 会場と全国を比べられない日（件数が足りない）にして棒を外す
  const lowFew = low.map((x) =>
    x.id === "scene1"
      ? {
          ...x,
          data: {
            ...x.data,
            steps: x.data.steps.map((st) =>
              st.id === "s1-venue90"
                ? {
                    ...st,
                    facts: {
                      ...st.facts,
                      few: true,
                      diffPt: null,
                      direction: null,
                      sig: false,
                    },
                  }
                : st,
            ),
          },
        }
      : x,
  );
  // 以前は |z|<1.96 で棒を外していた日（桐生12R）も、全国と比べられるので棒を出す
  const lowF = low
    .find((x) => x.id === "scene1")
    .data.steps.find((st) => st.id === "s1-venue90").facts;
  assert.ok(Math.abs(venueZ1(lowF)) < 1.96, "前提: 桐生12R は以前の線の外の日");
  assert.ok(
    entryScenes(low, lowAns, { race: "桐生12R" }).scenes[0].data.steps.some(
      (st) => st.id === "s1-venue90",
    ),
    "線の外の日も会場の棒を出す",
  );
  const eLow = entryScenes(lowFew, lowAns, { race: "桐生12R" });
  assert.ok(
    !eLow.scenes[0].data.steps.some((st) => st.id === "s1-venue90"),
    "前提: 比べられない日は会場の棒を外す",
  );
  assert.ok(
    eLow.scenes[0].data.steps.some((st) => st.id === "s1-day"),
    "前提: 当日の水面の段がある",
  );
  assert.ok(
    eLow.answers["s1-day"].length > 0 &&
      !eLow.answers["s1-day"].some((l) => l.includes("90日の1着率")),
    `棒を外した日は90日の1着率を出さない: ${eLow.answers["s1-day"]}`,
  );
  assert.deepEqual(
    lowAns["s1-day"].filter((l) => !l.includes("90日の1着率")),
    eLow.answers["s1-day"],
    "ほかの行はそのまま",
  );
  return { load1, noWind, low, lowAns };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene4({ load1, noWind, low, lowAns }) {
  const high = noWind(load1("2026-10-19-19-10.json.gz"));
  const highAns = templateText(allBeats(high)).answers;
  const eHigh = entryScenes(high, highAns, { race: "下関10R" });
  assert.ok(
    eHigh.scenes[0].data.steps.some((st) => st.id === "s1-venue90"),
    "前提: 比べられる日は会場の棒を出す（線を通らない日も）",
  );
  assert.deepEqual(
    eHigh.answers["s1-day"],
    highAns["s1-day"],
    "棒を出す日は水面の答えを変えない",
  );
  // 結論が無い日は当日の水面の数字。書式は水面の頁と同じ小数1桁（代わりの審査 P3-1）
  const noConc = low.map((x) =>
    x.id === "scene4" ? { ...x, data: { ...x.data, conclusion: null } } : x,
  );
  const eDay = entryScenes(noConc, lowAns, { race: "桐生12R" });
  assert.equal(eDay.hero.source, "day");
  assert.match(
    eDay.hero.value,
    /^\d+\/\d+R$/,
    `水面の数字は件数だけ（BOA-1157）: ${eDay.hero.value}`,
  );
  assert.ok(HERO_MIN_N > 0);
}

function scene5() {
  {
    const s1 = scene3();
    scene4(s1);
  }
  // 入口版は59秒を越えたら会場の棒、次に今日の条件を外し、それでも越えたら止める
  {
    const m = JSON.parse(
      gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"),
    );
    const scenes = buildAll(m);
    // どの答えも2行いっぱい（全角44字分）でも、入口版は59秒以内に収まるか、止まる（越えた MP4 を作らない）
    const ids = [...allBeats(scenes).map((b) => b.id), "s4-conclusion"];
    const long = Object.fromEntries(
      ids.map((id) => [id, ["あ".repeat(22), "い".repeat(22)]]),
    );
    let worst = null;
    try {
      worst = entryScenes(scenes, long);
    } catch (err) {
      assert.match(String(err), /59秒を越える/);
    }
    if (worst)
      assert.ok(
        worst.total <= ENTRY_MAX_FRAMES,
        `最長の答えでも入口版は59秒以内（${(worst.total / 30).toFixed(1)}秒）`,
      );
    // 重ね図の艇が多くて越えるなら、条件の2つ目を外し、それでも越えれば止める
    const s2 = scenes.find((x) => x.id === "scene2");
    // v2 は重ね図を1号艇と2着が多い2艇に絞るので、残る1号艇の焦点を重ねて越えさせる
    const one = s2.data.radar.focus.filter((x) => x.boat === 1);
    const many = scenes.map((x) =>
      x === s2
        ? {
            ...x,
            data: {
              ...x.data,
              radar: {
                ...x.data.radar,
                focus: Array.from({ length: 20 }, () => one).flat(),
              },
            },
          }
        : x,
    );
    assert.throws(
      () => entryScenes(many, long),
      /59秒を越える/,
      "どうしても越えるなら止める（投稿しない）",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・entryScenes・HERO_MIN_N・ENTRY_MAX_FRAMES・MATERIALS_SCHEMA・readFileSync・gunzipSync・FX・fixtures） */
export function runFullPictureScene2A11(env) {
  ({ buildAll, entryScenes, HERO_MIN_N, ENTRY_MAX_FRAMES, MATERIALS_SCHEMA, readFileSync, gunzipSync, FX, fixtures } = env);
  scene5();
}
