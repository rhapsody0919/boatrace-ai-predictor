/**
 * verify-full-picture-scene2.js の後半の場面（4/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import { f01Check, VOICE } from "../../../sns-video-studio/remotion/scripts/full-picture/f01.mjs";

/** 元の verify の1つの塊 { } を割った 1/4 */
async function scene1() {
  const {
    f01SmallChapters,
    f01LayoutChapters,
    f01Timeline,
    MIN_FONT_PX,
    MIN_FONT_BY_CHAPTER,
    PLAN,
  } =
    await import("../../../sns-video-studio/remotion/scripts/full-picture/f01-build.mjs");
  const sh = (k, px, clip = { x: 0, y: 0, w: 400, h: 150 }) => ({
    file: `/x/${k}.png`,
    clip,
    scale: 2.8,
    minFontPx: px,
  });
  const s1 = {
    chapters: [{ id: "c2" }, { id: "c3" }, { id: "c4" }, { id: "c5" }],
  };
  const shots1 = {
    c2: sh("c2", 26.4),
    c3: sh("c3", MIN_FONT_BY_CHAPTER.c3 - 0.1),
    c4: sh("c4", 29.8),
    c4b: sh("c4b", 31.1, { x: 8, y: 0, w: 380, h: 170 }),
  };
  assert.deepEqual(
    f01SmallChapters(s1, shots1).map((x) => x.id),
    ["c3", "c5"],
    "線の下（c3）と撮れなかった章（c5）を省く",
  );
  assert.deepEqual(
    PLAN.c4.map((p) => p.k),
    ["c4", "c4b", "c4", "c42", "c42b"],
  );
  // オーナー 11/2「22.4px の章は2カットに分けて」: 線は 24px。着順の流れは押した後を上・下、形の札は図と名前の2カット
  assert.equal(MIN_FONT_PX, 24);
  // ②も 11/2 18-10 の形（1着の棒 → 着順の流れの全体の押す前・押した後）。上・下の2カットは座標の決め打ちだったので外した（docs/design/f01-stable-capture/）
  assert.deepEqual(
    PLAN.c2.map((p) => p.k),
    ["c2", "c2-pre", "c22"],
  );
  assert.equal(MIN_FONT_BY_CHAPTER.c2, 22);
  // ③は 11/2 18-10 の形（形の札1枚 → 着順の流れの全体）に戻した（オーナー 11/4。#2087 の2カットは 11/3 の4本で崩れた）。線は 22px
  assert.deepEqual(
    PLAN.c3.map((p) => p.k),
    ["c3", "c3-pre", "c32"],
  );
  assert.equal(MIN_FONT_BY_CHAPTER.c3, 22);
  assert.deepEqual(
    f01SmallChapters(
      { chapters: [{ id: "c3" }] },
      {
        c3: sh("c3", 22.4),
        "c3-pre": sh("c3-pre", 22.4),
        c32: sh("c32", 22.5),
      },
    ),
    [],
    "18-10 の③（22.4px）は線の上",
  );
  assert.deepEqual(
    f01SmallChapters(
      { chapters: [{ id: "c4" }] },
      { c4: sh("c4", 22.4), c4b: sh("c4b", 31.1) },
    ).map((x) => x.id),
    ["c4"],
    "③の例外はほかの章に効かない",
  );
  return { f01SmallChapters, f01LayoutChapters, f01Timeline, sh, shots1 };
}

