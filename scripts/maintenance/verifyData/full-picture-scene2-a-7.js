/**
 * verify-full-picture-scene2.js の後半の場面（7/10）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { templateText, allBeats, connectedText, checkLines } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";
import { has } from "./full-picture-scene2-a-1.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let buildAll, readFileSync, gunzipSync, FX, fixtures;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  // 場面3③の回収率の拍は出さない（2026-10-20 オーナー決定。20〜45走では選手の差を示さず、収益を連想させる）
  for (const f of fixtures) {
    const sc = buildAll(
      JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8")),
    );
    assert.ok(
      !sc
        .find((x) => x.id === "scene3")
        .data.steps.some((st) => st.id === "s3-return"),
      `${f}: 回収率の拍が無い`,
    );
    assert.ok(
      !/回収率/.test(
        Object.values(templateText(allBeats(sc)).answers)
          .flat()
          .join("\n"),
      ),
      `${f}: 字幕に回収率が無い`,
    );
  }
  // つなぐ語を近くで繰り返さない（10/19 は「続いて」20回・同じ語の連続9回だった）
  const { repeatReasons, groupDigits } = await import(
    `${R}/scripts/full-picture/scene2-text.mjs`
  );
  const u = [
    { step: "s", connector: "さらに" },
    { step: "s", connector: null },
    { step: "s", connector: "続いて" },
  ];
  has(repeatReasons("さらに", "s", u), "直前の3拍");
  assert.deepEqual(
    repeatReasons("さらに", "s", [...u, { step: "s", connector: null }]),
    [],
    "4拍離れれば使える",
  );
  const gap = Array(3).fill({ step: "s", connector: null });
  has(
    repeatReasons("続いて", "s", [
      { step: "s", connector: "続いて" },
      ...gap,
      { step: "s", connector: "続いて" },
      ...gap,
    ]),
    "2回まで",
  );
  assert.deepEqual(repeatReasons(null, "s", u), []);
  // 偽物の LLM が全拍に「続いて」を付けても、付くのは間を空けた場面ごとに2回まで
  const allBeats4 = allBeats(
    buildAll(
      JSON.parse(
        gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"),
      ),
    ),
  );
  const allTsuzuite = connectedText(allBeats4, () =>
    JSON.stringify({
      beats: allBeats4.map((b) => ({ id: b.id, connector: "続いて" })),
    }),
  );
  const perScene = {};
  allTsuzuite.beats.forEach((b, i) => {
    if (b.connector !== "続いて") return;
    perScene[allBeats4[i].step] = (perScene[allBeats4[i].step] ?? 0) + 1;
  });
  assert.ok(
    Object.values(perScene).every((n) => n <= 2),
    `「続いて」は場面ごとに2回まで: ${JSON.stringify(perScene)}`,
  );
  allTsuzuite.beats.forEach((b, i) => {
    if (b.connector)
      for (let k = Math.max(0, i - 3); k < i; k++)
        assert.notEqual(
          allTsuzuite.beats[k].connector,
          b.connector,
          `${b.id}: 直前の3拍と同じ語`,
        );
  });
  return { groupDigits };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ groupDigits }) {
  // 件数の桁区切り（頁とそろえる）と、差のポイントは小数1桁
  assert.equal(
    groupDigits("1号艇が1着なら2着は2号艇 / 9961件の33.8%（3367件）"),
    "1号艇が1着なら2着は2号艇 / 9,961件の33.8%（3,367件）",
  );
  assert.equal(
    groupDigits("類似レース400件で1着最多は1号艇"),
    "類似レース400件で1着最多は1号艇",
  );
  assert.equal(
    groupDigits("篠崎元志の1号艇は1044走、過去90日の1234レース、21.3ポイント"),
    "篠崎元志の1号艇は1,044走、過去90日の1,234レース、21.3ポイント",
  );
  assert.deepEqual(
    checkLines(
      ["下関で1号艇が1着なら2着は2号艇", "9,961件の33.8%（3,367件）"],
      {
        kind: "followers",
        venue: "下関",
        boat: 1,
        second: { boat: 2, rate: "33.8", k: 3367 },
        n: 9961,
      },
      null,
    ),
    [],
    "桁区切りの数は facts と照合できる",
  );
  for (const f of fixtures) {
    const sc = buildAll(
      JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8")),
    );
    const ans = templateText(allBeats(sc)).answers;
    for (const [id, ls] of Object.entries(ans))
      for (const l of ls) {
        assert.ok(
          !/(?<![\d.,])\d{4,}(件|走|レース)/.test(l),
          `${f} ${id}: 4桁以上の件数は桁区切り「${l}」`,
        );
        assert.ok(
          !/より\d+ポイント/.test(l),
          `${f} ${id}: 差のポイントは小数1桁「${l}」`,
        );
      }
  }
}

async function scene3() {
  {
    const s1 = await scene1();
    scene2(s1);
  }
  // ---- 個人の成績か、会場（全選手）・過去のレースの集計かが、答えを読んで分かる（2026-10-20 オーナー、BOA-913）----
  {
    const { scopeReasons, SCOPE_WORDS } = await import(
      `${R}/scripts/full-picture/scene2-text.mjs`
    );
    // 4レースの全拍の答えが通る（kind ごとの範囲の語。決まって入る「全国の…」「件」では通さない）
    for (const f of fixtures) {
      const beats = allBeats(
        buildAll(
          JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8")),
        ),
      );
      for (const b of beats)
        assert.deepEqual(
          scopeReasons(b.template, b.facts),
          [],
          `${f} ${b.id}: 範囲の語「${b.template.join(" / ")}」`,
        );
    }
    // 本番と同じ2行の形で、範囲の語を落とした答えを止める（代わりの審査 P2: 「全国の…」「件」「全体」で素通りしていた）
    has(
      scopeReasons(["1号艇の1着率62.1%", "全国の54.6%より7.5ポイント高い"], {
        kind: "venue90",
        venue: "下関",
      }),
      "範囲の語が無い",
    );
    has(
      scopeReasons(
        ["当地勝率3位の1着69%", "1号艇全体の71.1%より2.1ポイント低い"],
        { kind: "card" },
      ),
      "範囲の語が無い",
    );
    has(
      scopeReasons(["1号艇が1着なら2着は2号艇", "9,961件の33.8%（3,367件）"], {
        kind: "followers",
        venue: "下関",
      }),
      "範囲の語が無い",
    );
    has(
      scopeReasons(
        ["下関1号艇は7走で1着率100.0%", "全会場の87.7%より12.3ポイント高い"],
        { kind: "venueRecord", name: "篠崎元志" },
      ),
      "範囲の語が無い",
    );
    has(
      scopeReasons(["1号艇は直近30走1着率33%で1位", "2番手は5号艇の18%"], {
        kind: "focus",
      }),
      "範囲の語が無い",
    );
    // 決まりの無い種類で割合を出したら止める（新しい集計の拍が検査から漏れない）
    has(
      scopeReasons(["1号艇は単勝回収率100.2%"], { kind: "returnRate" }),
      "決まりが無い種類",
    );
    assert.ok(!("returnRate" in SCOPE_WORDS), "回収率の種類は無い");
    has(
      checkLines(
        ["1号艇の1着率62.1%", "全国の54.6%より7.5ポイント高い"],
        {
          kind: "venue90",
          venue: "下関",
          rate: 62.1,
          national: 54.6,
          diffPt: 7.5,
          direction: "高い",
        },
        null,
      ),
      "範囲の語が無い",
    );
  }
}

async function scene4() {
  // ---- 場面4のスタートの形（BOA-979、2026-10-21 オーナー決定）----
  // 平均ST をサイトと同じ型の定義（slitForms）で判定する。手がかりの条件からの写像（1コース最速→イン凹み 等）はやめ、
  // 当てはまらなければ横一線に寄せず「どの形にも当てはまらない」にする
  {
    const { formsOfAvgSt, keyBoatsOf } = await import(
      `${R}/scripts/full-picture/scenes/scene4.mjs`
    );
    const s4Of = (f) =>
      buildAll(
        JSON.parse(gunzipSync(readFileSync(new URL(f, FX))).toString("utf8")),
      ).find((x) => x.id === "scene4").data;
    const slit = (d, v) => d.steps.find((st) => st.id === `s4-slit-${v}`);
    // 2026-10-16-24-11「このコース」の平均ST 126,121,139,169,181,202（外ほど遅い段々）は「横一線を参考に」と出ていた。内3艇そろう（差0.02以内）に当てはまる
    const d16 = s4Of("2026-10-16-24-11.json.gz");
    assert.ok(
      !/横一線を参考に/.test(slit(d16, "course").lines.join("")),
      "10/16 このコースで横一線に寄せない",
    );
    assert.equal(
      slit(d16, "course").facts.form,
      "内3艇そろう",
      "10/16 このコースは内3艇そろう",
    );
    // 2026-10-12-01-12「全体」の平均ST 123,124,153,162,170,143（1コースが最速）は「イン凹みに一致」と出ていた（逆の意味）。横一線に当てはまる
    const d12 = s4Of("2026-10-12-01-12.json.gz");
    assert.ok(
      !/イン凹み/.test(slit(d12, "overall").lines.join("")),
      "10/12 全体はイン凹みと言わない",
    );
    assert.equal(slit(d12, "overall").facts.form, "横一線");
    // 1コースが最速の並びは、イン凹み（1コースが2コースより0.05以上遅い）に当てはまらない
    assert.ok(!formsOfAvgSt([0.1, 0.15, 0.16, 0.17, 0.18, 0.19]).includes("d1"));
    assert.ok(
      formsOfAvgSt([0.2, 0.14, 0.15, 0.16, 0.17, 0.18]).includes("d1"),
      "1コースが0.06遅ければイン凹み",
    );
    assert.deepEqual(
      formsOfAvgSt([0.1, null, 0.1, 0.1, 0.1, 0.1]),
      [],
      "欠けがあれば判定しない",
    );
    // どの形にも当てはまらない並び（外3艇遅れ＝外凹み。7形に無い）: 横一線に寄せず、STEP3 を出さず、STEP4 と結論は「どの形でも」
    const outDent = [0.05, 0.09, 0.06, 0.09, 0.16, 0.18];
    assert.deepEqual(
      formsOfAvgSt(outDent),
      [],
      "外凹みは7形のどれにも当てはまらない",
    );
    const m = JSON.parse(
      gunzipSync(readFileSync(new URL("2026-10-19-19-10.json.gz", FX))).toString(
        "utf8",
      ),
    );
    m.api.scenario.course_st.course_filled = outDent;
    // 固定の材料は読んだ所だけの写しなので「どの形でも」のセルが無い。同じ形の値を代わりに置く（判定と言い方の試験）
    m.api.scenario.scenario.cells.waku.forms.any =
      m.api.scenario.scenario.cells.waku.forms.flat;
    const dn = buildAll(m).find((x) => x.id === "scene4").data;
    const sn = slit(dn, "course");
    assert.equal(sn.facts.form, null);
    assert.ok(
      sn.lines.join("").includes("どの形にも当てはまらない") &&
        !/横一線/.test(sn.lines.join("")),
      `当てはまらない言い方: ${sn.lines.join(" / ")}`,
    );
    assert.ok(!sn.page.forms.some((x) => x.on), "形の札を点けない");
    assert.ok(
      !dn.steps.some((st) => st.id === "s4-attack-course"),
      "当てはまる形が無ければ攻めの拍を出さない（Web と同じ）",
    );
    assert.ok(
      dn.conclusion && dn.conclusion.lines[0].startsWith("枠なりの過去"),
      `結論は「どの形でも」: ${dn.conclusion?.lines[0]}`,
    );
    assert.equal(
      dn.conclusion.entryQuestion,
      "過去のレースは、どう決まった？",
      "入口版で「同じ並び」と言わない",
    );
    assert.deepEqual(
      keyBoatsOf(m),
      { form: null, boats: [1] },
      "鍵の艇も横一線に寄せない",
    );
    const ans = templateText(allBeats(buildAll(m))).answers;
    for (const id of ["s4-slit-course"])
      assert.deepEqual(
        checkLines(ans[id], dn.steps.find((st) => st.id === id).facts, null),
        [],
        "当てはまらない言い方も文の検査を通る",
      );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・readFileSync・gunzipSync・FX・fixtures） */
export async function runFullPictureScene2A14(env) {
  ({ buildAll, readFileSync, gunzipSync, FX, fixtures } = env);
  await scene3();
  await scene4();
}
