#!/usr/bin/env node
/**
 * BOA-1062: FR2 の公開文を通信・DB・時計なしで固定する。
 * 仕様: templates.js の JSDoc・コメント、plan.md 5節、ADR-0024、依頼113。
 * 以下の通常入力では仕様の値と指定土台 9b24d61f5 の値が一致する。
 * 空・欠落の扱いは仕様未定のため KNOWN_GAPS に出すだけで assert しない。
 */
import assert from "node:assert/strict";
import { generateGradeAnnouncementNews } from "../lib/racerNews/templates.js";

const cases = [
  {
    label: "2,000勝の定型文",
    input: { racerName: "山田太郎", branch: "東京", achievement: "2,000勝" },
    expected: {
      title: "山田太郎選手が2,000勝を達成",
      summary: "山田太郎選手（東京支部）が2,000勝を達成しました。",
    },
  },
  {
    label: "24場制覇の定型文",
    input: { racerName: "佐藤花子", branch: "大阪", achievement: "24場制覇" },
    expected: {
      title: "佐藤花子選手が24場制覇を達成",
      summary: "佐藤花子選手（大阪支部）が24場制覇を達成しました。",
    },
  },
  {
    label: "入力の空白・表記・記号を保持",
    input: {
      racerName: " 山田　太郎 ",
      branch: " 東京 ",
      achievement: " ２,０００勝（通算） ",
    },
    expected: {
      title: " 山田　太郎 選手が ２,０００勝（通算） を達成",
      summary:
        " 山田　太郎 選手（ 東京 支部）が ２,０００勝（通算） を達成しました。",
    },
  },
];

for (const { label, input, expected } of cases) {
  const actual = generateGradeAnnouncementNews(input);
  assert.deepEqual(
    Reflect.ownKeys(actual).sort(),
    ["summary", "title"],
    `${label}: 返却キーは2つだけ`,
  );
  assert.equal(actual.title, expected.title, `${label}: title`);
  assert.equal(actual.summary, expected.summary, `${label}: summary`);
  for (const key of ["title", "summary"]) {
    assert.equal(
      actual[key].includes("競艇"),
      false,
      `${label}: ${key}に禁止語を追加しない`,
    );
  }
}

// 入力由来の語も置換しない。公開用の推奨表現を定める試験ではない。
const literalInput = {
  racerName: "競艇太郎",
  branch: "東京",
  achievement: "競艇の記録",
};
assert.deepEqual(
  generateGradeAnnouncementNews(literalInput),
  {
    title: "競艇太郎選手が競艇の記録を達成",
    summary: "競艇太郎選手（東京支部）が競艇の記録を達成しました。",
  },
  "入力由来の語を言い換えない",
);

const normal = cases[0].input;
const KNOWN_GAPS = [
  {
    input: { ...normal, racerName: "" },
    spec: "未定: 空のracerNameの扱い",
    current: {
      title: "選手が2,000勝を達成",
      summary: "選手（東京支部）が2,000勝を達成しました。",
    },
  },
  {
    input: { ...normal, branch: "" },
    spec: "未定: 空のbranchの扱い",
    current: {
      title: "山田太郎選手が2,000勝を達成",
      summary: "山田太郎選手（支部）が2,000勝を達成しました。",
    },
  },
  {
    input: { ...normal, achievement: "" },
    spec: "未定: 空のachievementの扱い",
    current: {
      title: "山田太郎選手がを達成",
      summary: "山田太郎選手（東京支部）がを達成しました。",
    },
  },
  {
    input: { ...normal, racerName: undefined },
    spec: "未定: undefinedのracerNameの扱い",
    current: {
      title: "undefined選手が2,000勝を達成",
      summary: "undefined選手（東京支部）が2,000勝を達成しました。",
    },
  },
  {
    input: { ...normal, branch: undefined },
    spec: "未定: undefinedのbranchの扱い",
    current: {
      title: "山田太郎選手が2,000勝を達成",
      summary: "山田太郎選手（undefined支部）が2,000勝を達成しました。",
    },
  },
  {
    input: { ...normal, achievement: undefined },
    spec: "未定: undefinedのachievementの扱い",
    current: {
      title: "山田太郎選手がundefinedを達成",
      summary: "山田太郎選手（東京支部）がundefinedを達成しました。",
    },
  },
];
console.log(`KNOWN_GAPS: ${KNOWN_GAPS.length}件（assert対象外）`);
for (const gap of KNOWN_GAPS) {
  console.log(
    JSON.stringify(
      { ...gap, observed: generateGradeAnnouncementNews(gap.input) },
      (_key, value) => (value === undefined ? "[undefined]" : value),
    ),
  );
}
console.log("✅ verify-racer-news-templates: 検証通過");
