/**
 * verify-full-picture-scene2.js の後半の場面（10/10）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { f01Script, f01Description, f01Check, VOICE } from "../../../sns-video-studio/remotion/scripts/full-picture/f01.mjs";
import { seriesTitleOf } from "../../../src/utils/raceSeriesText.js";

const R = "../../../sns-video-studio/remotion"; // 動的 import の道の頭（verify の R と同じ所を verifyData から見た道）
let readFileSync, gunzipSync, FX, fixtures, f01Fixture;

/** 元の verify の1つの塊 { } を割った 1/3 */
async function scene1() {
  const { SERIES_LINE, f01TitleThumbCheck } =
    await import("../../../sns-video-studio/remotion/scripts/full-picture/f01.mjs");
  const NAMES = ["大久保信一郎", "齋藤勇", "西村", "山田", "佐藤", "鈴木"];
  const make = (race) => {
    const mf = f01Fixture("2026-10-19-19-10", NAMES);
    mf.race = { ...mf.race, ...race };
    return mf;
  };
  // 部品で作った文（実の大会名の形）
  const LONG_N = seriesTitleOf({
    grade: "SG",
    raceTitle: "第１４回クイーンズクライマックス／Ｇ３ＱＣシリーズ",
  });
   // 2025-11〜2026-11 の SG・G1 で最長（25字）
  assert.equal(LONG_N, "第14回クイーンズクライマックス/G3QCシリーズ");
  // 一般戦: 日目だけ（大会名は足さない）
  const gen = f01Script(
    make({ grade: "ippan", seriesDayText: "4日目", raceTitle: null }),
  );
  assert.ok(gen.ok, gen.reason);
  assert.ok(
    gen.title.startsWith(
      "ボートレース下関 10R 準優勝戦 10/19(月) 4日目 締切16:44｜",
    ),
    gen.title,
  );
  assert.equal(gen.thumb.series, null);
  assert.equal(gen.thumb.head, "下関10R 準優勝戦 10/19(月) 4日目");
  assert.equal(
    gen.chapters.find((c) => c.id === "open").open.head,
    "下関10R 準優勝戦  10/19(月)  4日目  締切16:44",
  );
  assert.equal(
    f01Description(gen, "0:00 冒頭\n").split("\n")[3],
    "ボートレース下関 10R 準優勝戦 10/19(月) 4日目 締切16:44",
    "説明欄の4行目は題の頭と同じ",
  );
  assert.ok(
    f01Script(make({ seriesDayText: "最終日" })).title.includes(
      " 10/19(月) 最終日 締切16:44｜",
    ),
  );
  // 欠けたら作らない（締切と同じ）: 日目が無い（/1 の材料も）・SG/G1 なのに大会名が無い
  assert.equal(f01Script(make({ seriesDayText: null })).kind, "series_day");
  {
    const v1 = f01Fixture("2026-10-19-19-10", NAMES);
    delete v1.race.seriesDayText;
    assert.equal(
      f01Script(v1).kind,
      "series_day",
      "/1 の材料（日目なし）は作らない",
    );
  }
  assert.equal(
    f01Script(make({ grade: "G1", raceTitle: null })).kind,
    "series_title",
  );
  {
    const mt = make({ grade: null, raceTitle: null });
    mt.missing = [
      ...(mt.missing ?? []),
      {
        source: "race.raceTitle",
        reason:
          "SG なのに大会名が無い（race_conditions.race_title も race_series.title も無い）",
      },
    ];
    assert.equal(
      f01Script(mt).kind,
      "series_title",
      "取得が SG・G1 と判定して大会名が無いと残したら止める",
    );
  }
  return { SERIES_LINE, f01TitleThumbCheck, make, LONG_N };
}

/** 元の verify の1つの塊 { } を割った 2/3 */
function scene2({ SERIES_LINE, f01TitleThumbCheck, make, LONG_N }) {
  assert.ok(
    f01Script(make({ grade: null, raceTitle: null })).ok,
    "グレード不明で大会名が無い日は大会名なしで作る（部品は節のグレードでも大会名を足す）",
  );
  // SG・長い大会名: 題・サムネ・冒頭・説明欄に入る。25字はサムネ・冒頭とも 32px のまま
  const sg = f01Script(
    make({ grade: "SG", seriesDayText: "3日目", raceTitle: LONG_N }),
  );
  assert.ok(sg.ok, sg.reason);
  assert.ok(
    sg.title.startsWith(
      `ボートレース下関 ${LONG_N} 10R 準優勝戦 10/19(月) 3日目 締切16:44｜`,
    ),
    sg.title,
  );
  assert.ok(sg.title.length <= 100, `${sg.title.length}字`);
  assert.deepEqual(sg.thumb.series, { text: LONG_N, size: SERIES_LINE.thumb });
  assert.deepEqual(sg.chapters.find((c) => c.id === "open").open.series, {
    text: LONG_N,
    size: SERIES_LINE.open,
  });
  assert.ok(f01Description(sg, "0:00 冒頭\n").split("\n")[3].includes(LONG_N));
  assert.deepEqual(f01TitleThumbCheck(sg), []);
  assert.deepEqual(
    f01Check(sg, {
      desc: f01Description(sg, "0:00 冒頭\n"),
      kana: {},
      shots: {},
    }).filter((w) => /^(題|サムネ|説明欄|open):/.test(w)),
    [],
    "禁止表現・大きさの検査を通る",
  );
  // 題が100字を越える日は題からだけ大会名を外す（サムネ・冒頭・説明欄には残す）
  const huge = "大".repeat(40);
  const hg = f01Script(make({ grade: "G1", raceTitle: huge }));
  assert.ok(
    hg.ok &&
      !hg.title.includes(huge) &&
      hg.title.length <= 100 &&
      hg.lead.includes(huge),
    hg.title,
  );
  // 大会名の行は締切の札と高さが重なるので、札の分を除いた幅で詰める
  const nearBadge = f01Script(
    make({ grade: "G1", raceTitle: "大".repeat(30) }),
  );
  assert.ok(
    nearBadge.thumb.series.size < SERIES_LINE.thumb &&
      nearBadge.thumb.series.size >= SERIES_LINE.min,
    `${nearBadge.thumb.series.size}px`,
  );
  assert.deepEqual(f01TitleThumbCheck(nearBadge), [], "詰めれば札に重ならない");
  assert.ok(
    f01TitleThumbCheck({
      ...nearBadge,
      thumb: {
        ...nearBadge.thumb,
        series: { ...nearBadge.thumb.series, size: 32 },
      },
    }).some((w) => /大会名「大+」が締切の札に重なる/.test(w)),
    "詰めずに札に重なるなら止める",
  );
  // 収まらない（詰めても 24px を下回る）なら止める（切って出さない）
  assert.ok(
    f01TitleThumbCheck(
      f01Script(make({ grade: "G1", raceTitle: "大".repeat(50) })),
    ).some((w) => /^サムネ: 大会名「大+」が \d+px（線 24px）/.test(w)),
    "サムネで止める",
  );
  return { f01TitleThumbCheck, make };
}

