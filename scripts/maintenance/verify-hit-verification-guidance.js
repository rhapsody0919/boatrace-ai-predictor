#!/usr/bin/env node
/**
 * 「毎回の的中/不的中はどこで見られるか」の案内が、実際に的中判定を描く
 * コンポーネントと食い違っていないかを見る（BOA-454のセルフレビュー指摘）。
 *
 * 何が起きたか: 展開予測の答え合わせは BOA-346 で `RaceResult`（結果タブ）から
 * `RaceAiPredictionTab`（AI予想タブ）へ移設されたのに、それを案内する
 * About・FAQ・使い方ガイドの3か所が「結果」タブのまま残っていた。移設から
 * 2週間近く、79%という数字の裏付け導線が存在しない場所を指していた。
 *
 * 同型の取り残しはこのリポジトリで繰り返し出ている（旧モデル言及が67記事に
 * 残っていた件、モデル刷新後も `/about` の紹介動画が古いままだった件）。
 * 機能を動かしたときに文章が追随しないのが共通の原因で、どれも
 * 「本文をgrepしただけでは気づけない」形で残る。
 *
 * 見るのは2つ。
 * 1. 的中判定を描いているのはどのタブか（TurnPatternList を持つのはどちらか）
 * 2. 案内の文がそのタブ名を書いているか
 *
 * 1を先に見るので、将来また移設したときは「案内が違う」ではなく
 * 「移設先が変わったので案内も直せ」と言える。文字列同士の突き合わせだけの
 * 検査にはしない。
 */
import { readFileSync } from "node:fs";

const AI_TAB = "src/components/race/RaceAiPredictionTab.jsx";
const RESULT_TAB = "src/components/race/RaceResult.jsx";

/** 的中/不的中の確認場所を案内しているファイル */
const GUIDANCE_FILES = [
  "src/pages/About.jsx",
  "src/pages/FAQ.jsx",
  "src/pages/HowToUse.jsx",
];

/** この語を含む文は「どこで的中を確認できるか」の案内とみなす */
const GUIDANCE_MARKER = "的中";

/** 案内の対象を絞る語。これが無い「的中率」だけの文は対象外 */
const REQUIRES_LOCATION = "確認";

const read = (path) => readFileSync(path, "utf8");

const errors = [];

// 1. 的中判定（展開予測の答え合わせ）を描いているのはどちらのタブか
const aiRendersVerdict = read(AI_TAB).includes("TurnPatternList");
const resultRendersVerdict = read(RESULT_TAB).includes("TurnPatternList");

if (!aiRendersVerdict || resultRendersVerdict) {
  errors.push(
    [
      "展開予測の的中判定の置き場所が、このスクリプトの前提と違う。",
      `  ${AI_TAB}: TurnPatternList ${aiRendersVerdict ? "あり" : "なし"}`,
      `  ${RESULT_TAB}: TurnPatternList ${resultRendersVerdict ? "あり" : "なし"}`,
      "  移設したなら、下の案内文とこのスクリプトの期待タブ名を一緒に直すこと。",
    ].join("\n"),
  );
}

// 2. 案内の文が、そのタブ名を書いているか
const expectedTab = resultRendersVerdict ? "結果" : "AI予想";
const wrongTab = expectedTab === "AI予想" ? "結果" : "AI予想";

for (const file of GUIDANCE_FILES) {
  const source = read(file);
  // JSXは要素をまたいで改行するため、行単位ではなく句点で区切る
  const sentences = source
    .split(/[。\n]/)
    .map((s) => s.replace(/\s+/g, ""))
    .filter(
      (s) => s.includes(GUIDANCE_MARKER) && s.includes(REQUIRES_LOCATION),
    );

  for (const sentence of sentences) {
    // タブ名に言及していない案内（/hit-races・/accuracy への導線など）は対象外
    const mentionsTab = sentence.includes("タブ");
    if (!mentionsTab) continue;
    if (sentence.includes(`「${wrongTab}」タブ`)) {
      errors.push(
        [
          `${file}: 的中の確認場所を「${wrongTab}」タブと案内しているが、`,
          `  実際に判定を描いているのは「${expectedTab}」タブ。`,
          `  該当: ${sentence.slice(0, 80)}`,
        ].join("\n"),
      );
    }
  }
}

if (errors.length > 0) {
  console.error("的中確認の案内が実装と食い違っている:\n");
  for (const error of errors) console.error(`${error}\n`);
  process.exit(1);
}

console.log(
  `OK: 的中確認の案内は「${expectedTab}」タブを指している（${GUIDANCE_FILES.length}ファイル）`,
);
