#!/usr/bin/env node
/**
 * verify-rpc-key-regression.js - RPCを CREATE OR REPLACE するマイグレーションが、
 * それ以前の定義が返していたキーを取りこぼしていないかを機械検査する。
 *
 * ## なぜ必要か
 *
 * `CREATE OR REPLACE FUNCTION` は関数の定義を丸ごと置き換える。古い版を土台に
 * 書き始めると、その間に別のマイグレーションが足したキーが**黙って消える**。
 * DDLとしては正常に通り、フロントは `...race` のスプレッドで素通しするため
 * 型エラーも出ず、E2Eでも検知できない（フォールバック経路が同じキーを返すため
 * 画面が壊れない）。気づくのは誰かが実際の画面を見たときになる。
 *
 * 本プロジェクトでは同型の回帰が2回起きている。
 *
 *   - BOA-363: 048 が入れた cancellationStatus が 051・062・066 に上書きされ、
 *     本番から数日間消えた
 *   - BOA-431: 102（当初063、PR #824）が 068 ではなくそれ以前の定義を土台にし、
 *     seriesDay・isFinalDay・raceTitle・raceStage と LEFT JOIN race_conditions が
 *     丸ごと消えた。RaceCard の優勝戦バッジが本番で出なくなっていた
 *
 * 既存の verify-rpc-output-keys.js は本番RPCに接続してフロントの参照と突き合わせる
 * ため確実だが、Quality Gates CI（ADR-0072）に載せられず tier=manual に留まり、
 * 定期実行の仕組みが無いため誰も実行していなかった。こちらは **SQLファイル同士の
 * 比較だけで完結する**ので、PRごとにCIで走らせられる。
 *
 * ## 何を見るか
 *
 * docs/db-migration/ の各 .sql から `CREATE OR REPLACE FUNCTION <名前>` のブロックを
 * 切り出し、その中の json_build_object のキー（'キー名',）を集める。
 * 同じ関数を定義するファイルを番号順に並べ、**最後の定義が、それ以前のどの定義にも
 * あったキーを失っていないか**を検査する。
 *
 * 意図的にキーを削る場合は ALLOWED_KEY_REMOVALS に理由つきで登録する。
 *
 * 使い方:
 *   node scripts/maintenance/verify-rpc-key-regression.js
 */
import { promises as fs } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_DIR = path.join(HERE, "../../docs/db-migration");

/**
 * 意図的にキーを削除した箇所。`<関数名>.<キー名>` -> 理由。
 * ここに載せる変更は、レビューで「本当に画面側の参照も消したか」を確認すること。
 */
const ALLOWED_KEY_REMOVALS = {
  // 3モデル体系（本命/スタンダード/穴）のunified一本化で使われなくなったキー。
  // 2026-09-25に導入時点の既存の乖離として凍結した。凍結の根拠:
  //   - 本番の3関数すべてで、この3キーが既に存在しないことを pg_get_functiondef で確認
  //   - src/ にこれらのキーを読む箇所が無いことを確認
  //     （supabaseDataService.js の data.reasons は bet_recommendations テーブルの
  //      列であって、RPCの 'reasons' キーとは別物）
  //   - 画面は正常に動作しており、欠落による実害が出ていない
  "get_today_races.score": "3モデル体系のunified一本化で撤去（凍結）",
  "get_today_races.reasons": "3モデル体系のunified一本化で撤去（凍結）",
  "get_predictions_by_date.score": "3モデル体系のunified一本化で撤去（凍結）",
  "get_predictions_by_date.reasons": "3モデル体系のunified一本化で撤去（凍結）",
  "get_predictions_by_date.recommendedModel":
    "3モデル体系のunified一本化で撤去（凍結）",
  "get_predictions_by_date_light.score":
    "3モデル体系のunified一本化で撤去（凍結）",
  "get_predictions_by_date_light.reasons":
    "3モデル体系のunified一本化で撤去（凍結）",
  "get_predictions_by_date_light.recommendedModel":
    "3モデル体系のunified一本化で撤去（凍結）",
};

