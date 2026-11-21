/**
 * verify-full-picture-scene2.js の後半の場面（6/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { f01Script, f01RacerCheck } from "../../../sns-video-studio/remotion/scripts/full-picture/f01.mjs";
import { racersOf, emWidth, RIGHT, layoutRight, NB, boatToday } from "../../../sns-video-studio/remotion/src/fullPicture/f01Right.js";
import { F01_SHORT_NAMES } from "./full-picture-scene2-a-9.js";
import { runFullPictureScene2A21 } from "./full-picture-scene2-a-10.js";
import { f01Fixture, F01_LONG_NAMES } from "./full-picture-scene2-c-2.js";

let R, readFileSync, gunzipSync, FX, fixtures;

/** 元の verify の1つの塊 { } を割った 1/4 */
function scene1() {
  for (const name of [
    "2026-10-12-01-12",
    "2026-10-15-15-10",
    "2026-10-16-24-11",
    "2026-10-19-19-10",
  ]) {
    const mf = f01Fixture(name);
    const s = f01Script(mf);
    const { racers } = racersOf(mf);
    assert.deepEqual(
      f01RacerCheck(s, racers),
      [],
      `${name}: 名前と級が出走表と一致し、6字の名前でも右の列に収まる`,
    );
    let named = 0;
    for (const id of ["open", "c1", "c2", "c3", "c4", "c5"]) {
      const c = s.chapters.find((x) => x.id === id);
      if (!c) continue;
      const texts = c.open
        ? c.open.bars.map((b) => `${b.boat}号艇${NB}${b.name}${NB}${b.grade}`)
        : [c.scope, c.answer, c.answer2].filter(Boolean);
      const boats = texts.join(" ").match(/\d号艇/g) ?? [];
      named += boats.length;
      // 今日の6艇の属性（c1・c5・冒頭の棒）は「N号艇 名前 級」、過去の集計（c2〜c4）は「N号艇（今日は名前 級）」
      const form = (b) =>
        ["c2", "c3", "c4"].includes(id)
          ? `${b}（今日は${racers[b[0]].name}${NB}${racers[b[0]].grade}）`
          : `${b}${NB}${racers[b[0]].name}${NB}${racers[b[0]].grade}`;
      for (const b of boats)
        assert.ok(
          texts.join(" ").includes(form(b)),
          `${name} ${id}: ${b}の隣に名前と級`,
        );
      // 範囲の行に名前を入れない（集計が個人の成績に読まれる。x-channel P0 #2079）
      for (const r of Object.values(racers))
        assert.ok(
          !(c.scope ?? "").includes(r.name),
          `${name} ${id}: 範囲の行に名前`,
        );
      // 行ごとの幅（見積りは Noto Sans JP の実測以上。2026-11-01 に Chromium で 10 種を測って確かめた）
      if (c.right)
        for (const k of ["scope", "answer", "answer2"])
          for (const l of c.right[k].lines)
            assert.ok(
              emWidth(l) * c.right[k].size <= RIGHT.w,
              `${name} ${id}: 「${l}」が幅を越える`,
            );
    }
    assert.ok(
      named >= 3,
      `${name}: 右の列に名前と級の付いた艇が出る（${named}）`,
    );
    // 声は艇番だけ（名前は読まない）
    for (const c of s.chapters)
      for (const n of F01_LONG_NAMES)
        assert.ok(!c.voice.includes(n), `${name} ${c.id}: 声に名前`);
  }
}

