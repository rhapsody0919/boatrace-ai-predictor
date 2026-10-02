#!/usr/bin/env node
/**
 * verify-query-errors.js — フロントエンドのSupabaseクエリで、取得失敗が
 * 「データなし」に化ける書き方が持ち込まれていないかを機械検査する（BOA-359）。
 *
 * ## なぜ機械検査にするか
 *
 * supabase-js は失敗を例外ではなく `{ data, error }` で返すため、
 * 「error を無視する」が最も短く書ける既定の書き方になっている。その結果、
 * 取得失敗が `[]` / `null` に化け、withCache が 30分〜7日 保存して、
 * リロードしても直らない誤表示として固着する事故が繰り返し起きた
 * （BOA-291 / 301 / 352 / 356 / 359 / 369 / 372。フロント・バッチ・監視・CIの4層）。
 *
 * 2026-09-23の実測では、supabaseDataService.js の91クエリのうち70件が握りつぶし、
 * 6件はerrorを参照すらしておらず、失敗の表現が11方言に分裂していた。
 * 同じ escape hatch（`throwOnError` フラグ）が8関数に独立して再発明されてもいた。
 * 「1つずつ直す」を選び続けた結果なので、散文のルールではなく機械検査で止める。
 *
 * ## 何を検査するか
 *
 * 1. `src/` 配下で `createClient(` を呼んでいるのが `src/services/supabaseClient.js`
 *    だけであること（他所でクライアントを作ると .throwOnError() の既定が効かない）
 * 2. `src/services/supabaseClient.js` が `.throwOnError()` を適用していること
 * 3. `src/` 配下に `@supabase/supabase-js` を直接importするファイルが
 *    supabaseClient.js 以外に無いこと
 * 4. `src/` 配下に `setError(err.message)` の形が無いこと（BOA-668）。message が空の例外
 *    （本文 `{}` の 5xx の PostgrestError）でエラー状態が偽のままになり、取得失敗が
 *    「データなし」に化ける。`src/utils/errorMessage.js` の errorMessageOf を使う
 *
 * ## 検査しないこと（意図的）
 *
 * - 呼び出し側の `if (error)` の有無は見ない。`.throwOnError()` が既定になった今、
 *   その分岐は到達しないだけで害が無く、機械的に消すとレビューのノイズになる
 *
 * ## バッチ側（scripts/）で検査すること（BOA-391）
 *
 * 5. `scripts/` の関数が `throwOnError = false` を引数の既定にしていないこと。
 *    fetchAll・getRaceSchedule 等の8関数が、失敗を空配列・部分結果にするのを既定にしていた
 *    （安全な挙動がオプトイン）。既定は例外にし、握りつぶしてよい呼び出し側だけが
 *    `{ throwOnError: false }` を理由付きで明示する
 * 6. `scripts/` で `throwOnError: false` を明示する行の直前（空行を除く1行上）に、
 *    `握りつぶし可（BOA-391）: <理由>` のコメントがあること。握りつぶしの明示を、
 *    書き方をそろえて一覧できる形にする（`grep -rn "握りつぶし可" scripts` で全件を引ける）
 * 7. `scripts/` で `.range()` を使う（自前でページングする）ファイルに、取得エラーを受けて
 *    ログだけ出して `break` / `return null` / `return []` / `return` で続行する書き方が無いこと。
 *    部分結果が「全件」に、失敗が「データなし」に化ける（2026-10-02 の棚卸しで本番経路に11箇所あった）。
 *    共通の fetchAll を使うか、例外にする
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const CLIENT_REL = "src/services/supabaseClient.js";

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, out);
    } else if (/\.(js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

const errors = [];
const files = walk(SRC);

// 1 & 3: クライアントの生成・importが単一の入口に閉じているか
for (const file of files) {
  const rel = path.relative(ROOT, file);
  if (rel === CLIENT_REL) continue;
  const text = fs.readFileSync(file, "utf8");

  if (/\bcreateClient\s*\(/.test(text)) {
    errors.push(
      `${rel}: createClient() を直接呼んでいる。${CLIENT_REL} の supabase を import すること` +
        "（直接作ると .throwOnError() の既定が効かず、取得失敗が空データに化ける。BOA-359）",
    );
  }
  // 4: message の有無でエラー状態を決めない（BOA-668）
  const messageOnly = text.match(/setError\(\s*\w+\??\.message\s*\)/g);
  if (messageOnly) {
    errors.push(
      `${rel}: ${messageOnly[0]} の形がある。message が空の例外で失敗がエラー表示に届かない。` +
        "src/utils/errorMessage.js の errorMessageOf(err) を使うこと（BOA-668）",
    );
  }
  if (/from\s+["']@supabase\/supabase-js["']/.test(text)) {
    errors.push(
      `${rel}: @supabase/supabase-js を直接importしている。${CLIENT_REL} 経由にすること（BOA-359）`,
    );
  }
}

// 2: 単一の入口が .throwOnError() を既定で適用しているか
const clientPath = path.join(ROOT, CLIENT_REL);
if (!fs.existsSync(clientPath)) {
  errors.push(`${CLIENT_REL} が見つからない`);
} else {
  const clientText = fs.readFileSync(clientPath, "utf8");
  if (!/\.throwOnError\(\)/.test(clientText)) {
    errors.push(
      `${CLIENT_REL}: .throwOnError() の適用が無い。取得失敗が例外にならず、空データに化ける（BOA-359）`,
    );
  }
  for (const method of ["from", "rpc"]) {
    if (!new RegExp(`client\\.${method}\\s*=`).test(clientText)) {
      errors.push(
        `${CLIENT_REL}: client.${method} のラップが無い。${method}() のエラーが例外にならない（BOA-359）`,
      );
    }
  }
}

// 5: バッチ側の関数が、失敗を握りつぶすことを既定にしていないか（BOA-391）
const scriptFiles = walk(path.join(ROOT, "scripts"));
for (const file of scriptFiles) {
  const rel = path.relative(ROOT, file);
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n");
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*)/.test(line)) return;
    // 検証スクリプトは、既定と opt-out の両方を試すために false を渡すので対象外
    const isVerify = /(^|\/)verify-[^/]*\.js$/.test(rel);
    if (!isVerify && /\bthrowOnError:\s*false\b/.test(line)) {
      // 6: 明示の opt-out には、直前の行に理由の印を付ける
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === "") j--;
      if (j < 0 || !lines[j].includes("握りつぶし可（BOA-391）:")) {
        errors.push(
          `${rel}:${i + 1}: throwOnError: false の直前に「// 握りつぶし可（BOA-391）: <理由>」のコメントが無い（BOA-391）`,
        );
      }
    }
    if (/\bthrowOnError\s*=\s*false\b/.test(line)) {
      errors.push(
        `${rel}:${i + 1}: 引数の既定が「失敗を握りつぶす」になっている（${line.trim()}）。` +
          "既定は例外にし、握りつぶしてよい呼び出し側だけが { throwOnError: false } を明示すること（BOA-391）",
      );
    }
  });
}

// 7: 自前のページングで、取得エラーをログだけにして続行していないか（BOA-391）
const SWALLOW_RE =
  /if \(\s*!?\w*[Ee]rror\w*\s*\)\s*\{\s*console\.(?:error|warn|log)\([^;]*\);\s*(?:break|return null|return \[\]|return)\s*;?\s*\}/g;
for (const file of scriptFiles) {
  const rel = path.relative(ROOT, file);
  if (/(^|\/)verify-[^/]*\.js$/.test(rel)) continue;
  const text = fs.readFileSync(file, "utf8");
  if (!text.includes(".range(")) continue;
  for (const m of text.matchAll(SWALLOW_RE)) {
    const line = text.slice(0, m.index).split("\n").length;
    errors.push(
      `${rel}:${line}: 取得エラーをログだけにして続行している（部分結果・失敗が「データなし」に化ける）。` +
        "共通の fetchAll を使うか、例外にすること（BOA-391）",
    );
  }
}

if (errors.length > 0) {
  console.error("NG: Supabaseクエリのエラー処理に問題があります\n");
  for (const e of errors) console.error("  - " + e);
  console.error(
    "\n詳細: .claude/rules/frontend-data-fetch.md / docs/adr/0069-query-error-propagation.md",
  );
  process.exit(1);
}

console.log(
  `OK: src配下の${files.length}ファイルを検査。Supabaseクライアントは${CLIENT_REL}に一本化され、` +
    "取得エラーは既定で例外になります。",
);
console.log(
  `OK: scripts配下の${scriptFiles.length}ファイルに、throwOnError を false にする引数の既定は無い（BOA-391）`,
);
