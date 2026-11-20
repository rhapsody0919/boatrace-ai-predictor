/**
 * verify-full-picture-scene2.js の後半の場面（8/10）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { diffOf, diffText, rankOf } from "../../../sns-video-studio/remotion/scripts/full-picture/scenes/diff.mjs";
import { checkLines } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let buildAll, readFileSync, gunzipSync, FX;

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene1() {
  const { buildBundle } = await import(`${R}/scripts/full-picture/bundle.mjs`);
  const S = (ka, na, kb, nb) => ({
    a: (ka / na) * 100,
    na,
    b: (kb / nb) * 100,
    nb,
  });
  const mk = (venue90, conclusion = null) =>
    buildBundle({
      raceId: "2026-10-26-21-10",
      venue: "大村",
      raceNo: 10,
      month: 10,
      day: 26,
      facts: { venue90, overview: null, conclusion },
      chapters: "0:00 条件\n0:22 6艇比較\n1:07 類似レース\n1:43 展開",
      fullSeconds: 211,
      qa: { a: true },
    });
  // 10/26 大村10R: 58.1% 対 全国 54.6%（z=1.67、線の外）。以前は「差は確認できない」で題は既定の後半だった
  const smp = S(348, 599, 7640, 13985);
  const f = {
    kind: "venue90",
    venue: "大村",
    rate: 58.1,
    national: 54.6,
    races: 599,
    ...diffOf(58.1, 54.6, smp),
  };
  assert.equal(f.z, 1.67, "前提: z は線の外（参考値として残る）");
  assert.equal(
    f.direction,
    "高い",
    "場面の facts も線の外で向きを持つ（2026-11-01）",
  );
  const b = mk(f);
  assert.match(
    b.youtube_full.title,
    /大村の1着率は全国より高い/,
    `線の外でも題に向きを言う: ${b.youtube_full.title}`,
  );
  assert.match(
    b.x_text,
    /全国の同じ期間の54\.6%より3\.5ポイント高い/,
    "本文も向きを言う",
  );
  assert.ok(
    !b.x_text.includes("偶然の範囲") && !b.x_text.includes("差は確認できない"),
    "線の注記を付けない",
  );
  // 低い側
  const lo = mk({
    ...f,
    rate: 50.0,
    ...diffOf(50.0, 54.6, S(300, 600, 7640, 13985)),
  });
  assert.match(lo.youtube_full.title, /全国より低い/);
  assert.match(lo.x_text, /4\.6ポイント低い/);
  // 1ポイント未満・件数が足りない日は向きを言わない（線とは別の決まり）
  const near = mk({
    ...f,
    rate: 54.9,
    ...diffOf(54.9, 54.6, S(329, 599, 7640, 13985)),
  });
  assert.ok(
    !/より(高い|低い)/.test(near.youtube_full.title) &&
      near.x_text.includes("との差は1ポイント未満"),
    "1ポイント未満",
  );
  const few = mk({
    ...f,
    races: 6,
    ...diffOf(100, 54.6, S(6, 6, 7640, 13985)),
  });
  return { mk, few };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene2({ mk, few }) {
  assert.ok(
    !/全国より(高い|低い)/.test(few.youtube_full.title) &&
      few.x_text.includes("とは比べられない"),
    "件数が足りない日は向きを言わない",
  );
  // 結論: 1位と2位の差が小さくても「1着最多」と書く（以前は「差は確認できない」）
  const c = mk(null, {
    form: null,
    n: 20,
    boat: 1,
    count: 7,
    pct: 35,
    next: { boat: 2, count: 6 },
    rankSig: false,
  });
  assert.match(
    c.x_text,
    /1着最多は1号艇で7件（35%）/,
    "7 対 6 でも件数つきで言う",
  );
  assert.ok(!c.x_text.includes("差は確認できない"));
  // 同数は「最多」と言わない（事実の誤りになる）
  const tie = mk(null, {
    form: null,
    n: 12,
    boat: 1,
    count: 6,
    pct: 50,
    next: { boat: 2, count: 6 },
    rankSig: false,
  });
  assert.match(tie.x_text, /1号艇と2号艇が6件で並ぶ/);
  assert.ok(!tie.x_text.includes("1着最多"));
}

async function scene3() {
  {
    const s1 = await scene1();
    scene2(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・readFileSync・gunzipSync・FX） */
export async function runFullPictureScene2A15(env) {
  ({ buildAll, readFileSync, gunzipSync, FX } = env);
  await scene3();
}

