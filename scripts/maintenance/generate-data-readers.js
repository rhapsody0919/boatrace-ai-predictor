#!/usr/bin/env node
/**
 * generate-data-readers.js — データの読み手の台帳 docs/reference/data-readers.{json,md} を作る。
 *
 *   node scripts/maintenance/generate-data-readers.js            # 作って書く
 *   node scripts/maintenance/generate-data-readers.js --dry-run  # 作るだけで書かない（件数を出す）
 *   node scripts/maintenance/generate-data-readers.js --check    # コミット済みの台帳と一致するか（違えば終了コード1）
 *
 * 表・列・RPC ごとに、読み手（src・api・scripts・sns-video-studio のファイル:行）・書き手・RPC の本体が
 * 読む表・権限を並べる。抽出と組み立ては scripts/lib/dataReaders.js（構文木、DB に触れない）。
 * 入力はリポジトリの中だけ: git ls-files のソース、本番スキーマの写し docs/reference/schema-snapshot.json
 * （ADR-0102。本番には接続しない）、手で足す外の読み手 docs/reference/data-readers.extra.json、
 * 取得のジョブの一覧 scripts/lib/scrapeJobs/registry.js。
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXTRA_FILE,
  LEDGER_JSON,
  LEDGER_MD,
  SOURCE_ROOTS,
  buildLedger,
  extractAccesses,
  isSourceFile,
  pythonMentions,
  renderMarkdown,
  validateExtra,
} from "../lib/dataReaders.js";
import { SNAPSHOT_FILE } from "../lib/schemaSnapshot.js";
import { SCRAPE_JOBS } from "../lib/scrapeJobs/registry.js";

const ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

function trackedFiles() {
  const out = execFileSync("git", ["ls-files", "-z", "--", ...SOURCE_ROOTS], {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  return out.split("\0").filter(Boolean).sort();
}

/** 構文木の文字列の値（ジョブの入口を名前で探すのに使う）。api/cron だけ */
function cronStrings(source) {
  return new Set(
    [...source.matchAll(/["'`]([A-Za-z0-9_:-]+)["'`]/g)].map((m) => m[1]),
  );
}

/** Python は構文木で読まない。DB を読み書きしうるもの（写しの名前の文字列があるか、REST・クライアントの語）を「拾えなかった」に出す */
function isUncoveredDbFile(source, mentions) {
  return mentions.length > 0 || /rest\/v1|\.table\(|supabase/i.test(source);
}

export function generate() {
  const snapshot = JSON.parse(
    readFileSync(path.join(ROOT, SNAPSHOT_FILE), "utf8"),
  );
  const extra = JSON.parse(readFileSync(path.join(ROOT, EXTRA_FILE), "utf8"));
  const extraErrors = validateExtra(extra, snapshot);
  if (extraErrors.length) {
    throw new Error(
      `${EXTRA_FILE} の形が誤り:\n  - ${extraErrors.join("\n  - ")}`,
    );
  }
  const known = {
    knownTables: new Set(snapshot.relations.map((r) => r.name)),
    knownFunctions: new Set(snapshot.functions.map((f) => f.name)),
  };
  const perFile = new Map();
  const uncoveredFiles = [];
  const otherMentions = [];
  for (const file of trackedFiles()) {
    const source = readFileSync(path.join(ROOT, file), "utf8");
    if (isSourceFile(file)) {
      const result = extractAccesses(source, file, known);
      if (/^api\/cron\//.test(file)) result.strings = cronStrings(source);
      perFile.set(file, result);
    } else if (file.endsWith(".py")) {
      const mentions = pythonMentions(source, file, known);
      if (isUncoveredDbFile(source, mentions)) uncoveredFiles.push(file);
      otherMentions.push(...mentions);
    }
  }
  const ledger = buildLedger({
    perFile,
    snapshot,
    extra,
    scrapeJobNames: Object.keys(SCRAPE_JOBS),
    uncoveredFiles,
    otherMentions,
  });
  // 抽出が壊れて空になったものを書かない
  if (ledger.counts.tableReaders < 100 || ledger.counts.rpcCallers < 10) {
    throw new Error(
      `読み手が少なすぎる（表 ${ledger.counts.tableReaders}・RPC ${ledger.counts.rpcCallers}）。抽出が壊れていないか確かめる`,
    );
  }
  return {
    ledger,
    json: `${JSON.stringify(ledger, null, 2)}\n`,
    md: `${renderMarkdown(ledger)}\n`,
  };
}

function main() {
  const args = process.argv.slice(2);
  const { ledger, json, md } = generate();
  if (args.includes("--check")) {
    const stale = [
      [LEDGER_JSON, json],
      [LEDGER_MD, md],
    ].filter(([file, text]) => {
      try {
        return readFileSync(path.join(ROOT, file), "utf8") !== text;
      } catch {
        return true;
      }
    });
    if (stale.length) {
      console.error(
        `generate-data-readers: 台帳が今のコードと合わない: ${stale.map(([f]) => f).join(", ")}。node scripts/maintenance/generate-data-readers.js で作り直す`,
      );
      process.exit(1);
    }
    console.log("generate-data-readers: 台帳は今のコードと一致");
    return;
  }
  console.log(JSON.stringify(ledger.counts));
  if (args.includes("--dry-run")) return;
  writeFileSync(path.join(ROOT, LEDGER_JSON), json);
  writeFileSync(path.join(ROOT, LEDGER_MD), md);
  console.error(`generate-data-readers: ${LEDGER_JSON}・${LEDGER_MD} に書いた`);
}

const invokedDirectly =
  process.argv[1] &&
  fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  try {
    main();
  } catch (e) {
    console.error(`generate-data-readers: ${e.message}`);
    process.exit(1);
  }
}