/** 元の verify の1つの塊 { } を割った 2/4 */
function scene2() {
  // 短い名前（2〜3字）でも、艇と、その艇の数字を別の行に分けない（行末が級・行頭が数字だと、数字が次の艇のものに読める。/code-review #2079）
  for (const name of [
    "2026-10-12-01-12",
    "2026-10-15-15-10",
    "2026-10-16-24-11",
    "2026-10-19-19-10",
  ]) {
    const ms = f01Fixture(name, F01_SHORT_NAMES);
    const s = f01Script(ms);
    assert.deepEqual(f01RacerCheck(s, racersOf(ms).racers), [], name);
    for (const c of s.chapters.filter((x) => x.right?.ok))
      for (const k of ["answer2"])
        for (const l of c.right[k].lines)
          assert.ok(
            !/^[\d,.]+(件|項目|%)(・|$)/.test(l),
            `${name} ${c.id} ${k}: 「${l}」が数字から始まる（前の行の艇の数字が落ちた）`,
          );
  }
  // 艇と数字の組（例: c3 の2着の3艇）は、どの名前の長さでも同じ行
  {
    const lines = layoutRight({
      answer2: `2着${NB}2号艇${NB}西村${NB}A1${NB}1,041件・3号艇${NB}山田${NB}A1${NB}30件・4号艇${NB}佐藤${NB}A1${NB}20件`,
      path: "p",
    }).answer2.lines;
    assert.ok(
      lines.every((l) =>
        /号艇\u00a0[^\u00a0]+\u00a0[AB][12]\u00a0[\d,]+件$/.test(l),
      ),
      JSON.stringify(lines),
    );
  }
  // 出走表の読み方（艇番の対応、名前の空白を詰める、級が A1〜B2 でなければ欠け）
  {
    const r = racersOf({
      raceId: "x",
      api: {
        races: [
          {
            raceId: "x",
            entries: [
              { number: 2, name: "篠崎　　仁志", grade: "A1" },
              { number: 1, name: "梶原　　　正", grade: "B1" },
              { number: 3, name: "西村 拓也", grade: "x" },
            ],
          },
        ],
      },
    });
    assert.deepEqual(r.racers, {
      1: { name: "梶原正", grade: "B1" },
      2: { name: "篠崎仁志", grade: "A1" },
    });
    assert.deepEqual(r.missing, [3, 4, 5, 6]);
  }
  const mf = f01Fixture("2026-10-19-19-10");
  const s = f01Script(mf);
  const { racers } = racersOf(mf);
  // 範囲の行に名前を入れたら落とす。過去の集計の形「（今日は名前 級）」も出走表と照合する
  assert.ok(
    f01RacerCheck(
      {
        chapters: [
          {
            id: "c4",
            scope: `丸亀の全期間 3号艇${NB}${racers[3].name}${NB}${racers[3].grade}が1着`,
            answer: `軸 3号艇（今日は${racers[3].name}${NB}${racers[3].grade}）`,
            right: { ok: true, minFontPx: 32 },
          },
        ],
      },
      racers,
    ).some((w) => w.includes("範囲の行に選手名")),
  );
  return { s, racers };
}

/** 元の verify の1つの塊 { } を割った 3/4 */
function scene3({ s, racers }) {
  assert.ok(
    f01RacerCheck(
      {
        chapters: [
          {
            id: "c4",
            answer: `軸 3号艇（今日は別人${NB}A1）`,
            right: { ok: true, minFontPx: 32 },
          },
        ],
      },
      racers,
    ).some((w) => w.includes("出走表")),
  );
  // 出走表と違う名前・級は落とす
  assert.ok(
    f01RacerCheck(s, {
      ...racers,
      1: { ...racers[1], grade: racers[1].grade === "A1" ? "A2" : "A1" },
    }).some((w) => w.includes("出走表")),
    "級の違いを落とす",
  );
  assert.ok(
    f01RacerCheck(s, { ...racers, 1: { ...racers[1], name: "別人" } }).some(
      (w) => w.includes("出走表"),
    ),
    "名前の違いを落とす",
  );
  // 艇番だけ（名前と級が隣に無い）を落とす
  const bare = {
    chapters: [
      {
        id: "c2",
        scope: "x",
        answer: "1着 1号艇 322件",
        right: layoutRight({ answer: "1着 1号艇 322件", path: "p" }),
      },
    ],
  };
  assert.ok(
    f01RacerCheck(bare, racers).some((w) => w.includes("名前と級が無い")),
    "艇番だけを落とす",
  );
  // 欠けたら作らない（黙って空にしない）
  for (const drop of [{ grade: null }, { name: "" }, { grade: "C1" }]) {
    const m2 = f01Fixture("2026-10-19-19-10");
    const race = m2.api.races.find((r) => r.raceId === m2.raceId);
    Object.assign(race.entries[2], drop);
    const r2 = f01Script(m2);
    assert.equal(r2.ok, false, JSON.stringify(drop));
    assert.equal(r2.kind, "racer_name_grade");
    assert.ok(r2.reason.includes("3号艇"));
  }
  // 右の列: 収まらなければ字を縮め、縮めても下の線を越えたら ok=false（その章は検査で落ちる）
  const six = [1, 2, 3, 4, 5, 6]
    .map((b) => `${b}号艇${NB}${F01_LONG_NAMES[b - 1]}${NB}A1`)
    .join("・");
  const lo = layoutRight({
    tag: "龍神ソナー ＞ 差がつく材料",
    scope: "今日の6艇・5項目",
    answer: `${six}\nそれぞれ 2項目`,
    answer2: "5項目のうち2位以内に入った数",
    path: "p",
  });
  assert.ok(
    !lo.ok || lo.answer.size < 64,
    "6艇が並ぶと字を縮めるか、収まらない",
  );
  const huge = layoutRight({
    answer: `${six}・${six}`,
    answer2: six,
    path: "p",
  });
  assert.equal(huge.ok, false, "下の線を越えたら収まらない");
  assert.ok(
    f01RacerCheck(
      { chapters: [{ id: "c1", answer: "x", right: huge }] },
      racers,
    ).some((w) => w.includes("右の列が収まらない")),
  );
}

