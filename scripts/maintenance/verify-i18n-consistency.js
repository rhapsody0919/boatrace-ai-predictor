#!/usr/bin/env node
/**
 * verify-i18n-consistency.js — 4言語のロケールが構造として揃っているかを機械検査する。
 *
 * ## なぜ機械検査にするか
 *
 * `src/locales/{ja,en,zh-TW,ko}/common.json` は2026-08-15以降のfixコミットで
 * 最も触られている領域（4ファイル合計51件）で、次の型の不具合が実際に起きている。
 *
 * - ja にだけキーを足して他言語へ展開し忘れる
 *   （「レース詳細タブのja専用i18nキー37件をen/zh-TW/koへ展開する」）
 * - 単位や語尾を文言側に書き込み、値がNULLのときに `—%` のような表示になる
 *   （2026-09-25、phase a Phase 5 で発生。プレースホルダの置き方の問題）
 *
 * どちらも「4言語を同時に正しく書く」という注意力に頼っており、1つ抜けても
 * その言語の画面を開くまで誰も気づかない。ja だけ見て通してしまう。
 *
 * ## 何を検査するか
 *
 * 1. キーの集合が4言語で一致すること（i18next の複数形サフィックスは考慮する）
 * 2. プレースホルダ `{{name}}` の集合が ja と各言語で一致すること
 *    （ja にある値が他言語で落ちていると、その言語だけ値が消えた文言になる）
 * 3. 値が空文字でないこと（キーだけ作って中身を入れ忘れた状態）
 *
 * 2026-09-25時点で1〜3とも違反ゼロ。この状態を保つための検査であって、
 * 既存の違反を洗い出すためのものではない。
 *
 * ## 検査しないこと（意図的）
 *
 * - 訳文の質・用語の統一は見ない（`docs/reference/i18n-glossary.md` の領分で、
 *   機械では判定できない）
 * - 日本語の中黒「・」が en/ko に残っている問題（2026-09-25時点で61件）は
 *   対象外。区切り記号として定着しており、機械的に置き換えると文が壊れる。
 *   文言レビューが要るため別課題とする
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const BASE_LANG = "ja";
const LANGS = ["ja", "en", "zh-TW", "ko"];

/**
 * i18next の複数形サフィックス。言語ごとに必要な形が違う
 * （英語は one/other、日本語・韓国語・中国語は other のみ）ため、
 * キーの集合を比べるときは落として比べる。
 */
const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

const PLACEHOLDER = /{{\s*([\w.]+)\s*}}/g;

function flatten(obj, prefix = "", out = {}) {
  for (const [key, value] of Object.entries(obj)) {
    const full = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flatten(value, full, out);
    } else {
      out[full] = value;
    }
  }
  return out;
}

function baseKey(key) {
  return key.replace(PLURAL_SUFFIX, "");
}

function placeholdersOf(value) {
  if (typeof value !== "string") return new Set();
  return new Set([...value.matchAll(PLACEHOLDER)].map((m) => m[1]));
}

function sameSet(a, b) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}

const locales = {};
for (const lang of LANGS) {
  const file = path.join(repoRoot, "src/locales", lang, "common.json");
  locales[lang] = flatten(JSON.parse(readFileSync(file, "utf8")));
}

const failures = [];
let checked = 0;

// 1. キーの集合（複数形サフィックスを落として比較する）
const baseKeys = Object.fromEntries(
  LANGS.map((l) => [l, new Set(Object.keys(locales[l]).map(baseKey))]),
);
for (const lang of LANGS.filter((l) => l !== BASE_LANG)) {
  checked += 1;
  const missing = [...baseKeys[BASE_LANG]].filter(
    (k) => !baseKeys[lang].has(k),
  );
  const extra = [...baseKeys[lang]].filter((k) => !baseKeys[BASE_LANG].has(k));
  if (missing.length > 0) {
    failures.push(
      `${lang}: ${BASE_LANG} にあるキーが ${missing.length} 件ありません → ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? " ..." : ""}`,
    );
  }
  if (extra.length > 0) {
    failures.push(
      `${lang}: ${BASE_LANG} に無いキーが ${extra.length} 件あります（消し忘れの可能性）→ ${extra.slice(0, 5).join(", ")}${extra.length > 5 ? " ..." : ""}`,
    );
  }
}

// 2. プレースホルダの集合
for (const lang of LANGS.filter((l) => l !== BASE_LANG)) {
  checked += 1;
  const mismatched = [];
  for (const [key, value] of Object.entries(locales[BASE_LANG])) {
    const other = locales[lang][key];
    if (other === undefined) continue; // 1. で報告済み
    const a = placeholdersOf(value);
    const b = placeholdersOf(other);
    if (!sameSet(a, b)) {
      mismatched.push(
        `${key}（${BASE_LANG}: ${[...a].join(",") || "なし"} / ${lang}: ${[...b].join(",") || "なし"}）`,
      );
    }
  }
  if (mismatched.length > 0) {
    failures.push(
      `${lang}: プレースホルダが一致しないキーが ${mismatched.length} 件 → ${mismatched.slice(0, 3).join(" / ")}${mismatched.length > 3 ? " ..." : ""}`,
    );
  }
}

// 3. 全言語で空の値（キーだけ作って中身を入れていない）
//
// 一部の言語だけ空なのは正当なので検知しない。実際に次の3件があり、いずれも意図的:
//   ja  home.jstNote                        非ja言語にだけ " JST" を付ける設計
//   ja  pitReport.originalLanguageNote      日本語話者に「原文は日本語」と断る必要がない
//   zh-TW volatilityAccuracy.summarySuffix  prefixが「…機率為」で終わり、数値の後に続く語が要らない
checked += 1;
const allEmpty = Object.keys(locales[BASE_LANG]).filter((key) =>
  LANGS.every((lang) => {
    const value = locales[lang][key];
    return typeof value === "string" && value.trim() === "";
  }),
);
if (allEmpty.length > 0) {
  failures.push(
    `全言語で値が空のキーが ${allEmpty.length} 件あります（キーだけ作って中身が入っていない）→ ${allEmpty.slice(0, 5).join(", ")}`,
  );
}

if (failures.length > 0) {
  console.error("NG: 4言語のロケールが揃っていません");
  for (const f of failures) console.error(`  - ${f}`);
  console.error("");
  console.error(
    "  新しい文言は4言語すべてに同じキーで追加してください（.claude/CLAUDE.md「多言語化の3区分」）。",
  );
  console.error(
    "  単位や語尾は文言側に書き込まず、値がNULLのときに `—%` のような表示にならないようにしてください。",
  );
  process.exit(1);
}

const keyCount = baseKeys[BASE_LANG].size;
console.log(
  `OK: 4言語のロケールが揃っている（${keyCount}キー × ${LANGS.length}言語、検査${checked}項目）`,
);
