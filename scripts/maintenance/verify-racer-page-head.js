#!/usr/bin/env node
/**
 * 選手ページの title・description・canonical（src/pure/racerPageHead.js の racerPageMeta）が、人の画面と生の HTML の head で同じ文になること。
 *
 * 人の画面（RacerProfile.jsx）から src/pure へ移した組み方の振る舞いを、import して呼んだ値で固定する。
 * 1. プロフィールがあれば「{名}（競艇）選手の成績・勝率・決まり手」、名の空白は詰め、description に登録番号・支部・級
 * 2. 期別の要約が届くと title に勝率（2桁）、description に期の名前つきの勝率・2連率・優出・優勝を差し込む。2連率が無ければ省く
 * 3. プロフィールが無い（取得中・該当なし・失敗）と登録番号の title で、期別の要約は使わない（選手ごとに別の title のまま）
 * 4. canonical は選手の URL。表示名は空白を詰めた名、無ければ「選手」
 */
import assert from "node:assert/strict";
import { periodSentence, racerPageMeta } from "../../src/pure/racerPageHead.js";

const DATA = { profile: { name: "峰　　竜太", branch: "佐賀" }, grade: "A1" };
const SUMMARY = { label: "2026年前期", winRate: 8.3456, top2Rate: 62.04, periodFinals: 5, periodWins: 2 };

let failures = 0;
const check = (name, fn) => {
  try {
    fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}\n     ${error.message}`);
  }
};

check("1. プロフィールがあるときの title・description", () => {
  const m = racerPageMeta(DATA, "4320", null);
  assert.equal(m.title, "峰竜太（競艇）選手の成績・勝率・決まり手 | 龍神レーダー");
  assert.equal(
    m.description,
    "峰竜太選手（登録番号4320・佐賀支部・A1）の競艇（ボートレース）成績データ。全国勝率・当地勝率の推移、平均ST、会場別・枠番別成績、決まり手、直近のレース一覧とプロフィール。",
  );
  const noBranch = racerPageMeta({ profile: { name: "峰竜太" }, grade: null }, "4320", null);
  assert.ok(noBranch.description.startsWith("峰竜太選手（登録番号4320）の"));
});

check("2. 期別の要約を差し込む", () => {
  const m = racerPageMeta(DATA, "4320", SUMMARY);
  assert.equal(m.title, "峰竜太（競艇）選手の成績・勝率8.35・決まり手 | 龍神レーダー");
  assert.ok(
    m.description.includes("成績データ。2026年前期の勝率 8.35・2連率 62.0%・優出 5・優勝 2。全国勝率"),
    m.description,
  );
  assert.equal(periodSentence({ ...SUMMARY, top2Rate: null }), "2026年前期の勝率 8.35・優出 5・優勝 2。");
  assert.equal(periodSentence({ ...SUMMARY, winRate: null }), null);
  assert.equal(periodSentence(null), null);
  assert.deepEqual(racerPageMeta(DATA, "4320", { ...SUMMARY, winRate: null }), racerPageMeta(DATA, "4320", null));
});

check("3. プロフィールが無いと登録番号の title で、要約は使わない", () => {
  for (const data of [null, { profile: null, grade: "A1" }]) {
    const m = racerPageMeta(data, "5208", SUMMARY);
    assert.equal(m.title, "選手 登録番号5208 | 龍神レーダー");
    assert.equal(m.description, "登録番号5208の選手のページ | 龍神レーダー");
    assert.equal(m.displayName, "選手");
  }
});

check("4. canonical と表示名", () => {
  const m = racerPageMeta(DATA, "4320", SUMMARY);
  assert.equal(m.canonicalUrl, "https://www.boat-ai.jp/racer/4320");
  assert.equal(m.displayName, "峰竜太");
});

if (failures > 0) {
  console.error(`\n${failures} 件の失敗`);
  process.exit(1);
}
console.log("\nverify-racer-page-head: すべて通った");