/** 元の verify の1つの塊 { } を割った 1/2 */
function scene4() {
  const S = (ka, na, kb, nb) => ({
    a: (ka / na) * 100,
    na,
    b: (kb / nb) * 100,
    nb,
  });
  const cases = [
    [
      S(348, 599, 7640, 13985),
      1.67,
      "高い",
      "全国より3.5ポイント高い",
      "s1-venue90",
    ],
    [
      S(23, 33, 224035, 405581),
      1.67,
      "高い",
      "全国より3.5ポイント高い",
      "s3-rough",
    ],
    [S(6, 6, 348, 599), null, null, "全国とは比べられない", "s1-day 6/6"],
  ];
  for (const [smp, z, dir, text, what] of cases) {
    const f = diffOf(smp.a, smp.b, smp);
    assert.equal(f.z, z, `${what} の z は hq と同じ`);
    assert.equal(f.direction, dir, `${what} の向き`);
    if (dir) {
      assert.equal(
        diffText("全国", f),
        `全国より${f.diffPt.toFixed(1)}ポイント高い`,
        `${what} の文`,
      );
      assert.deepEqual(
        checkLines(
          [
            "大村の1号艇の1着率58.1%",
            `全国の54.6%より${f.diffPt.toFixed(1)}ポイント高い`,
          ],
          f,
          null,
        ).filter((w) => w.includes("向き")),
        [],
        `${what} で「高い」は文の検査を通る`,
      );
    } else {
      assert.equal(diffText("全国", f), text, `${what} の文`);
      assert.ok(
        checkLines(
          ["大村の1号艇の1着率58.1%", "全国の54.6%より3.5ポイント高い"],
          f,
          null,
        ).some((w) => w.includes("向きが無い")),
        `${what} で「高い」は文の検査で止まる`,
      );
    }
  }
  const g = diffOf(60, 50, S(600, 1000, 5000, 10000));
  assert.equal(g.direction, "高い");
  assert.equal(diffText("全国の50.0%", g), "全国の50.0%より10.0ポイント高い");
  assert.equal(diffOf(40, 50, S(400, 1000, 5000, 10000)).direction, "低い");
  assert.equal(
    diffOf(51, 50, null).direction,
    null,
    "件数が無ければ言い切らない",
  );
  assert.equal(
    diffText("全国", diffOf(50.5, 50, S(505, 1000, 5000, 10000))),
    "全国との差は1ポイント未満",
    "1ポイント未満は向きを言わない",
  );
  // 小標本（どちらかが30件未満）は z を出さず、比べられない（hq data-scientist 2026-10-27。6/6 対 348/599 は z=2.07 でも言わない）
  assert.equal(
    diffOf(60, 50, S(18, 29, 5000, 10000)).z,
    null,
    "29件は z を出さない",
  );
  assert.equal(
    diffOf(60, 50, S(18, 29, 5000, 10000)).direction,
    null,
    "29件は向きを言わない",
  );
}

/** 元の verify の1つの塊 { } を割った 2/2 */
function scene5() {
  // s1-day は件数だけ（割合・ポイント差・90日との比べを書かない）
  const m = JSON.parse(
    gunzipSync(readFileSync(new URL("2026-10-19-19-10.json.gz", FX))).toString(
      "utf8",
    ),
  );
  const day = buildAll(m)
    .find((x) => x.id === "scene1")
    .data.steps.find((st) => st.id === "s1-day");
  assert.ok(day, "前提: s1-day がある");
  assert.equal(day.facts.direction, null);
  assert.ok(
    day.lines.join("").includes("1着") &&
      !/%|90日|高い|低い/.test(day.lines.join("")),
    `s1-day は件数だけ: ${day.lines.join(" / ")}`,
  );
  // 順位（最多）: 1位が2位より多ければ言う（7 対 6 も）。同数は言わない。z は参考値
  assert.deepEqual(rankOf(7, 6), { rankZ: 0.28, rankSig: true });
  assert.equal(rankOf(30, 10).rankSig, true);
  assert.equal(rankOf(6, 6).rankSig, false, "同数は最多と言わない");
  assert.equal(rankOf(5, 0).rankSig, true, "2位が無ければ言い切ってよい");
  const sonar = {
    kind: "sonar",
    n: 20,
    top: { boat: 1, count: 7, pct: 35 },
    next: { boat: 2, count: 6 },
    ...rankOf(7, 6),
  };
  assert.deepEqual(
    checkLines(
      ["類似レース20件で1着最多は1号艇", "7件（35%）、次は2号艇の6件"],
      sonar,
      null,
    ).filter((w) => w.includes("順位を言い切った")),
    [],
    "7 対 6 で「最多」は言える",
  );
  const tied = {
    kind: "sonar",
    n: 20,
    top: { boat: 1, count: 6, pct: 30 },
    next: { boat: 2, count: 6 },
    ...rankOf(6, 6),
  };
  assert.ok(
    checkLines(
      ["類似レース20件で1着最多は1号艇", "6件（30%）、次は2号艇の6件"],
      tied,
      null,
    ).some((w) => w.includes("順位を言い切った")),
    "同数で「最多」は止まる",
  );
  for (const st of buildAll(m).flatMap((x) => x.data.steps ?? [])) {
    if (st.facts?.rankSig === false)
      assert.ok(
        !/最多|最高/.test(st.lines.join("")),
        `${st.id}: 同数の順位で最多と言わない: ${st.lines.join(" / ")}`,
      );
  }
}

function scene6() {
  {
    scene4();
    scene5();
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・readFileSync・gunzipSync・FX） */
export function runFullPictureScene2A16(env) {
  ({ buildAll, readFileSync, gunzipSync, FX } = env);
  scene6();
}
