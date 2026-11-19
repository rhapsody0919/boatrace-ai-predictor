/**
 * verify-content-pr-gate.js の表 cases の一部（不規則な空白を含む件の後ろ 1/4）。大きさの関所のため、本文を字のまま移した。verify ではない。
 * 不規則な空白を含む件は verify に残し、並びは verify の cases で元のままに組む。
 */
import {
  JPEG,
  MD,
  baseJson,
  baseMd,
  enc,
} from "./content-pr-gate-fixtures.js";
import {
  revision,
} from "./content-pr-gate-cases-1.js";

/** cases の不規則な空白を含む件の後ろ（1/4） */
export const CASES_B1 = [
  [
    "改稿で、触っていない行と変えた行にまたがる句も段落で落ちる",
    revision({
      baseMdText: `${baseMd}\n必ず\n古い行\n`,
      headMdText: `${baseMd}\n必ず\n当たる\n`,
    }),
    /\[judgement\].*必ず当たる/,
  ],
  [
    "改稿で、句の無い段落だけを変えたなら別の段落の句は見ない",
    revision({
      baseMdText: `${baseMd}\n必ず当たる（古い文）\n\n古い行\n`,
      headMdText: `${baseMd}\n必ず当たる（古い文）\n\n新しい行\n`,
    }),
    "ok",
  ],
  // ---- P2-2: 回収率の見落とし
  ...[
    ["コンマ区切り", "回収率1,343%"],
    ["逆の語順", "120%の回収率"],
    ["パーセント", "回収率120パーセント"],
    ["間が7字以上", "回収率がなんと驚異の150%"],
    ["半角と全角の混ざり", "回収率１2０%"],
    ["倍", "回収率 1.5倍"],
  ].map(([name, text]) => [
    `回収率の${name}（${text}）は落ちる`,
    { md: `${baseMd}\n${text}\n` },
    /\[judgement\].*回収率/,
  ]),
  [
    "回収率が 100% 未満・1倍未満・漢数字は通る",
    {
      md: `${baseMd}\n回収率85%、回収率0.8倍、回収率は百二十パーセント\n`,
    },
    "ok",
  ],
  // ---- 3feff1cc1 の再審査 P2-1: オッズや別の数を回収率の主張として拾わない
  ...[
    ["文の区切りをまたぐ", "回収率が低い。オッズは1.2倍"],
    ["倍の逆の語順", "オッズ2.0倍の回収率85%"],
    ["倍の逆の語順（数だけ）", "単勝1.5倍で回収率"],
    ["1倍を切る", "回収率は1倍を切る"],
    ["1倍未満", "回収率1倍未満"],
    ["100%以下", "回収率100%以下"],
    ["150%を下回る", "回収率が150%を下回る"],
    ["× と =", "的中率60% × オッズ1.3倍 = 回収率78%"],
    ["箇条をまたぐ", "- 回収率が高い\n- オッズ3倍以上を狙う"],
    [
      "表の列をまたぐ",
      "| 点数 | 必要オッズ | 回収率の傾向 |\n|---|---|---|\n| 3点 | 30倍以上 | ⭐高回収率 |",
    ],
    ["表の見出しをまたぐ", "| 会場 | 100%超え | 最高回収率 | おすすめ |"],
    ["空白で隣り合う数（P3-3）", "回収率 R1 150%"],
  ].map(([name, text]) => [
    `回収率の主張ではない（${name}）は通る`,
    { md: `${baseMd}\n${text}\n` },
    "ok",
  ]),
  [
    "回収率が2倍は落ちる（倍は回収率の後4字まで）",
    { md: `${baseMd}\n回収率が2倍になった\n` },
    /\[judgement\].*回収率が2倍/,
  ],
  [
    "回収率は120%は落ちる",
    { md: `${baseMd}\n回収率は120%\n` },
    /\[judgement\].*回収率は120%/,
  ],
  // ---- P3-1: 今ある行の複製は、増えた分を足した行とみなす
  [
    "改稿で、今ある「必ず当たる」の行を複製すると落ちる",
    revision({
      baseMdText: `${baseMd}\n必ず当たる\n`,
      headMdText: `${baseMd}\n必ず当たる\n\n必ず当たる\n`,
    }),
    /\[judgement\].*必ず当たる/,
  ],
  [
    "判断が要る語を申告していても落ちる",
    {
      md: `${baseMd}\n的中率の話\n`,
      manifest: (m) => ({ ...m, judgement_words: ["的中率"] }),
    },
    /\[judgement\].*judgement_words が空でない/,
  ],
  [
    "語が無くても judgement_words が空でなければ落ちる",
    { manifest: (m) => ({ ...m, judgement_words: ["保証"] }) },
    /\[judgement\].*judgement_words が空でない/,
  ],
  // slug
  [
    "id がファイル名と違うと落ちる",
    { json: { ...baseJson, id: "other" } },
    /\[slug\].*ファイル名/,
  ],
  [
    "id の形が違うと落ちる（大文字）",
    { json: { ...baseJson, id: "Sample-guide" } },
    /\[slug\].*形でない/,
  ],
  ["base の .md と衝突すると落ちる", { basePaths: [MD] }, /\[slug\].*衝突/],
  // 画像
  [
    "参照する画像が HEAD に無いと落ちる",
    { md: `${baseMd}\n![x](/images/blog/missing.jpg)\n` },
    /\[image\].*missing\.jpg.*HEAD に無い/,
  ],
  [
    "JPEG のヘッダーが読めないと落ちる",
    { img: enc("not a jpeg") },
    /\[image\].*幅と高さ/,
  ],
  [
    "足した画像をどこも参照しないと落ちる",
    {
      md: baseMd.replace("![図](/images/blog/sample-guide-ja.jpg)", ""),
      json: { ...baseJson, image: "/images/blog/existing.jpg" },
      head: (h) => ({ ...h, "public/images/blog/existing.jpg": JPEG }),
    },
    /\[image\].*参照していない/,
  ],
  // featured
  [
    "新規で featured=true は落ちる",
    { json: { ...baseJson, featured: true } },
    /\[featured\].*featured=false/,
  ],
  [
    "新規で featuredRank があると落ちる",
    { json: { ...baseJson, featuredRank: 3 } },
    /\[featured\].*featuredRank/,
  ],
];
