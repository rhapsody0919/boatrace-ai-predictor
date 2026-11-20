/**
 * verify-full-picture-scene2.js の後半の場面（1/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let answerOf, scopeLabel, buildBundle, tri;
let sc, a, thin, answer, b, xl, selectRaces, SELECT_RULE, withVariant, VARIANTS, typeFailure, day, other;
export let childEnv, readAnonEnv;

const conclusion = {
  form: "内3艇そろう",
  n: 49,
  boat: 1,
  count: 30,
  pct: 61.2,
};

const race = (n, t, stage, cancel = null) => ({
  raceId: `2026-10-19-19-${String(n).padStart(2, "0")}`,
  raceNumber: n,
  startTime: t,
  raceStage: stage,
  cancellationStatus: cancel,
});

function scene1() {
  sc = {
    cells: {
      waku: {
        forms: {
          any: { n: 242, tri: tri(137, 105) },
          wall: { n: 49, tri: tri(30, 19) },
        },
      },
    },
    period: ["2019-04-01", "2026-10-22"],
  };
  a = answerOf(sc, "wall");
  assert.equal(a.ok, true);
  assert.deepEqual([a.n0, a.k0, a.p0], [242, 137, 56.6]);
  assert.equal(a.label, "この組み合わせの過去で、1号艇の1着は約6割");
  assert.deepEqual(a.labelLines, [
    "この組み合わせの過去で",
    "1号艇の1着は約6割",
  ]);
  assert.ok(
    !/堅い|崩れ|いつも/.test(a.label + a.small),
    "評価の言葉を使わない",
  );
  assert.deepEqual(
    a.form,
    { key: "wall", n: 49, k: 30, p: 61.2 },
    "形は事実として持つだけ",
  );
  assert.equal(
    answerOf(sc, null).ok,
    true,
    "形が無くても作る（段 N、オーナー 10/25 (b)→(1)）",
  );
  // データが薄いレース（この組み合わせの過去が30件未満）は作らない。固定の語 thin_data（hq が日ごとの減りを数える）
  thin = answerOf(
    { cells: { waku: { forms: { any: { n: 25, tri: tri(15, 10) } } } } },
    null,
  );
  assert.deepEqual([thin.ok, thin.kind], [false, "thin_data"]);
  assert.equal(
    scopeLabel("VC:12:2-2-2-0:1A2", ["2019-04-01", "2026-10-22"], "住之江"),
    "住之江・同じ級別の組み合わせ・2019/4〜2026/10・枠なり",
  );
  assert.equal(
    scopeLabel("NC:2-2-2-0:1A2", null, "びわこ"),
    "全国・同じ級別の組み合わせ・枠なり",
  );
  // 本文: 答えの1文と、条件・件数・注記の行に分ける。形の行（結論の行）は出さない（入口版の結論も同じ母数にそろえた）
  answer = {
    label: a.label,
    n0: 242,
    k0: 137,
    p0: 56.6,
    scope: "住之江・同じ級別の組み合わせ・2019/4〜2026/10・枠なり",
  };
  b = buildBundle({
    raceId: "2026-10-23-12-11",
    venue: "住之江",
    raceNo: 11,
    month: 10,
    day: 23,
    round: "junyu",
    facts: {
      venue90: null,
      overview: null,
      conclusion,
      hero: { title: a.label },
    },
    chapters: "0:00 条件\n0:22 6艇比較\n1:07 類似レース\n1:43 展開",
    fullSeconds: 211,
    qa: { a: true },
    answer,
  });
  xl = b.x_text.split("\n");
  assert.equal(xl[2], "この組み合わせの過去で、1号艇の1着は約6割");
  assert.equal(
    xl[3],
    "（住之江・同じ級別の組み合わせ・2019/4〜2026/10・枠なりの過去242件中137件・56.6%。過去の割合で、今日の結果を示すものではない）",
  );
  assert.ok(
    !b.x_text.includes("61.2%"),
    "形の行は出さない（冒頭と結論の数字を分けない）",
  );
  assert.ok(b.youtube_shorts.description.includes("過去242件中137件・56.6%"));
}

/** verify から呼ぶ入口。env は verify 側の束縛（answerOf・scopeLabel・buildBundle・tri） */
export function runFullPictureScene2C1(env) {
  ({ answerOf, scopeLabel, buildBundle, tri } = env);
  scene1();
}