/** 元の verify の1つの塊 { } を割った 2/4 */
function scene2({ f01SmallChapters, f01LayoutChapters, f01Timeline, sh, shots1 }) {
  // 左の画面の形の崩れ（11/3 の③の実測）: 札の図 38%×43%・名前と件数の帯 100%×18%・着順の流れの上だけ。18-10 の形は通る
  {
    const at = (k, w, h, extra = {}) => ({
      file: `/x/${k}.png`,
      clip: { x: 0, y: 0, w, h },
      scale: 1,
      minFontPx: 30,
      ...extra,
    });
    const W = 1136;
    const H = 838;
    const broken = {
      c3i: at("c3i", W * 0.38, H * 0.43),
      c3: at("c3", W, H * 0.18),
      "c3-pre": at("c3-pre", W, H * 0.72, { crop: "top" }),
      c32: at("c32", W, H * 0.72, { crop: "top" }),
    };
    const r = f01LayoutChapters({ chapters: [{ id: "c3" }] }, broken);
    assert.equal(r.length, 1);
    assert.ok(
      /c3 が左の枠の 100%×18%/.test(r[0].reason) &&
        /c3-pre は部品の上だけ/.test(r[0].reason),
      r[0].reason,
    );
    const ok = {
      c3: at("c3", W, H * 0.58),
      "c3-pre": at("c3-pre", W * 0.74, H),
      c32: at("c32", W * 0.74, H),
    };
    assert.deepEqual(
      f01LayoutChapters({ chapters: [{ id: "c3" }] }, ok),
      [],
      "18-10 の③は通る",
    );
    // 小さな図（右半分以上が空く）
    assert.equal(
      f01LayoutChapters(
        { chapters: [{ id: "c3" }] },
        { ...ok, c3: at("c3", W * 0.38, H * 0.43) },
      ).length,
      1,
      "札の図だけが小さいと止める",
    );
    // ②の着順の流れの全体（18-10 の形）・④・締め（100%×52%）は通る。部品の一部だけ（crop）は ② でも止める
    const c2 = {
      c2: at("c2", W, H * 0.73),
      "c2-pre": at("c2-pre", W * 0.74, H),
      c22: at("c22", W * 0.74, H),
    };
    assert.ok(
      /c22 は部品の上だけ/.test(
        f01LayoutChapters(
          { chapters: [{ id: "c2" }] },
          { ...c2, c22: at("c22", W, H * 0.72, { crop: "top" }) },
        )[0]?.reason ?? "",
      ),
      "②も部品の一部だけは止める",
    );
    // 同じ部品のいちばん小さい倍率で描く（f01Timeline）ので、その倍率で測る（自分の倍率では届いても、描くと小さい）
    const g2 = {
      c3: at("c3", 400, 120, { scale: 2.9 }),
      "c3-pre": at("c3-pre", 400, 130, { scale: 1.2 }),
      c32: at("c32", 400, 130, { scale: 2.9 }),
    };
    assert.ok(
      /c3 が左の枠の/.test(
        f01LayoutChapters({ chapters: [{ id: "c3" }] }, g2)[0]?.reason ?? "",
      ),
      "同じ部品の小さい倍率で測る",
    );
    assert.deepEqual(
      f01LayoutChapters(
        { chapters: [{ id: "c2" }, { id: "c4" }] },
        {
          ...c2,
          c4: at("c4", W, H * 0.52),
          c4b: at("c4b", W, H * 0.61),
          c42: at("c42", W, H * 0.52),
          c42b: at("c42b", W, H * 0.61),
        },
      ),
      [],
    );
  }
  return { f01SmallChapters, f01Timeline, sh, shots1 };
}

/** 元の verify の1つの塊 { } を割った 3/4 */
function scene3({ f01SmallChapters, f01Timeline, sh, shots1 }) {
  // 押す前のカットのカーソルは、撮影用の頁が返したそのカットの座標（押す1着の四角）を指す。
  // 撮る側の組（group）でそろえる倍率は、切り抜きの位置・大きさが違っても同じ組の中のいちばん小さい倍率
  {
    const full = { x: 0, y: 0, w: 440, h: 440 };
    const band = { x: 61, y: 300, w: 24, h: 90 };
    const shots3 = {
      c2: sh("c2", 26.4),
      "c2-pre": {
        ...sh("c2-pre", 22.5, full),
        cursor: band,
        group: "flow-similar",
        scale: 1.9,
      },
      c22: {
        ...sh("c22", 22.5, { ...full, h: 470 }),
        cursor: band,
        group: "flow-similar",
        scale: 1.78,
      },
    };
    const l3 = [
      "次に、類似レースのタブ。",
      "1号艇が勝った313件では、2着は2号艇が137件で最も多い。",
    ];
    const v3 = {
      lines: l3.map((sub, i) => ({
        chapter: "c2",
        i,
        sub,
        file: `w${i}.wav`,
        sec: 4,
      })),
    };
    const cuts3 = f01Timeline(
      { chapters: [{ id: "c2", name: "類似レース", subs: l3 }] },
      v3,
      shots3,
    ).props.chapters[0].cuts;
    const pre = cuts3.find((c) => c.file === "c2-pre.png");
    assert.ok(
      pre.cursor.y === band.y && pre.cursor.x === band.x,
      `カーソルが押す前のカットの中の1着の四角を指す（y=${pre.cursor.y}）`,
    );
    assert.deepEqual(
      cuts3.filter((c) => c.file !== "c2.png").map((c) => c.scale),
      [1.78, 1.78],
      "同じ組は同じ倍率",
    );
  }
  assert.deepEqual(
    f01SmallChapters(
      { chapters: [{ id: "c2" }] },
      {
        c2: sh("c2", 26.4),
        "c2-pre": sh("c2-pre", 22.5),
        c22: sh("c22", 22.4),
      },
    ),
    [],
    "18-10 の②（着順の流れ 22.4px）は線の上",
  );
  assert.deepEqual(
    f01SmallChapters(
      { chapters: [{ id: "c2" }] },
      {
        c2: sh("c2", 26.4),
        "c2-pre": sh("c2-pre", 22.5),
        c22: sh("c22", 21.9),
      },
    ).map((x) => x.id),
    ["c2"],
    "22px を下回る着順の流れは省く",
  );
  const lines = [
    "ここからは思考アシスト。",
    "軸を選ぶと、相手の割合が出る。",
    "大村で1号艇が1着の11,160件では、",
    "2着は2号艇が34.7%。",
    "軸を4号艇に変えると、1,375件で、",
    "2着は1号艇が37%に入れ替わる。",
  ];
  return { f01Timeline, sh, shots1, lines };
}

