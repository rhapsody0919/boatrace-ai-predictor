#!/usr/bin/env node
/**
 * 会場ページ（/venue/N）の常設の要約2行と「この会場の特徴」カードの数字（BOA-1189 GS02-b）を固定する。DB・ネットワーク接続は不要。
 *
 * 守るもの:
 * 1. src/data/venueSummaryStats.js が、元の JSON（data/analysis/venue-summary-stats/venue-techniques.json）から
 *    build-venue-summary.mjs で作った値と一致する（手で直していない・元を更新して作り忘れていない）
 * 2. 24会場がそろい、期間は12か月の窓だけで、会場のレース数が1,000以上（読み物「最小件数」の目安）
 * 3. 割合は件数÷母数を1回だけ丸めた値。コースの1着回数の合計がレース数と一致する
 * 4. 全国と比べる向き（高い・低い）が入るのは、元の JSON の Bonferroni を通った会場だけ（別の経路の文字列と照合）
 * 5. 4言語・24会場の要約の文: 補間の残りが無い。全国と比べる文は向きのある会場だけ、ほかは「差ははっきりしない」。
 *    2行目に逃げの割合を入れない（1行目の1コース1着率と重ねない）。使わない言葉が無い
 *
 * 数字の更新（月1回）: docs/reference/venue-summary-stats.md「画面の数字の更新」
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import i18next from "i18next";
import {
  buildVenueSummaryStats,
  renderModule,
  SOURCE_PATH,
  OUTPUT_PATH,
} from "../analysis/venue-summary-stats/build-venue-summary.mjs";
import { VENUE_SUMMARY_STATS } from "../../src/data/venueSummaryStats.js";
import { venueSummaryLines } from "../../src/utils/venueSummary.js";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (p) => readFileSync(path.join(root, p), "utf8");

const failures = [];
let checked = 0;
function check(label, actual, expected) {
  checked += 1;
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    failures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

const source = JSON.parse(read(SOURCE_PATH));
const S = VENUE_SUMMARY_STATS;

// ---- 1. 生成物が元の JSON と一致 ----
check(
  `${OUTPUT_PATH} は ${SOURCE_PATH} から作った値と一致（作り直しは build-venue-summary.mjs）`,
  read(OUTPUT_PATH) === renderModule(buildVenueSummaryStats(source)),
  true,
);

// ---- 2. 24会場・12か月の窓・最小件数 ----
check("24会場", Object.keys(S.venues).length, 24);
check(
  "期間は12か月の窓",
  [S.from, S.to],
  [source.windows["12m"].from, source.windows["12m"].to],
);
for (const [code, v] of Object.entries(S.venues)) {
  check(`会場${code}: レース数が1,000以上`, v.races >= 1000, true);
}

// ---- 3. 割合は件数から1回だけ丸める。コースの1着の合計はレース数 ----
const pct = (count, total) => Math.round((count / total) * 1000) / 10;
for (const [label, b] of [["全国", S.national], ...Object.entries(S.venues)]) {
  check(
    `${label}: コースの1着の合計 = 進入コースが分かるレース数`,
    b.courses.reduce((a, c) => a + c.wins, 0),
    b.courseRaces,
  );
  // カードの「N レース中X回」は courseRaces、脚注は races。同じ「レース」の数として出すので一致を守る
  // （1着艇の進入コースが不明なレースが出たら、カードの文言を見直す）
  check(`${label}: 進入コースが分かるレース数 = レース数`, b.courseRaces, b.races);
  check(
    `${label}: コースの割合は件数から`,
    b.courses.map((c) => c.rate),
    b.courses.map((c) => pct(c.wins, b.courseRaces)),
  );
  const techCount = Object.values(b.techniques).reduce(
    (a, x) => a + x.count,
    0,
  );
  check(
    `${label}: 決まり手の回数の合計はレース数以下（6種以外の決まり手は分母に残る）`,
    techCount <= b.races && techCount >= b.races - 5,
    true,
  );
  check(
    `${label}: 決まり手の割合は件数から`,
    Object.values(b.techniques).map((x) => x.rate),
    Object.values(b.techniques).map((x) => pct(x.count, b.races)),
  );
}
// 若松の1コース（読み物の例文）。件数から出した値
check(
  "若松: 1コースの1着 1,407回／2,376レース",
  [S.venues[20].courses[0].wins, S.venues[20].races],
  [
    source.windows_detail["12m"].venues["20"].by_course[0].wins,
    source.windows_detail["12m"].venues["20"].races,
  ],
);

// ---- 4. 全国との向きは Bonferroni を通った会場だけ（元の JSON の文字列の一覧と照合） ----
const nameOf = (code) =>
  source.windows_detail["12m"].venues[String(code).padStart(2, "0")].name;
for (const [slug, key] of [
  ["course1", "course1"],
  ["makuri", "まくり"],
  ["makurizashi", "まくり差し"],
]) {
  const expected = Object.fromEntries(
    source.venue_difference[key].venues_beyond_national_bonferroni.map((s) => {
      const m = /^(.+?)([+-])[\d.]+$/.exec(s);
      return [m[1], m[2] === "+" ? "higher" : "lower"];
    }),
  );
  const actual = Object.fromEntries(
    Object.entries(S.venues)
      .filter(([, v]) => v.vsNational[slug])
      .map(([code, v]) => [nameOf(code), v.vsNational[slug]]),
  );
  check(
    `${key}: 全国との向きがある会場は Bonferroni の一覧と同じ`,
    Object.entries(actual).sort(),
    Object.entries(expected).sort(),
  );
}

// ---- 5. 4言語・24会場の要約の文 ----
const LANGS = ["ja", "en", "zh-TW", "ko"];
const COMPARE_WORDS = {
  ja: { higher: "より高い", lower: "より低い", unclear: "はっきりしない" },
  en: { higher: "higher than", lower: "lower than", unclear: "not clear" },
  "zh-TW": { higher: "高於", lower: "低於", unclear: "並不明確" },
  ko: { higher: "보다 높습니다", lower: "보다 낮습니다", unclear: "분명하지 않습니다" },
};
// 読み物「使わない言葉」（ja）。本文の「競艇」も入れない
const BANNED_JA = [
  "必ず",
  "確実",
  "鉄板",
  "当たる",
  "儲か",
  "狙い目",
  "有利",
  "不利",
  "荒れ",
  "差なし",
  "似た",
  "似て",
  "ふつう",
  "いつも",
  "数える",
  "競艇",
  "イン強い",
  "アウト強い",
  "勝率",
];
for (const lang of LANGS) {
  const res = JSON.parse(read(`src/locales/${lang}/common.json`));
  const jaRes = JSON.parse(read("src/locales/ja/common.json"));
  const inst = i18next.createInstance();
  await inst.init({
    lng: lang,
    fallbackLng: "ja",
    resources: { ja: { common: jaRes }, [lang]: { common: res } },
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
  });
  const t = inst.t.bind(inst);
  const words = COMPARE_WORDS[lang];
  const nige = t("techniques.nige");
  for (let code = 1; code <= 24; code += 1) {
    const lines = venueSummaryLines(t, code);
    const text = `${lines.course}\n${lines.techniques}`;
    check(
      `${lang} 会場${code}: 補間の残りが無い`,
      /\{\{|\}\}/.test(text),
      false,
    );
    check(
      `${lang} 会場${code}: 会場名が入る`,
      lines.course.includes(t(`venues.${code}`)),
      true,
    );
    const dir = S.venues[code].vsNational.course1 ?? "unclear";
    for (const [k, w] of Object.entries(words)) {
      check(
        `${lang} 会場${code}: 1行目の「${w}」は向き ${dir} のときだけ`,
        lines.course.includes(w),
        k === dir,
      );
    }
    check(
      `${lang} 会場${code}: 1行目に1コースの1着率と全国の値`,
      lines.course.includes(`${S.venues[code].courses[0].rate.toFixed(1)}%`) &&
        lines.course.includes(`${S.national.courses[0].rate.toFixed(1)}%`),
      true,
    );
    // 2行目に逃げの割合を入れない（「逃げ以外」の語は入る）
    check(
      `${lang} 会場${code}: 2行目に逃げの割合が無い`,
      lines.techniques.includes(
        `${nige}${lang === "ja" || lang === "zh-TW" ? "" : " "}${S.venues[code].techniques.nige.rate.toFixed(1)}%`,
      ),
      false,
    );
    // 決まり手の名前は用語集どおり techniques.*（en は "Makuri (Outside sweep)" の形）。表・もっと詳しくと同じ表記
    check(
      `${lang} 会場${code}: 2行目の決まり手は techniques.* の表記`,
      ["sashi", "makuri", "makurizashi", "nuki"].filter((k) =>
        lines.techniques.includes(t(`techniques.${k}`)),
      ).length,
      3,
    );
    check(
      `${lang} 会場${code}: 2行目は決まり手3つと、それぞれの全国の値（割合が6つ）`,
      (lines.techniques.match(/\d+\.\d%/g) ?? []).length,
      6,
    );
    // 「全国より多い／少ない」は、上位3つのうち Bonferroni を通った決まり手があるときだけ（オーナー決定 2026-11-01）
    {
      const v = S.venues[code];
      const listed = ["sashi", "makuri", "makurizashi", "nuki"]
        .sort((a, b) => v.techniques[b].count - v.techniques[a].count)
        .slice(0, 3);
      // 差が確かめられない決まり手は「はっきりしない」と書く（1つも無ければ「差がはっきりした決まり手は無い」）
      const flaggedCount = listed.filter((slug) => v.vsNational[slug]).length;
      check(
        `${lang} 会場${code}: 差が確かめられない決まり手を黙らない`,
        [
          lines.techniques.includes(t("venueSummary.techniquesNone")),
          lines.techniques.includes(t("venueSummary.techniquesRest")),
        ],
        [flaggedCount === 0, flaggedCount > 0 && flaggedCount < 3],
      );
      // 文の型から names を除いた固定の部分（「は全国より多い」等）。向きの無い会場に出ていないことを見る
      const stemOf = (dir) =>
        t(
          dir === "higher"
            ? "venueSummary.techniquesHigher"
            : "venueSummary.techniquesLower",
          { names: "\u0000" },
        )
          .split("\u0000")
          .sort((x, y) => y.length - x.length)[0];
      for (const dir of ["higher", "lower"]) {
        const expected = listed
          .filter((slug) => v.vsNational[slug] === dir)
          .map((slug) => t(`techniques.${slug}`));
        const phrase = t(
          dir === "higher"
            ? "venueSummary.techniquesHigher"
            : "venueSummary.techniquesLower",
          { names: expected.join(t("venueSummary.namesSeparator")) },
        );
        check(
          `${lang} 会場${code}: 2行目の「全国より${dir === "higher" ? "多い" : "少ない"}」は差が確かめられた決まり手だけ`,
          expected.length > 0
            ? lines.techniques.includes(phrase)
            : !lines.techniques.includes(stemOf(dir)),
          true,
        );
      }
    }
    if (lang === "ja") {
      check(
        `ja 会場${code}: 使わない言葉が無い`,
        BANNED_JA.filter((w) => text.includes(w)),
        [],
      );
    }
  }
}

if (failures.length > 0) {
  console.error(
    `❌ verify-venue-summary: ${failures.length}件失敗（${checked}件中）`,
  );
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`✅ verify-venue-summary: ${checked}件すべて通過`);