/** ファイル名から番号（"103" 等。サブ番号付きの "013b" も許す）を取り出す */
function migrationId(fileName) {
  const m = /^(\d{3}[a-z]?)_/.exec(fileName);
  return m ? m[1] : null;
}

/**
 * SQL全体から `CREATE OR REPLACE FUNCTION <名前>` のブロックを切り出す。
 * 本文の終わりは、その関数を開いた $$ の対になる $$ とする。
 */
function extractFunctionBlocks(sql) {
  const blocks = [];
  const re =
    /CREATE\s+OR\s+REPLACE\s+FUNCTION\s+(?:public\.)?([a-zA-Z0-9_]+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const name = m[1];
    const first = sql.indexOf("$$", m.index);
    if (first === -1) continue;
    const second = sql.indexOf("$$", first + 2);
    if (second === -1) continue;
    blocks.push({ name, body: sql.slice(m.index, second + 2) });
    re.lastIndex = second + 2;
  }
  return blocks;
}

/** json_build_object のキー（'キー名', の形）を集める */
function extractJsonKeys(body) {
  const keys = new Set();
  const re = /'([a-zA-Z][a-zA-Z0-9_]*)'\s*,/g;
  let m;
  while ((m = re.exec(body)) !== null) keys.add(m[1]);
  return keys;
}

const files = (await fs.readdir(MIGRATION_DIR))
  .filter((f) => f.endsWith(".sql") && migrationId(f))
  .sort((a, b) => migrationId(a).localeCompare(migrationId(b)));

/** 関数名 -> [{ id, file, keys }]（番号順） */
const byFunction = new Map();
for (const file of files) {
  const sql = await fs.readFile(path.join(MIGRATION_DIR, file), "utf8");
  for (const { name, body } of extractFunctionBlocks(sql)) {
    if (!byFunction.has(name)) byFunction.set(name, []);
    byFunction.get(name).push({
      id: migrationId(file),
      file,
      keys: extractJsonKeys(body),
    });
  }
}

const problems = [];
let checked = 0;

for (const [name, defs] of byFunction) {
  if (defs.length < 2) continue;

  const latest = defs[defs.length - 1];
  // キーを1つも持たない定義（DROP・GRANT だけの断片など）は比較の土台にしない
  if (latest.keys.size === 0) continue;

  checked += 1;

  /** それ以前の定義が持っていたキーの和集合 */
  const previous = new Map(); // キー -> 最初に登場したファイル
  for (const d of defs.slice(0, -1)) {
    for (const k of d.keys) if (!previous.has(k)) previous.set(k, d.file);
  }

  const lost = [...previous.keys()].filter(
    (k) => !latest.keys.has(k) && !ALLOWED_KEY_REMOVALS[`${name}.${k}`],
  );

  if (lost.length > 0) {
    problems.push({
      name,
      latest: latest.file,
      lost: lost.map((k) => ({ key: k, addedIn: previous.get(k) })),
    });
  }
}

if (problems.length > 0) {
  console.error(
    "NG: RPCの最新定義が、以前の定義にあったキーを失っています\n" +
      "（CREATE OR REPLACE を古い版を土台に書くと、間に入った変更が黙って消えます）\n",
  );
  for (const p of problems) {
    console.error(`  ${p.name}（最新の定義: ${p.latest}）`);
    for (const { key, addedIn } of p.lost) {
      console.error(`    - '${key}' が消えている（${addedIn} で入ったもの）`);
    }
    console.error("");
  }
  console.error(
    "対処: 最新のマイグレーションを、直前の完全な定義を土台に書き直してください。\n" +
      "意図的にキーを削るなら、scripts/maintenance/verify-rpc-key-regression.js の\n" +
      "ALLOWED_KEY_REMOVALS に理由つきで登録し、画面側の参照も消したことをレビューで確認してください。",
  );
  process.exit(1);
}

console.log(
  `OK: RPCのキー欠落なし（複数回定義されている関数 ${checked}件を検査、対象ファイル ${files.length}件）`,
);