/** 元の verify の1つの塊 { } を割った 4/4 */
function scene4({ f01Timeline, sh, shots1, lines }) {
  const voice = {
    lines: lines.map((sub, i) => ({
      chapter: "c4",
      i,
      sub,
      file: `v${i}.wav`,
      sec: 2,
    })),
  };
  const shots2 = {
    ...shots1,
    c42: { ...sh("c42", 29.8), cursorFrom: { x: 1, y: 1, w: 10, h: 10 } },
    c42b: sh("c42b", 31.1, { x: 8, y: 0, w: 380, h: 170 }),
  };
  const { props } = f01Timeline(
    { chapters: [{ id: "c4", name: "相手", subs: lines }] },
    voice,
    shots2,
  );
  const cuts = props.chapters[0].cuts;
  assert.deepEqual(
    cuts.map((c) => c.file),
    ["c4.png", "c4b.png", "c4.png", "c42.png", "c42b.png"],
  );
  assert.ok(
    cuts.every((c, i) => i === 0 || c.from >= cuts[i - 1].from),
    "切り替えは時刻の順",
  );
  assert.ok(
    cuts[2].cursor && cuts[3].from === cuts[2].from + 15,
    "押す前の画面でカーソルを動かし、0.5秒後に押した後へ",
  );
  assert.equal(
    cuts[0].boxH,
    cuts[3].boxH,
    "同じ部品（軸のボタン）は同じ箱の高さ（切り替えで位置がずれない）",
  );
  // 章を省いても（声は voice.lines に残る）動画の時間の並びを作れる（Codex P1 #2075: audio.find が undefined で落ちた）
  const voice2 = {
    lines: [
      ...voice.lines,
      { chapter: "c3", i: 0, sub: "省いた章の声", file: "c3-0.wav", sec: 3 },
    ],
  };
  const r2 = f01Timeline(
    { chapters: [{ id: "c4", name: "相手", subs: lines }] },
    voice2,
    shots2,
  );
  assert.ok(
    r2.props.total > 0 && !r2.props.audio.some((x) => x.file === "c3-0.wav"),
    "省いた章の声は置かない",
  );
}

async function scene5() {
  {
    const s1 = await scene1();
    const s2 = scene2(s1);
    const s3 = scene3(s2);
    scene4(s3);
  }
  // 照合は桁区切りを比べない（画面「1,553件」・台本「1553件」で 11/01 14-10 が止まった）
  {
    const s4 = {
      chapters: [
        {
          id: "c3",
          voice: "",
          subs: [],
          expect: ["横一線"],
          expect2: ["1553件"],
        },
      ],
    };
    assert.deepEqual(
      f01Check(s4, {
        desc: VOICE.credit,
        kana: {},
        shots: { c3: { text: "横一線" }, c32: { text: "1 1,553件 2 512件" } },
      }),
      [],
    );
    const s5 = {
      chapters: [{ id: "c3", voice: "", subs: [], expect2: ["1,553件"] }],
    };
    assert.deepEqual(
      f01Check(s5, {
        desc: VOICE.credit,
        kana: {},
        shots: { c32: { text: "1553件" } },
      }),
      [],
    );
    assert.ok(
      f01Check(s5, {
        desc: VOICE.credit,
        kana: {},
        shots: { c32: { text: "1,552件" } },
      }).length === 1,
      "違う数は落とす",
    );
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（なし） */
export async function runFullPictureScene2C12() {
  await scene5();
}
