/**
 * verify-full-picture-scene2.js の後半の場面（9/10）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { s02Facts, s02Text, s02Check } from "../../../sns-video-studio/remotion/scripts/full-picture/s02.mjs";
import { f01Script, f01Check, VOICE } from "../../../sns-video-studio/remotion/scripts/full-picture/f01.mjs";
import { NB } from "../../../sns-video-studio/remotion/src/fullPicture/f01Right.js";
import { diffOf } from "../../../sns-video-studio/remotion/scripts/full-picture/scenes/diff.mjs";
import { checkLines } from "../../../sns-video-studio/remotion/scripts/full-picture/scene2-text.mjs";

let buildAll, readFileSync, gunzipSync, FX, f01Fixture;

export const F01_SHORT_NAMES = ["堤昇", "齋藤勇", "西村", "山田", "佐藤", "鈴木"];

function scene1() {
  // #1973 Codex P1・hq facts.py（2026-10-27）の再現
  {
    // P1-1: 有意の判定は丸める前の件数・率で（700件中431勝・基準58.1%は生で z≈1.86、62%に丸めると2.09）
    const raw = diffOf(62, 58.1, {
      a: (431 / 700) * 100,
      na: 700,
      b: 58.1,
      nb: 100000,
    });
    assert.equal(
      raw.z,
      1.86,
      `z は丸める前の率で出す（z=${raw.z}）。線は使わないので向きは言う`,
    );
    // P1-2: 差の小さい結論の文も字幕の幅（全角22字）に収める（709件・1号艇359・2号艇350）
    const m = JSON.parse(
      gunzipSync(readFileSync(new URL("2026-10-19-19-10.json.gz", FX))).toString(
        "utf8",
      ),
    );
    m.api.scenario.scenario.cells.waku.forms.any = {
      n: 709,
      tri: { "1-2-3": 359, "2-1-3": 350 },
    };
    const d4 = buildAll(m).find((x) => x.id === "scene4").data;
    for (const c of [d4.conclusionAny, d4.conclusion].filter(Boolean)) {
      if (c.facts.rankSig === false)
        assert.ok(!/最多/.test(c.lines.join("")), c.lines.join(" / "));
      assert.deepEqual(
        checkLines(c.lines, c.facts, null).filter((w) => /幅|字/.test(w)),
        [],
        `結論の文が幅に収まる: ${c.lines.join(" / ")}`,
      );
    }
    assert.equal(
      d4.conclusionAny.facts.rankSig,
      true,
      "359 対 350 も1位が多いので最多と言う（線は使わない）",
    );
    // 30件未満の母数に割合を付けない（hq: s4-course-flow「15件の66.7%」）
    const m2 = JSON.parse(
      gunzipSync(readFileSync(new URL("2026-10-19-19-10.json.gz", FX))).toString(
        "utf8",
      ),
    );
    m2.api.scenario.scenario.cells.waku.forms.flat = {
      n: 15,
      tri: { "1-2-3": 10, "2-1-3": 3, "3-1-2": 2 },
    };
    m2.api.scenario.scenario.cells.waku.forms.any =
      m2.api.scenario.scenario.cells.waku.forms.flat;
    for (const st of buildAll(m2).flatMap((x) => [
      ...(x.data.steps ?? []),
      ...(x.data.conclusion ? [x.data.conclusion] : []),
    ])) {
      if ((st.facts?.n ?? 99) < 30 && /flow|tri|conclusion/.test(st.id))
        assert.ok(
          !/%/.test(st.lines.join("")),
          `${st.id}: 30件未満に割合: ${st.lines.join(" / ")}`,
        );
    }
    // 軸の文「1着なら2着は◯号艇」も2着の1位と2位の差が線を通ったときだけ
    for (const st of buildAll(m)
      .find((x) => x.id === "scene5")
      .data.steps.filter(
        (x) => x.facts?.kind === "followers" && x.lines.length,
      )) {
      if (st.facts.rankSig === false)
        assert.ok(
          !/2着は\d号艇/.test(st.lines.join("")),
          `${st.id}: ${st.lines.join(" / ")}`,
        );
    }
  }
}

function scene2() {
  // 型 s02-loss-breakdown-card（関門の段4）: 10/26 大村10R の実数で数字・文・検査
  {
    const tri = {
      "1-2-3": 150,
      "2-1-3": 24,
      "3-1-2": 14,
      "4-1-2": 17,
      "5-1-2": 6,
      "6-1-2": 1,
    };
    const sc = {
      cells: { waku: { forms: { any: { n: 212, tri } } } },
      period: ["2019-04-01", "2026-10-25"],
    };
    const f = s02Facts(sc);
    assert.deepEqual([f.n, f.k, f.m, f.p], [212, 150, 62, 70.8]);
    assert.deepEqual(
      f.by.map((x) => x.count),
      [24, 14, 17, 6, 1],
      "艇番の順（順位で並べない）",
    );
    const tx = s02Text(f, {
      race: "大村10R 準優勝戦",
      date: "10/26",
      deadline: "19:36",
      url: "https://www.boat-ai.jp/race/2026-10-26-24-10",
    });
    assert.deepEqual(
      tx.card.lines,
      ["過去の1号艇の1着は約7割", "負けた62件、勝ったのは？"],
      "冒頭は結論から",
    );
    assert.equal(
      f.top,
      2,
      "24 対 17 は1位が多いので強調する（線は使わない。2026-11-01）",
    );
    assert.ok(
      tx.xText.includes(
        "過去212件中（2019/4/1〜2026/10/25）、1号艇の1着は150件（70.8%）",
      ),
      tx.xText,
    );
    assert.ok(tx.xText.includes("その62件で、勝ったのは何号艇？"));
    assert.deepEqual(s02Check(f, tx, 39.5), []);
    assert.ok(s02Check(f, tx, 59.5).some((w) => w.includes("59秒")));
    assert.ok(
      s02Check(
        f,
        { ...tx, shortsTitle: tx.shortsTitle + " 最多は2号艇" },
        39.5,
      ).some((w) => w.includes("順位の語")),
    );
    assert.equal(
      s02Facts({ cells: { waku: { forms: { any: { n: 29, tri: {} } } } } }).kind,
      "thin_data",
      "30件未満は作らない",
    );
    assert.equal(
      s02Facts({ cells: { waku: { forms: { any: { n: 213, tri } } } } }).kind,
      "count_mismatch",
      "件数と3連単の和が合わない日は作らない",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・readFileSync・gunzipSync・FX） */
