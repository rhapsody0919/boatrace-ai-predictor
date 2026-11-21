/**
 * verify-full-picture-scene2.js の後半の場面（3/6）。verify ではない。
 * 判定と期待値は分ける前の verify-full-picture-scene2.js と同じ。check などは verify 側の物を受け取る（失敗の数は verify が数える）。
 */

import assert from "node:assert/strict";
import {
  f01Script,
  RANK_WORDS,
  SUB_MAX,
  f01Description,
  VOICE,
  f01Check,
  voiceText,
  splitSubs,
} from "../../../sns-video-studio/remotion/scripts/full-picture/f01.mjs";
import { f01Fixture } from "./full-picture-scene2-c-2.js";

let buildAll;

// 照合: 左の画面に右の列の数字が無ければ落とす。読みの辞書: 件がゲンと読まれたら落とす
const s0 = {
  chapters: [{ id: "c2", voice: "", subs: [], expect: ["313件"] }],
};

function scene1() {
  // 型 f01-landscape-voice-full（関門の段4の試作）: 順位の語は線を通ったときだけ・字幕の幅・声の読みの辞書・説明欄のクレジット・左の画面の照合
  for (const name of [
    "2026-10-12-01-12",
    "2026-10-15-15-10",
    "2026-10-16-24-11",
    "2026-10-19-19-10",
  ]) {
    const mf = f01Fixture(name);
    const s = f01Script(mf);
    assert.ok(s.ok, `${name}: ${s.reason}`);
    for (const c of s.chapters) {
      const sig = c.facts?.secRank?.rankSig || c.facts?.swap;
      if (RANK_WORDS.test(c.voice))
        assert.ok(sig, `${name} ${c.id}: 線を通らない順位の語: ${c.voice}`);
      for (const l of c.subs)
        assert.ok(
          l.length <= SUB_MAX + 2,
          `${name} ${c.id}: 字幕 ${l.length}字`,
        );
    }
    assert.equal(s.chapters[0].id, "open");
    assert.equal(
      s.chapters[0].subs.length,
      0,
      "冒頭は字幕を出さない（見本の「最も多く…次が」は線を通らない）",
    );
    const desc = f01Description(s, "0:00 冒頭\n");
    // 今の完全版の説明文の約束（1行目40字以内・2/3行目に機能への導線・URL の utm_term=full）
    assert.ok(
      desc.split("\n")[1].includes("tab=sonar") &&
        desc.split("\n")[2].includes("/assist?") &&
        desc.includes("utm_term=full"),
      desc,
    );
    assert.ok(desc.includes(VOICE.credit));
    assert.ok(
      f01Check(s, {
        desc: desc.replace(VOICE.credit, ""),
        kana: {},
        shots: {},
      }).some((w) => w.includes("VOICEVOX")),
      "クレジットが無ければ落とす",
    );
  }
  assert.equal(voiceText("313件・今節"), "313けん・こんせつ");
  assert.deepEqual(splitSubs("あ。い、う"), ["あ。", "い、う"]);
  assert.ok(
    f01Check(s0, {
      desc: VOICE.credit,
      kana: {},
      shots: { c2: { text: "1号艇 78% 31 3件" } },
    }).length === 0,
    "空白の違いは同じとみなす",
  );
  assert.ok(
    f01Check(s0, {
      desc: VOICE.credit,
      kana: {},
      shots: { c2: { text: "1号艇 78% 312件" } },
    }).some((w) => w.includes("313件")),
  );
  assert.ok(
    f01Check(
      { chapters: [] },
      {
        desc: VOICE.credit,
        kana: { "c2-1": "サンビャクジュウサン/ゲン" },
        shots: {},
      },
    ).some((w) => w.includes("ゲン")),
  );
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll） */
export function runFullPictureScene2C10(env) {
  ({ buildAll } = env);
  scene1();
}

function scene2() {
  // ②の1着の件数は画面と同じ数え方（1〜3着がそろった類似レースだけ）。着順の欠けたレースを数えると画面と食い違い、照合で止まった（10/30 児島10R 293 対 291）
  {
    const mf = f01Fixture("2026-10-19-19-10");
    const nb = mf.api.similar?.similar?.neighbors;
    if (nb?.length) {
      nb[0] = { ...nb[0], finish: [nb[0].finish?.[0] ?? 1] }; // 1着だけ分かっているレース
      const c2 = f01Script(mf).chapters.find((c) => c.id === "c2");
      const flow = buildAll(mf)
        .find((x) => x.id === "scene2b")
        .data.steps.find((x) => x.id === "s2b-flow-1");
      assert.ok(c2 && flow, "類似レースの章と着順の流れがある");
      assert.equal(
        c2.facts.counts.reduce((a, b) => a + b, 0),
        flow.page.n,
        "1着の件数の和は着順のそろった件数（画面の棒と同じ）",
      );
    }
  }
}

/** verify から呼ぶ入口。env は verify 側の束縛（buildAll） */
export function runFullPictureScene2C11(env) {
  ({ buildAll } = env);
  scene2();
}
