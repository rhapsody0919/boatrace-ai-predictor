/**
 * verify-full-picture-scene2.js の後半の場面（6/10）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { templateLines } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-data.mjs";
import { templateText, allBeats, checkLines, lineWidth, MAX_WIDTH } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";
import { has, focus3 } from "./full-picture-scene2-a-1.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let buildAll, entryScenes, ENTRY_MAX_FRAMES, validate, readFileSync, gunzipSync, FX, fixtures;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const { checkAnswers, checkPost } = await import(
    `${R}/scripts/full-picture/scene2-text.mjs`
  );
  const { NO_DATA } = await import(
    `${R}/scripts/full-picture/fetch-materials.mjs`
  );
  const load = (f) =>
    JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8"));
  const raceOf = (m) => m.api.races.find((r) => r.raceId === m.raceId);
  // 各レースの段の並び（正解の写し）。build の退行で段が消えたら落ちる
  const GOLDEN = {
    "2026-10-12-01-12":
      "scene1:venue90,place,day,wind scene2:6/4 scene2b:sonar,flow,flow-1,tri scene3:rough,venue scene4:entry,entry-mae,slit-course,attack-course,course-flow,course-flow-1,course-tri,slit-overall,attack-overall,overall-tri scene5:place,axis-1,axis-2,axis-3,axis-4,axis-5,axis-6,axis-rest scene6:motor,exhibit,deep-2,deep-3,deep-4,deep-5,deep-6 scene8:summary",
    "2026-10-15-15-10":
      "scene1:venue90,place,day,wind scene2:6/2 scene2b:sonar,flow,flow-1,tri scene3:rough,venue scene4:entry,entry-mae,slit-course,attack-course,course-flow,course-flow-4,course-tri,slit-overall,attack-overall,overall-tri scene5:place,axis-1,axis-2,axis-3,axis-4,axis-5,axis-6,axis-rest scene6:motor,exhibit,deep-2,deep-3,deep-4,deep-5,deep-6 scene8:summary",
    "2026-10-16-24-11":
      "scene1:venue90,place,day,wind scene2:6/5 scene2b:sonar,flow,flow-1,tri scene3:rough scene4:entry,entry-mae,slit-course,attack-course,course-flow,course-flow-1,course-tri,slit-overall,attack-overall,overall-tri scene5:place,axis-1,axis-2,axis-3,axis-4,axis-5,axis-6,axis-rest scene6:motor,exhibit,deep-2,deep-3,deep-4,deep-5,deep-6 scene8:summary",
    "2026-10-19-19-10":
      "scene1:venue90,place,day,wind scene2:6/2 scene2b:sonar,flow,flow-1,tri scene3:rough,venue scene4:entry,entry-mae,slit-course,attack-course,course-flow,course-flow-1,course-tri,slit-overall scene5:place,axis-1,axis-2,axis-3,axis-4,axis-5,axis-6,axis-rest scene6:motor,exhibit,deep-2,deep-3,deep-4,deep-5,deep-6 scene8:summary",
  };
  const shape = (scenes) =>
    scenes
      .map((x) =>
        x.kind === "scene2"
          ? `${x.id}:${x.data.radar.focus.length}/${x.data.cards.items.length}`
          : `${x.id}:${x.data.steps.map((st) => st.id.replace(/^s\d+b?-/, "")).join(",")}`,
      )
      .join(" ");
  for (const f of fixtures)
    assert.equal(
      shape(buildAll(load(f))),
      GOLDEN[f.replace(".json.gz", "")],
      `${f}: 段の並びが正解の写しと同じ`,
    );
  const m0 = load(fixtures.at(-1));
  const allText = (scenes) =>
    Object.values(templateText(allBeats(scenes)).answers)
      .flat()
      .join("\n");
  // F1: モーターの2連率・機番が無いと「null%」「null号機」が出た
  {
    const m = structuredClone(m0);
    for (const e of raceOf(m).entries) e.motor2Rate = null;
    const sc = buildAll(m);
    assert.ok(!/null/.test(allText(sc)), "2連率が無くても文に null が出ない");
    assert.ok(
      sc
        .find((x) => x.id === "scene6")
        .data.omitted.some((o) => o.reason.includes("2連率")),
      "2連率の無い鍵の艇は omitted に記録",
    );
  }
  // F4: 今節の展示タイムが全艇無いと落ちた
  {
    const m = structuredClone(m0);
    m.db.motor.exhibition = [];
    const sc = buildAll(m);
    assert.ok(
      !sc
        .find((x) => x.id === "scene6")
        .data.steps.some((st) => st.id === "s6-exhibit"),
      "展示タイムが無ければ段を省く",
    );
  }
  // F8: 類似レースの着順が無いと落ちた
  {
    const m = structuredClone(m0);
    for (const n of m.api.similar.similar.neighbors) n.finish = null;
    const sc = buildAll(m);
    assert.ok(
      sc
        .find((x) => x.id === "scene2b")
        .data.omitted.some((o) => o.where === "scene2b.flow"),
      "着順が無ければ着順の流れを省く",
    );
  }
  return { checkAnswers, checkPost, NO_DATA, m0, allText };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
async function scene2({ checkAnswers, checkPost, NO_DATA, m0, allText }) {
  // F3: facts が null（契約は許す）だと allBeats が落ちた。材料の無い応答は null にする
  {
    const m = structuredClone(m0);
    m.api.facts = null;
    assert.deepEqual(validate(m), [], "facts が null の材料も契約に合う");
    assert.doesNotThrow(
      () => allBeats(buildAll(m)),
      "facts が null でも文を作れる",
    );
    assert.deepEqual(NO_DATA, ["not_saved", "absent", "empty_layer"]);
  }
  // F12: 深掘りの集計が無いと「全体0.0%」と出た
  assert.ok(
    !/全体0\.0%/.test(allText(buildAll(m0))),
    "比べる値の無い深掘りで全体0.0%と書かない",
  );
  // F2: 毎日の実行で文と本文を検査して止める（幅・禁止表現・欠けた値）
  has(checkAnswers({ a: ["4号艇の59号機は2連率null%で1位"] }), "欠けた値");
  has(checkAnswers({ a: ["あ".repeat(23)] }), "幅");
  has(checkAnswers({ a: ["競艇の1号艇"] }), "禁止表現");
  has(checkPost("下関10R\n1着率NaN%"), "欠けた値");
  assert.deepEqual(
    checkAnswers(templateText(allBeats(buildAll(m0))).answers),
    [],
    "固定の材料の文は通る",
  );
  // 1位が3艇で並ぶ艇の文が全角31字分になった（fitFirst のどの候補も入らない）
  assert.deepEqual(
    templateLines({
      ...focus3,
      item: "平均ST（直近30走）",
      value: "0.13秒",
      rank: "4〜6位",
      compare: {
        role: "1位",
        boats: [2, 3, 5].map((b) => ({
          boat: b,
          value: "0.11秒",
          sameDisplay: false,
        })),
      },
    }).every((l) => lineWidth(l) <= MAX_WIDTH),
    true,
    "1位が3艇で並んでも1行に入る",
  );
  // F6: 文の JSON は同じ文型のときだけ使い回す（つないだ版の1行の答えを別物と見て、LLM を呼び直していた）
  const { sameAsTemplate } = await import(
    `${R}/scripts/full-picture/scene2-text.mjs`
  );
  assert.ok(
    sameAsTemplate(
      ["続いて、3・4号艇が1着なら2着は1号艇"],
      ["3・4号艇が1着なら2着は1号艇"],
    ),
    "つなぐ語つきの1行の答えは同じ文型",
  );
  assert.ok(sameAsTemplate(["続いて、a", "b"], ["a", "b"]));
  assert.ok(!sameAsTemplate(["a", "c"], ["a", "b"]), "2行目が違えば別の文");
  assert.ok(!sameAsTemplate(["x"], ["a", "b"]), "行の数が違えば別の文");
  // F10: 「逆に」は前の拍と向きが逆のときだけ
  has(
    checkLines(
      ["逆に、1号艇は2連率50.0%"],
      { kind: "place", direction: "高い" },
      { kind: "venue90", direction: "高い" },
    ),
    "「逆に」だが",
  );
  assert.deepEqual(
    checkLines(
      ["逆に、全国の72.0%より6.1ポイント低い"],
      { kind: "place", direction: "低い", diffPt: 6.1 },
      { kind: "venue90", direction: "高い" },
    ).filter((w) => w.includes("逆に")),
    [],
  );
  return { m0 };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ m0 }) {
  // F7: 入口版は59秒を越えたら条件を外す（外して収まる長さを作る）
  {
    const scenes = buildAll(m0);
    const ans = templateText(allBeats(scenes)).answers;
    // 重ね図の艇の拍を足して、条件があると越え、外すと収まる並びを作る（v2 は1号艇と2着が多い2艇だけ残すので1号艇を重ねる）
    const s2 = scenes.find((x) => x.id === "scene2");
    const one = s2.data.radar.focus.find((x) => x.boat === 1);
    let hit = null;
    for (let k = 1; k <= 12 && !hit; k++) {
      const more = scenes.map((x) =>
        x === s2
          ? {
              ...x,
              data: {
                ...x.data,
                radar: {
                  ...x.data.radar,
                  focus: [
                    ...x.data.radar.focus,
                    ...Array.from({ length: k }, () => one),
                  ],
                },
              },
            }
          : x,
      );
      try {
        const e = entryScenes(more, ans);
        if (e.omitted.some((o) => o.where === "entry.scene1")) hit = e;
      } catch {
        break;
      }
    }
    assert.ok(hit, "条件の2つ目を外す経路を通った");
    // v2: 会場の棒→今日の条件の順に外す。外した段は無く、冒頭の数字は残る
    const gone = hit.omitted
      .filter((o) => o.where === "entry.scene1")
      .map((o) => o.id);
    assert.ok(
      gone.every((id) => !hit.scenes[0].data.steps.some((st) => st.id === id)),
      `外した段が残っていない（${gone}）`,
    );
    assert.equal(
      hit.scenes[0].data.steps[0].id,
      "entry-hero",
      "冒頭の数字は外さない",
    );
    assert.ok(hit.total <= ENTRY_MAX_FRAMES, "外して59秒以内");
  }
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = await scene2(s1);
    scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・entryScenes・ENTRY_MAX_FRAMES・validate・readFileSync・gunzipSync・FX・fixtures） */
export async function runFullPictureScene2A13(env) {
  ({ buildAll, entryScenes, ENTRY_MAX_FRAMES, validate, readFileSync, gunzipSync, FX, fixtures } = env);
  await scene4();
}
