#!/usr/bin/env node
/**
 * verify-race-cancellation-usage.js — 開催中止の判定が、共通の関数を通らずに
 * 生の文字列比較で書かれていないかを機械検査する（BOA-418）。
 *
 * ## なぜ機械検査にするか
 *
 * `races.cancellation_status` は null / "tentative" / "confirmed" の3値を取るが、
 * 「中止として扱う」の実体は `=== "confirmed"` の1行で書けてしまう。その結果、
 * 中止レースを除外すべき場所ごとに独立して書かれ、書き忘れた場所だけが
 * 中止レースを混ぜたまま出し続ける。
 *
 * 2026-09-25時点で画面側に3箇所、同日のPR #824（イン崩れハイライトが中止レースを
 * 除外していない不具合）は中央化せずに4箇所目を足す形で直していた。同じ日に
 * イン崩れダイジェスト（scripts/daily/todays-volatility-digest.js）にも同種の
 * 不具合があると分かっていながら、BOA-418として未修正のまま残っていた。
 *
 * ADR-0069（取得エラーを既定で例外にし、verify-query-errors.js で検査する）と
 * 同じ形にして、散文のルールではなく検査で止める。
 *
 * ## 何を検査するか
 *
 * `src/` と `scripts/` の .js / .jsx で、`cancellationStatus`（または
 * `cancellation_status`）を文字列リテラルと `===` / `!==` で直接比較している箇所。
 * 見つかったら、共通関数（画面: src/utils/raceCancellation.js の isRaceCancelled、
 * バッチ: scripts/lib/cancellationStatus.js の isCancellationConfirmed）を
 * 使うよう促して失敗する。
 *
 * ## 検査しないこと（意図的）
 *
 * - SQL文字列の中の `cancellation_status = 'confirmed'` / `is distinct from 'confirmed'`
 *   は対象外。SQLからJSの関数は呼べない（dataHealth/functions.js 等に多数ある）
 * - Supabaseクエリの `.eq("cancellation_status", ...)` も対象外。第2引数に定数を
 *   渡す形が望ましいが、強制すると既存の多数の箇所に波及するため、今回は
 *   「JSの等価比較」だけに絞る
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CANCELLATION_CONFIRMED,
  CANCELLATION_TENTATIVE,
  isCancellationConfirmed,
} from "../lib/cancellationStatus.js";
import {
  isCancellationSuspected,
  isRaceCancelled,
} from "../../src/utils/raceCancellation.js";

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

const TARGET_DIRS = ["src", "scripts"];
const SKIP_DIRS = new Set(["node_modules", "dist", "__fixtures__", ".git"]);

/** 判定の定義そのものを置く場所。ここだけは文字列リテラルを持ってよい。 */
const ALLOWED_FILES = new Set([
  "src/utils/raceCancellation.js",
  "scripts/lib/cancellationStatus.js",
  "scripts/maintenance/verify-race-cancellation-usage.js",
]);

/**
 * 検証スクリプトは対象外。期待値は実装から独立に書く必要がある
 * （共通関数を使って書くと、その関数が壊れたときにテストも一緒に壊れて素通りする）。
 */
function isVerificationScript(relative) {
  return /(^|\/)verify-[^/]+\.js$/.test(relative);
}

/** `cancellationStatus === "confirmed"` のような、生の等価比較。 */
const RAW_COMPARISON =
  /cancellation[_s]?[sS]tatus\s*[!=]==\s*["'`]|["'`](?:confirmed|tentative)["'`]\s*[!=]==\s*\w*[cC]ancellation/;

function collectFiles(dir, acc) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return acc;
  }
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry)) continue;
    const full = path.join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isDirectory()) collectFiles(full, acc);
    else if (/\.(js|jsx)$/.test(entry)) acc.push(full);
  }
  return acc;
}

const files = TARGET_DIRS.flatMap((d) =>
  collectFiles(path.join(repoRoot, d), []),
);
const violations = [];

for (const file of files) {
  const relative = path.relative(repoRoot, file);
  if (ALLOWED_FILES.has(relative) || isVerificationScript(relative)) continue;
  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (RAW_COMPARISON.test(line)) {
      violations.push({ file: relative, line: i + 1, text: line.trim() });
    }
  });
}

// --- 判定そのものの検証 ---
// 静的検査だけだと、全員が共通関数を呼んでいても、その関数が誤っていれば
// 全箇所が一斉に誤る。画面側とバッチ側の2実装が同じ答えを返すことも確かめる。
const judgementFailures = [];
function expect(label, actual, expected) {
  if (actual !== expected) {
    judgementFailures.push(
      `${label}: 期待 ${JSON.stringify(expected)} / 実際 ${JSON.stringify(actual)}`,
    );
  }
}

expect("バッチ: 確定", isCancellationConfirmed(CANCELLATION_CONFIRMED), true);
expect(
  "バッチ: 疑いは中止扱いしない",
  isCancellationConfirmed(CANCELLATION_TENTATIVE),
  false,
);
expect("バッチ: null", isCancellationConfirmed(null), false);
expect("バッチ: undefined", isCancellationConfirmed(undefined), false);
expect("バッチ: 想定外の値", isCancellationConfirmed("CONFIRMED"), false);

expect(
  "画面: 確定",
  isRaceCancelled({ cancellationStatus: "confirmed" }),
  true,
);
expect(
  "画面: 疑いは中止扱いしない",
  isRaceCancelled({ cancellationStatus: "tentative" }),
  false,
);
expect("画面: 値なし", isRaceCancelled({ cancellationStatus: null }), false);
expect("画面: entityがnull", isRaceCancelled(null), false);
expect("画面: entityがundefined", isRaceCancelled(undefined), false);
expect(
  "画面: 疑いの判定",
  isCancellationSuspected({ cancellationStatus: "tentative" }),
  true,
);
expect(
  "画面: 確定は疑いではない",
  isCancellationSuspected({ cancellationStatus: "confirmed" }),
  false,
);

// 画面とバッチで状態名がズレたら、片方だけ中止を見落とす
expect(
  "画面とバッチで同じ状態名を見ている",
  isRaceCancelled({ cancellationStatus: CANCELLATION_CONFIRMED }),
  isCancellationConfirmed(CANCELLATION_CONFIRMED),
);

if (judgementFailures.length > 0) {
  console.error("NG: 開催中止の判定関数が期待どおりに動いていません");
  for (const f of judgementFailures) console.error(`  - ${f}`);
  process.exit(1);
}

if (violations.length > 0) {
  console.error(
    "NG: 開催中止の判定が、共通の関数を通らず生の文字列比較で書かれています",
  );
  for (const v of violations) {
    console.error(`  ${v.file}:${v.line}`);
    console.error(`    ${v.text}`);
  }
  console.error("");
  console.error(
    "  画面側は src/utils/raceCancellation.js の isRaceCancelled(entity) を、",
  );
  console.error(
    "  バッチ側は scripts/lib/cancellationStatus.js の isCancellationConfirmed(status) を使ってください。",
  );
  console.error(
    "  状態は null / tentative / confirmed の3値で、確定と疑いの区別を各所で書き分けると必ずズレます。",
  );
  process.exit(1);
}

console.log(
  `OK: 開催中止の判定（画面・バッチの関数13件）と、生の文字列比較なし（${files.length}ファイルを検査）`,
);