/** 元の verify の1つの塊 { } を割った 3/3 */
function scene3({ f01TitleThumbCheck, make }) {
  assert.ok(
    f01TitleThumbCheck(
      f01Script(make({ grade: "G1", raceTitle: "大".repeat(80) })),
    ).some((w) => /^open: 大会名/.test(w)),
    "冒頭で止める",
  );
  // 禁止表現: データ由来の大会名も検査に当たる
  assert.ok(
    f01Check(f01Script(make({ grade: "G1", raceTitle: "競艇王決定戦" })), {
      desc: VOICE.credit,
      kana: {},
      shots: {},
    }).some((w) => /^(題|サムネ|open):/.test(w)),
    "大会名の禁止表現も止める",
  );
}

async function scene4() {
  {
    const s1 = await scene1();
    const s2 = scene2(s1);
    scene3(s2);
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（readFileSync・gunzipSync・FX・fixtures・f01Fixture） */
export async function runFullPictureScene2A20(env) {
  ({ readFileSync, gunzipSync, FX, fixtures, f01Fixture } = env);
  await scene4();
}

async function scene5() {
  // ---- f01 の c12: 撮る画面の時点を材料にそろえる（2026-11-02、10-30 15場9R・11-01 4場10R で「5項目中」対「6項目中」）----
  // 出走表の段の facts の応答も status は exhibition_ready で exhibition は null。画面は既定で展示後になり、値の無い展示タイムの軸を
  // 数えた（n だけ +1、値の無い軸は2位以内に数えないので k は同じ）。撮影は材料の時点（pageStageOf）を押してから撮る
  {
    const { buildScene2 } = await import(
      `${R}/scripts/full-picture/scene2-data.mjs`
    );
    const { pageStageOf } = await import(
      `${R}/scripts/full-picture/f01-capture.mjs`
    );
    const { radarAxisItems, radarBoats, todayValues } =
      await import("../../../src/utils/analogyFacts.js");
    const m = JSON.parse(
      gunzipSync(readFileSync(new URL(fixtures[0], FX))).toString("utf8"),
    );
    const facts = m.api.facts?.data ?? m.api.facts;
    const resp = { ...facts, status: "exhibition_ready", exhibition: null };
    const s2 = buildScene2(resp);
    const site = (stage) => {
      const items = radarAxisItems(resp.today, stage === "exhibition");
      const boats = radarBoats(
        resp.today,
        resp.facts,
        todayValues(resp.today, resp.exhibition),
        items,
        1,
        null,
      );
      return { n: items.length, top2: boats.map((b) => b.top2) };
    };
    assert.equal(m.stage, "racecard");
    assert.equal(
      pageStageOf(m),
      "racecard",
      "材料が出走表なら画面も出走表で撮る",
    );
    assert.equal(pageStageOf({ stage: "exhibition" }), "exhibition");
    assert.equal(pageStageOf({}), "racecard", "時点の無い材料は出走表");
    const want = site(pageStageOf(m));
    assert.equal(
      want.n,
      s2.radar.axes.length,
      "撮る時点の画面の「N項目中」と f01 の項目の数が同じ",
    );
    assert.deepEqual(
      want.top2,
      s2.radar.boats.map((b) => b.top2),
      "「k 項目で2位以内」の k も同じ",
    );
    // 直す前（展示後のまま撮った）は n だけずれた
    const old = site("exhibition");
    assert.equal(
      old.n,
      s2.radar.axes.length + 1,
      "展示後の画面は値の無い展示タイムの軸を数える",
    );
    assert.deepEqual(old.top2, want.top2, "値の無い軸は k を変えない");
    // 展示後の材料なら展示タイムの軸が入り、画面（展示後）と同じ
    const ex = {
      ...resp,
      exhibition: { exh_time: [6.6, 6.7, 6.8, 6.75, 6.72, 6.81] },
    };
    const s2e = buildScene2(ex);
    assert.ok(s2e.radar.axes.some((a) => a.key === "exh_time"));
    assert.equal(
      radarAxisItems(ex.today, true).length,
      s2e.radar.axes.length,
      "展示後の材料は展示後の画面と同じ項目の数",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（readFileSync・gunzipSync・FX・fixtures・f01Fixture） */
export async function runFullPictureScene2A21(env) {
  ({ readFileSync, gunzipSync, FX, fixtures, f01Fixture } = env);
  await scene5();
}