/** 元の verify の1つの塊 { } を割った 4/4 */
function scene4() {
  // 名前と級の塊は折り返さない（「品川二千翔」と「A1」が別の行に分かれない）
  const one = layoutRight({
    answer: `2着 1号艇${NB}${F01_LONG_NAMES[0]}${NB}A1 41.9%`,
    path: "p",
  });
  assert.ok(
    one.ok &&
      one.answer.lines.some((l) =>
        l.includes(`1号艇${NB}${F01_LONG_NAMES[0]}${NB}A1`),
      ),
  );
  // 本番の c4 の形（艇と割合の間も折り返さない空白）。名前5字＋割合が小数1桁の「2着 1号艇（今日は吉田凌太朗 A1） 38.5%」は
  // 最小の字（40px）でも1行が幅を越えた（2026-11-03 の 19-10、type_unsupported:f01_check）。割合の前で折れば収まる
  const racers19 = {
    1: { name: "吉田凌太朗", grade: "A1" },
    4: { name: "伊藤喜智", grade: "A2" },
  };
  const c4 = {
    tag: "思考アシスト ＞ 相手",
    scope: "下関の全期間・全選手 4号艇が1着 1,234件",
    path: "アシスト → 相手 → 軸",
    answer: `軸 ${boatToday(racers19, 4)}\n2着${NB}${boatToday(racers19, 1)}${NB}38.5%`,
    answer2: `軸 ${boatToday(racers19, 1)}なら\n2着${NB}${boatToday(racers19, 4)}${NB}38.5%`,
  };
  const lc4 = layoutRight(c4);
  assert.ok(lc4.ok, `${lc4.reason}`);
  assert.ok(
    lc4.wrapped && lc4.answer.lines.includes("38.5%"),
    "割合の前で折る",
  );
  assert.ok(
    lc4.answer.lines.every((l) => emWidth(l) * lc4.answer.size <= RIGHT.w),
  );
  // 収まる日の見た目は変えない（折らない）
  const short4 = layoutRight({
    ...c4,
    answer: `軸 ${boatToday(racers19, 4)}\n2着${NB}${boatToday(racers19, 4)}${NB}38.5%`,
  });
  assert.ok(short4.ok && !short4.wrapped);
}

async function scene5() {
  {
    scene1();
    const s2 = scene2();
    scene3(s2);
    scene4();
  }
  // ---- 後半の場面（verifyData/full-picture-scene2-a-10.js） ----
  await runFullPictureScene2A21({ R, readFileSync, gunzipSync, FX, fixtures, f01Fixture });
}

/** verify から呼ぶ入口。env は verify 側の束縛（R・readFileSync・gunzipSync・FX・fixtures） */
export async function runFullPictureScene2C14(env) {
  ({ R, readFileSync, gunzipSync, FX, fixtures } = env);
  await scene5();
}
