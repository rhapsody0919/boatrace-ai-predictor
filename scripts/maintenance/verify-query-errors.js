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
 *
 * ## 検査しないこと（意図的）
 *
 * - 呼び出し側の `if (error)` の有無は見ない。`.throwOnError()` が既定になった今、
 *   その分岐は到達しないだけで害が無く、機械的に消すとレビューのノイズになる
 * - `scripts/` （バッチ側）は対象外。`scripts/lib/supabaseClient.js` の `fetchAll` は
 *   `throwOnError = false` が既定のまま残っており、121箇所の呼び出し側への影響確認が
 *   別途必要なため、別チケットで扱う（本スクリプトのBATCH_TODOに記録）
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "../..");
const SRC = path.join(ROOT, "src");
const CLIENT_REL = "src/services/supabaseClient.js";

/** バッチ側の未対応分（別チケット）。ここに書いておき、忘れられないようにする */
const BATCH_TODO =
  "scripts/lib/supabaseClient.js の fetchAll は throwOnError=false が既定のまま（呼び出し121箇所）。BOA-359のバッチ側として別対応";

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
console.log(`INFO: 未対応（別チケット）— ${BATCH_TODO}`);
