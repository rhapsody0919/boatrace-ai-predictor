/**
 * racelist-backfill.js の引数の解釈（parseArgs）。本文は racelist-backfill.js から移しただけ
 */

import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");

// 値つきのオプション（--key=value）。値の無い旗は FLAG_OPTIONS
const VALUE_OPTIONS = {
  from: (opts, v) => {
    opts.from = v;
  },
  to: (opts, v) => {
    opts.to = v;
  },
  "archive-dir": (opts, v) => {
    opts.archiveDir = path.resolve(v);
  },
  "daily-limit": (opts, v) => {
    opts.dailyLimit = Number(v);
  },
  window: (opts, v) => {
    opts.window = v;
  },
  "interval-min-ms": (opts, v) => {
    opts.intervalMinMs = Number(v);
  },
  "interval-max-ms": (opts, v) => {
    opts.intervalMaxMs = Number(v);
  },
  "assumed-latency-ms": (opts, v) => {
    opts.latencyMs = Number(v);
  },
  "max-requests": (opts, v) => {
    opts.maxRequests = Number(v);
  },
  "race-chunk-size": (opts, v) => {
    opts.raceChunkSize = Number(v);
  },
  "batch-size": (opts, v) => {
    opts.batchSize = Number(v);
  },
  "sleep-ms": (opts, v) => {
    opts.sleepMs = Number(v);
  },
};

const FLAG_OPTIONS = {
  "dry-run": "dryRun",
  apply: "apply",
  force: "force",
};

function defaultOptions(command) {
  return {
    command,
    from: null, // race_id の下限（YYYY-MM-DD）。未指定なら対象の全期間
    to: null, // race_id の上限（YYYY-MM-DD）。未指定なら前日（JST）
    archiveDir: path.join(REPO_ROOT, "data/racelist-backfill-archive"),
    dailyLimit: 2000,
    window: "22-06",
    intervalMinMs: 3000,
    intervalMaxMs: 5000,
    latencyMs: 1000,
    maxRequests: Infinity,
    dryRun: false,
    apply: false,
    force: false,
    raceChunkSize: 300, // load: 既存行を読む1回あたりの対象レース数（内部でさらに100件ずつに分割される）
    batchSize: 500, // load: upsertの1文あたりの行数
    sleepMs: 500, // load: バッチ間隔（Disk IO Budgetへの配慮）
  };
}

export function parseArgs(argv) {
  const [command, ...rest] = argv;
  const opts = defaultOptions(command);
  for (const arg of rest) {
    const [k, v] = arg.startsWith("--")
      ? arg.slice(2).split("=")
      : [arg, undefined];
    if (Object.hasOwn(VALUE_OPTIONS, k)) VALUE_OPTIONS[k](opts, v);
    else if (Object.hasOwn(FLAG_OPTIONS, k)) opts[FLAG_OPTIONS[k]] = true;
    else throw new Error(`不明なオプション: ${arg}`);
  }
  return opts;
}