async function scene2() {
  // ---- 毎日の実行（daily.mjs、hq の切替案 v2 §9）と LLM の usage ----
  ({
    selectRaces,
    childEnv,
    readAnonEnv,
    SELECT_RULE,
    withVariant,
    VARIANTS,
    typeFailure,
  } = await import(`${R}/scripts/full-picture/daily.mjs`));
  // run-full が型で止まったときは stage=type-spec・固定の文の reasons・実測の detail（system-architect P1-1）
  assert.deepEqual(
    typeFailure(
      "[省いた要素] x\ntype_unsupported:length_s\ntype_detail: 入口版 38.4秒が範囲 25〜30秒の外\n",
    ),
    {
      reasons: ["type_unsupported:length_s"],
      detail: ["入口版 38.4秒が範囲 25〜30秒の外"],
    },
  );
  assert.equal(
    typeFailure("Error: 描画に失敗\n    at x"),
    null,
    "描画の失敗は型の失敗にしない",
  );
  day = [
    race(9, "21:23", "一般"),
    race(10, "21:51", "準優勝戦"),
    race(11, "22:20", "準優勝戦"),
    race(12, "22:45", "一般"),
  ];
  // 締切 21:58 前の優勝戦・準優勝戦のうち一番遅いもの（22:20 の11R は締切を過ぎるので外す）
  assert.deepEqual(selectRaces(day, "2026-10-19"), [
    {
      race_id: "2026-10-19-19-10",
      deadline: "2026-10-19T12:51:00.000Z",
      race_stage: "準優勝戦",
    },
  ]);
  // plan の各行に race_stage（race_conditions.race_stage の文字列そのまま。hq SQ08 v5）。12R の代わりの行も、無ければ null
  assert.deepEqual(
    selectRaces([race(12, "21:30", "一般")], "2026-10-19").map(
      (x) => x.race_stage,
    ),
    ["一般"],
  );
  assert.deepEqual(
    selectRaces([race(12, "21:30", null)], "2026-10-19").map(
      (x) => x.race_stage,
    ),
    [null],
  );
  // 札（--variant a|b）は bundle の full_picture_variant.id に書く。無ければ bundle はそのまま
  assert.deepEqual(VARIANTS, ["a", "b"]);
  assert.deepEqual(withVariant({ race_id: "x" }, "b"), {
    race_id: "x",
    full_picture_variant: { id: "b" },
  });
  assert.deepEqual(withVariant({ race_id: "x" }, null), { race_id: "x" });
  // 中止なら外す。優勝戦・準優勝戦が無ければ 12R の一番遅いもの
  other = [
    race(12, "16:40", "一般"),
    { ...race(12, "17:10", "一般"), raceId: "2026-10-19-01-12" },
    race(10, "15:50", "一般"),
  ];
  assert.deepEqual(
    selectRaces(other, "2026-10-19").map((x) => x.race_id),
    ["2026-10-19-01-12"],
  );
  assert.deepEqual(
    selectRaces(
      [race(10, "21:51", "準優勝戦", "confirmed"), race(12, "21:30", "一般")],
      "2026-10-19",
    ).map((x) => x.race_id),
    ["2026-10-19-19-12"],
    "中止は外す",
  );
  assert.deepEqual(
    selectRaces(day, "2026-10-19", 2).map((x) => x.race_id),
    ["2026-10-19-19-10"],
    "規則に合うのが1つなら1つ",
  );
  assert.equal(SELECT_RULE.deadlineBefore, "21:58");
}

/** verify から呼ぶ入口。env は verify 側の束縛（answerOf・scopeLabel・buildBundle・tri） */
export async function runFullPictureScene2C2(env) {
  ({ answerOf, scopeLabel, buildBundle, tri } = env);
  await scene2();
}
