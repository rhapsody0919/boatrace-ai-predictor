/**
 * verify-full-picture-scene2.js の後半の場面（5/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { runFullPictureScene2C1 } from "./full-picture-scene2-c-1.js";
import { reviewReasons, listTypesB1211, resolveType, lengthRange, lengthReason, buildBundleB1211, checkBundle } from "./full-picture-scene2-d-4.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let readFileSync, gunzipSync, FX, fixtures, wf4, rf4, tmp, rB1451;
let listTypes, post;
export let answerOf, scopeLabel, buildBundle;

// 段5の記録は P0 審査1件（2026-10-27〜）。伏せた比較（blindCompare）は段8を回す型だけの任意
const base = {
  approved: { structure: "x" },
  range: {},
  review: { direction: "d", owner: "o" },
};

// 試験用の表: 受け持つ項目と承認した文
const T = {
  "t-test": {
    attrs: ["structure", "length_s"],
    approved: { structure: "要点1つ", length_s: "25〜30" },
  },
};

const ok = {
  id: "t-test",
  attributes: { structure: "要点1つ", length_s: "25〜30" },
};

// 答えは形を問わない割合（予想の形の過去の差は今日に引き継がれない。BOA-1096）。評価の言葉は使わない
export const tri = (k1, other) => ({ "1-2-3": k1, "2-1-3": other });

function scene1() {
  assert.deepEqual(
    reviewReasons("t", {
      ...base,
      review: {
        ...base.review,
        p0Review: {
          role: "youtube-channel",
          verdict: "P0 0件",
          date: "2026-10-28",
        },
      },
    }),
    [],
    "P0 審査1件で足りる（伏せた比較なし）",
  );
  assert.ok(
    reviewReasons("t", base).some((w) => w.includes("段5の記録")),
    "段5の記録が無ければ落ちる",
  );
  assert.ok(
    reviewReasons("t", {
      ...base,
      review: { ...base.review, p0Review: { role: "x", verdict: "P0 0件" } },
    }).some((w) => w.includes("P0 審査の記録")),
    "日付が無ければ落ちる",
  );
  assert.ok(
    reviewReasons("t", {
      ...base,
      review: { ...base.review, channels: "c" },
      approved: {},
    }).some((w) => w.includes("承認した文")),
  );
  assert.ok(
    reviewReasons("t", { ...base, review: { owner: "o", channels: "c" } }).some(
      (w) => w.includes("direction"),
    ),
  );
  assert.deepEqual(
    listTypesB1211().map((x) => x.id),
    ["v2r1-answer-fill-explain", "f01-landscape-voice-full"],
  );
  // 型 f01: hq の文のまま渡せば完全版を f01 で作る印（full）が付く。length_s は完全版の尺の文で、入口版の尺の検査に使わない（run-full）
  {
    const f01t = resolveType(
      listTypesB1211().find((x) => x.id === "f01-landscape-voice-full"),
    );
    assert.deepEqual(f01t.reasons, []);
    assert.equal(f01t.impl.full, "f01");
    assert.equal(
      lengthRange(f01t.attributes.length_s),
      null,
      "f01 の length_s は秒の範囲として読めない（入口版には当てない）",
    );
  }
  assert.deepEqual(resolveType(ok, T).reasons, []);
  assert.deepEqual(listTypesB1211(T), [
    { id: "t-test", attributes: T["t-test"].approved },
  ]);
  // 表に無い型は、渡された項目ごとに type_unsupported（黙って今の型で作らない）
  assert.deepEqual(
    resolveType(
      {
        id: "e06-data-cheatsheet",
        attributes: { structure: "早見表", thumb: "表" },
      },
      T,
    ).reasons,
    [
      "type_unsupported:structure（型 e06-data-cheatsheet は龍神の表に無い）",
      "type_unsupported:thumb（型 e06-data-cheatsheet は龍神の表に無い）",
    ],
  );
  assert.deepEqual(
    resolveType({ ...ok, attributes: { ...ok.attributes, thumb: "表" } }, T)
      .reasons,
    ["type_unsupported:thumb"],
    "表の型でも実装していない項目は止める",
  );
  assert.deepEqual(
    resolveType(
      { ...ok, attributes: { ...ok.attributes, structure: "要点2つ" } },
      T,
    ).reasons,
    ["type_unsupported:structure（文が変わった）"],
    "同じ id で文が変わった項目は止める（system-architect P2）",
  );
  // voice は hq が 10/27 に type_attrs へ足した（型 f01）。知らない項目の例は bgm
  assert.deepEqual(
    resolveType({ id: "x", attributes: { bgm: "a" } }, T).reasons,
    ["type_unsupported:bgm（知らない項目）"],
  );
  assert.deepEqual(
    resolveType({ id: "x", attributes: { voice: "a" } }, T).reasons,
    ["type_unsupported:voice（型 x は龍神の表に無い）"],
  );
}

function scene2() {
  assert.match(
    resolveType({ id: "t-test", attributes: {} }, T).reasons[0],
    /^type_spec_invalid/,
  );
  assert.ok(resolveType(ok).reasons.length > 0, "表に無い型は止まる");
  assert.deepEqual(lengthRange("25〜30"), [25, 30]);
  assert.equal(lengthRange("短め"), null);
  assert.equal(lengthReason({ length_s: "25〜30" }, 26), null);
  // 理由は固定の文、実測は detail（hq は reasons[0] で起票の重複を判定する。system-architect P1-1）
  assert.deepEqual(lengthReason({ length_s: "25〜30" }, 38.4), {
    reason: "type_unsupported:length_s",
    detail: "入口版 38.4秒が範囲 25〜30秒の外",
  });
  assert.equal(
    lengthReason({ structure: "x" }, 99),
    null,
    "length_s が無ければ尺は見ない",
  );
  // 束: 型の id を content_type に。無ければ書かない
  {
    const base = {
      raceId: "2026-10-12-01-12",
      venue: "桐生",
      raceNo: 12,
      month: 10,
      day: 12,
      round: "yusho",
      facts: { venue90: null, overview: null, conclusion: null, hero: null },
      chapters: "0:00 条件\n0:22 6艇比較\n1:07 類似レース\n1:43 展開",
      fullSeconds: 211,
      qa: { a: true },
    };
    const b = buildBundleB1211({ ...base, contentType: "t-test" });
    assert.deepEqual(b.content_type, { id: "t-test" });
    assert.deepEqual(checkBundle(b), []);
    assert.equal(
      buildBundleB1211(base).content_type,
      undefined,
      "型が無ければ書かない",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（readFileSync・gunzipSync・FX・fixtures） */