export function runFullPictureScene2A17(env) {
  ({ buildAll, readFileSync, gunzipSync, FX } = env);
  scene1();
  scene2();
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・readFileSync・gunzipSync・FX） */
export function runFullPictureScene2A18(env) {
  ({ buildAll, readFileSync, gunzipSync, FX } = env);

}

/** 元の verify の1つの塊 { } を割った 1/2 */
async function scene3() {
  const { bakedDeadlineReasons } = await import("../../sns/push-full-picture.js");
  const { THUMB, thumbSize } =
    await import("../../../sns-video-studio/remotion/scripts/full-picture/f01.mjs");
  const mf = f01Fixture("2026-10-19-19-10", [
    "大久保信一郎",
    "齋藤勇",
    "西村",
    "山田",
    "佐藤",
    "鈴木",
  ]);
  const s = f01Script(mf);
  assert.ok(s.ok, s.reason);
  const k = Math.round((s.open.k0 / s.open.n0) * 10);
  const g1 = mf.api.facts.today.classes[0];
  assert.match(
    s.title,
    new RegExp(
      `^ボートレース\\S+ \\d+R( \\S+)? 10/19\\(月\\) 3日目 締切16:44｜1号艇 大久保信一郎${g1}は逃げ切れる？ 同じ並びの1着${k}割$`,
    ),
    s.title,
  );
  assert.ok(
    [...s.title].length <= 100,
    `題は100字以内（${[...s.title].length}字）`,
  );
  // push の照合（BOA-1201）: 題に焼いた締切が今の締切と合えば通り、変われば止まる
  assert.deepEqual(
    bakedDeadlineReasons(
      { youtube_full: { title: s.title } },
      "2026-10-19T07:44:00.000Z",
    ),
    [],
  );
  assert.equal(
    bakedDeadlineReasons(
      { youtube_full: { title: s.title } },
      "2026-10-19T07:50:00.000Z",
    ).length,
    1,
    "締切が変われば止める",
  );
  const open = s.chapters.find((c) => c.id === "open").open;
  assert.ok(open.head.endsWith("10/19(月)  3日目  締切16:44"), open.head);
  assert.equal(s.thumb.deadline, "締切16:44");
  assert.ok(
    s.thumb.head.endsWith(" 10/19(月) 3日目") && !s.thumb.head.includes("締切"),
    s.thumb.head,
  );
  assert.deepEqual(
    s.thumb.lines.map((l) => l.text),
    [`大久保信一郎${NB}${g1}`, "逃げ切れる？"],
  );
  assert.equal(
    s.thumb.foot,
    `同じ並び 過去${s.open.n0.toLocaleString("ja-JP")}回\u30001号艇の1着`,
  );
  assert.equal(s.thumb.number, `${k}割`);
  // 11月の出走表で最長の6字の名前は字を詰めない。9字を越える行は詰め、線（THUMB.min）を下回る行は検査で止める
  assert.equal(
    s.thumb.lines[0].size,
    THUMB.big,
    "6字の名前＋級は 116px のまま",
  );
  assert.ok(
    thumbSize("壱壱壱壱壱壱壱壱壱壱 A1") < THUMB.big &&
      thumbSize("壱壱壱壱壱壱壱壱壱壱 A1") >= THUMB.min,
    "10字の名前は詰めて収める",
  );
  return { thumbSize, s };
}

/** 元の verify の1つの塊 { } を割った 2/2 */
async function scene4({ thumbSize, s }) {
  const why = f01Check(
    {
      ...s,
      thumb: {
        ...s.thumb,
        lines: [{ text: "壱".repeat(14), size: thumbSize("壱".repeat(14)) }],
      },
    },
    { desc: VOICE.credit, kana: {}, shots: {} },
  );
  assert.ok(
    why.some((w) => /サムネ: 「壱+」が \d+px（線 80px）/.test(w)),
    "収まらない名前は止める",
  );
  assert.ok(
    f01Check(
      { ...s, title: "あ".repeat(101) },
      { desc: VOICE.credit, kana: {}, shots: {} },
    ).some((w) => /題が101字/.test(w)),
    "題の上限 100 字",
  );
  // 上の帯が右上の締切の札に重なるときは止める（声と撮影の前に buildF01 でも当てる純関数）
  const { f01TitleThumbCheck } =
    await import("../../../sns-video-studio/remotion/scripts/full-picture/f01.mjs");
  assert.deepEqual(f01TitleThumbCheck(s), []);
  assert.ok(
    f01TitleThumbCheck({ thumb: { ...s.thumb, head: "あ".repeat(24) } }).some(
      (w) => /締切の札に重なる/.test(w),
    ),
  );
  // 締切の無い材料は作らない
  const m2 = f01Fixture("2026-10-19-19-10");
  m2.race = { ...m2.race, startTime: null };
  assert.equal(f01Script(m2).kind, "deadline");
  // 禁止表現: 題・サムネの文に当たらない
  assert.deepEqual(
    f01Check(s, { desc: VOICE.credit, kana: {}, shots: {} }).filter((w) =>
      /^(題|サムネ):/.test(w),
    ),
    [],
  );
}

async function scene5() {
  {
    const s1 = await scene3();
    await scene4(s1);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll・readFileSync・gunzipSync・FX・f01Fixture） */
export async function runFullPictureScene2A19(env) {
  ({ buildAll, readFileSync, gunzipSync, FX, f01Fixture } = env);
  await scene5();
}
