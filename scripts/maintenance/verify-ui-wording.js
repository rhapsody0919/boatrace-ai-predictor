/**
 * verify-ui-wording.js - 画面の文言（locales）の禁止語を試験にする（ZB03 ②、BOA-1455）。
 * ファイルを読むだけで、ネットワークにも DB にも接続しない。読むのは src/locales/ja/ の *.json だけ（JS・JSX の本文は読まない）。
 *
 * 決まり（正本はこの verify。旧 rules の code-pitfalls.md「言い方の規則」）:
 *   (a) 禁止語: 数える・似た・似ている・ふつう・いつも・似たレース（「類似レース」と書く）・必ず当たる・的中保証・鉄板
 *   (b) 龍神ソナー・思考アシストの置き場（キーに analogy・assist を含む値）では 集計・算出・対象 も使わない
 *   src/ の JS・JSX の文言（morningDigestCopy.js・thinkingAssistCopy.js 等）はここでは見ない（後で ESLint へ移す）。
 *
 * 判定: 当たった（ファイル, キー, 語）を (a)・(b) ごとに全体の件数で数える。
 *   - FROZEN より増えたら失敗。減ったら成功のまま「FROZEN を下げる」と出す
 * 起動のたびに純関数の自己試験（文字列だけを与える）を先に回し、落ちたら失敗にする。
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
// origin/master 5559fbe8c で数えた件数（2026-11-12）。(b) の1件は common.json aiPredictionTab.analogy.widened の「集計」。減らしたら下げる
const FROZEN = { banned: 0, sonar: 1 };
const BANNED = ["数える", "似た", "似ている", "ふつう", "いつも", "似たレース", "必ず当たる", "的中保証", "鉄板"];
const SONAR_EXTRA = ["集計", "算出", "対象"];
const SONAR_KEY = /analogy|assist/i;
const HOW_TO_FIX = {
  banned:
    "禁止語を言い換える（「似たレース」は「類似レース」、誇大・保証の表現は外す）。正本は verify-ui-wording.js",
  sonar: "ソナー・思考アシストの文言では 集計・算出・対象 を使わず言い換える。正本は verify-ui-wording.js",
};

const walk = (dir, ext) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => {
    const child = path.join(dir, d.name);
    if (d.isDirectory()) return walk(child, ext);
    return d.name.endsWith(ext) ? [child] : [];
  });

// 純関数: JSON の値 → [{key, value}]（文字列の葉だけ）
export const leaves = (node, key = "") => {
  if (typeof node === "string") return [{ key, value: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, `${key}[${i}]`));
  if (node && typeof node === "object")
    return Object.entries(node).flatMap(([k, v]) => leaves(v, key ? `${key}.${k}` : k));
  return [];
};

// 純関数: [{file, json}] → {banned: [...], sonar: [...]}（各 {file, key, word}）
export const findHits = (sources) => {
  const all = sources.flatMap(({ file, json }) => leaves(json).map((l) => ({ file, ...l })));
  const hit = (words, rows) =>
    rows.flatMap(({ file, key, value }) =>
      words.filter((w) => value.includes(w)).map((word) => ({ file, key, word })),
    );
  return {
    banned: hit(BANNED, all),
    sonar: hit(
      SONAR_EXTRA,
      all.filter(({ key }) => SONAR_KEY.test(key)),
    ),
  };
};

// 純関数: 当たりと凍結の数 → {ok, lines}
export const judge = (hits, frozen) => {
  const kinds = Object.keys(frozen);
  const over = kinds.filter((k) => hits[k].length > frozen[k]);
  if (over.length > 0) {
    return {
      ok: false,
      lines: [
        `verify-ui-wording: NG（${over.map((k) => `${k} ${hits[k].length} 件、凍結 ${frozen[k]} 件`).join("・")}）`,
        ...over.flatMap((k) => [
          ...hits[k].map(({ file, key, word }) => `  - ${k}: ${file} ${key}「${word}」`),
          `  直し方: ${HOW_TO_FIX[k]}`,
        ]),
      ],
    };
  }
  const lower = kinds
    .filter((k) => hits[k].length < frozen[k])
    .map((k) => `${k} が ${frozen[k] - hits[k].length} 件減ったので FROZEN.${k} を ${hits[k].length} に下げる`);
  const counts = kinds.map((k) => `${k} ${hits[k].length}/${frozen[k]}`).join("・");
  return { ok: true, lines: [`verify-ui-wording: OK（件数/凍結 ${counts}${lower.length ? `。${lower.join("・")}` : ""}）`] };
};

const selfTest = () => {
  const json = {
    top: { title: "似たレースを見る", ok: "類似レースを見る" },
    aiPredictionTab: { analogy: { note: "集計しています" } },
    other: { note: "集計しています", list: ["鉄板の1号艇"] },
  };
  const hits = findHits([{ file: "x.json", json }]);
  const checks = [
    ["禁止語を値から拾う（似た・似たレース・鉄板）", hits.banned.length === 3],
    ["集計・算出・対象は analogy・assist のキーでだけ拾う", hits.sonar.length === 1 && hits.sonar[0].key === "aiPredictionTab.analogy.note"],
    ["凍結より多いと失敗", judge(hits, { banned: 2, sonar: 1 }).ok === false],
    ["凍結と同じなら成功", judge(hits, { banned: 3, sonar: 1 }).ok === true],
    ["凍結より少ないと成功で下げるよう出す", judge(hits, { banned: 3, sonar: 2 }).lines[0].includes("下げる")],
  ];
  return checks.filter(([, pass]) => !pass).map(([name]) => name);
};

const main = () => {
  const broken = selfTest();
  if (broken.length > 0) {
    console.error(`verify-ui-wording: 自己試験が落ちた（${broken.join("・")}）`);
    process.exit(1);
  }
  const sources = walk(path.join(ROOT, "src", "locales", "ja"), ".json").map((abs) => ({
    file: path.relative(ROOT, abs),
    json: JSON.parse(fs.readFileSync(abs, "utf8")),
  }));
  const { ok, lines } = judge(findHits(sources), FROZEN);
  (ok ? console.log : console.error)(lines.join("\n"));
  if (!ok) process.exit(1);
};

// /tmp 等の symlink の下から起動しても main が走るよう、両方を realpath で比べる（走らないと無出力の偽の緑）
if (process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(fileURLToPath(import.meta.url))) main();