export function runFullPictureScene2D9(env) {
  ({ readFileSync, gunzipSync, FX, fixtures } = env);
  scene1();
  scene2();
}

async function scene3() {
  // ---- v2r1（今の型の直し、入口版の冒頭に言葉の答え。docs/design/full-picture-type-gate/candidates/v2r1-answer-fill-explain/script.md）----
  ({ answerOf, scopeLabel } = await import(
    `${R}/scripts/full-picture/answer.mjs`
  ));
  ({ buildBundle } = await import(`${R}/scripts/full-picture/bundle.mjs`));
  ({ listTypes } = await import(`${R}/scripts/full-picture/type-spec.mjs`));
}

/** verify から呼ぶ入口。env は verify 側の束縛（readFileSync・gunzipSync・FX・fixtures） */
export async function runFullPictureScene2D10(env) {
  ({ readFileSync, gunzipSync, FX, fixtures } = env);
  await scene3();
}

function scene4() {
  // ---- 後半の場面（verifyData/full-picture-scene2-c-1.js） ----
  runFullPictureScene2C1({ R, answerOf, scopeLabel, buildBundle, tri });
}

/** verify から呼ぶ入口。env は verify 側の束縛（readFileSync・gunzipSync・FX・fixtures・wf4・rf4） */
export function runFullPictureScene2D11(env) {
  ({ readFileSync, gunzipSync, FX, fixtures, wf4, rf4 } = env);
  scene4();
}

function scene5() {
  wf4(
    `${tmp}/m.json`,
    gunzipSync(
      readFileSync(
        new URL(
          fixtures.find((f) => f.startsWith("2026-10-19")),
          FX,
        ),
      ),
    ).toString("utf8"),
  );
  wf4(`${tmp}/t.json`, JSON.stringify(listTypes()[0]));
}

/** verify から呼ぶ入口。env は verify 側の束縛（readFileSync・gunzipSync・FX・fixtures・wf4・rf4・tmp） */
export function runFullPictureScene2D12(env) {
  ({ readFileSync, gunzipSync, FX, fixtures, wf4, rf4, tmp } = env);
  scene5();
}

function scene6() {
  assert.equal(rB1451.status, 0, rB1451.stderr.slice(-500));
  post = rf4(`${tmp}/out/post-entry.txt`, "utf8");
  assert.match(
    post.split("\n")[2],
    /^この組み合わせの過去で、1号艇の1着は約\d割$/,
    post,
  );
  assert.match(
    post.split("\n")[3],
    /^（.+・同じ級別の組み合わせ.+の過去[\d,]+件中[\d,]+件・\d+\.\d%。過去の割合で、今日の結果を示すものではない）$/,
    post,
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（readFileSync・gunzipSync・FX・fixtures・wf4・rf4・tmp・rB1451） */
export function runFullPictureScene2D13(env) {
  ({ readFileSync, gunzipSync, FX, fixtures, wf4, rf4, tmp, rB1451 } = env);
  scene6();
}
