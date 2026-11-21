/**
 * verify-fan-period.js - 期別成績ファイル（fan）のパーサー・行変換・DDL案・取得〜投入CLIの検証
 *
 * DB・公式サイトに接続しない（fetch・DBクライアントは差し替える）。
 * 設計: docs/design/racer-period-stats/plan.md
 *
 * 検証観点:
 *   1. 形式: 416バイト（2019年以降）・410バイト（旧。出身地なし）の両レイアウトを、バイト幅で正しく読む
 *   2. 公式の選手ページとの一致（2026-09-21に取得した実ページの値。期別成績: 勝率・2連対率・出走・優出・優勝・
 *      平均ST・能力指数・F回数・出遅れ（選手責任）・1〜6着回数、コース別: 進入率・3連対率・平均ST・スタート順、
 *      プロフィール: 生年月日・身長・体重・支部・登録期・氏名）
 *   3. 本番DBの racer_profiles との一致（2026-09-21にSELECTで確認した、選手10人の能力指数・F・出遅れ・勝率）
 *   4. 値なしの扱い（出走0）、行への変換、racer_profiles への反映
 *   5. DDL案（083）と行の列の完全一致・型・RLS
 *   6. CLI: 窓・日次上限・サーキットブレーカー・404・想定内の未公開・再開・0件を成功にしない・LZH検証
 *   7. load / sync-profiles: 既定は検証のみ、--apply で書く、変更なしは書かない、未適用DDLでも壊れない
 *   8. 変異検証: パーサー・行変換・取得ループを壊すと、上の検証が失敗する
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decodeLzhBytes } from "../lib/kbFileParser.js";
import * as parserMod from "../lib/fanPeriodParser.js";
import * as rowsMod from "../lib/fanPeriodRows.js";
import * as cli from "./fan-backfill.js";
import { fakeClient } from "../lib/fakeSupabaseClient.js";
import { evaluate as evaluateWith } from "./verifyData/fan-period-evaluate.js";
import { downloadTests as runDownloadTests } from "./verifyData/fan-period-download.js";
import { evaluateScenes, loadScenes, parserRowsMutantScenes, syncProfilesScenes } from "./verifyData/fan-period-scenes.js";
import { downloaderMutants, parserMutants, rowsMutants } from "./verifyData/fan-period-mutants.js";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "../..");
const LIB = path.join(ROOT, "scripts/lib");

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) console.log(`✅ ${label}`);
  else {
    failures++;
    console.log(`❌ ${label}${detail ? `\n     ${detail}` : ""}`);
  }
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// 未定義の入力は現状を表示するだけで、成功・失敗の判定に含めない。
const KNOWN_GAPS = [
  { input: "fanIdOf(2100, 4)", spec: "2000年代以外は未定", current: () => parserMod.fanIdOf(2100, 4) },
  { input: "fanIdOf(2026, 1)", spec: "04・10以外の月は未定（parseFanIdは拒否）", current: () => parserMod.fanIdOf(2026, 1) },
  { input: "fanIdOf(26, 4)", spec: "2桁の年は未定", current: () => parserMod.fanIdOf(26, 4) },
  { input: "courseColumns(0)", spec: "1〜6以外のコースは未定", current: () => rowsMod.courseColumns(0) },
  { input: "courseColumns(7)", spec: "1〜6以外のコースは未定", current: () => rowsMod.courseColumns(7) },
];

for (const [year, month, expected] of [
  [2026, 4, "fan2604"],
  [2025, 10, "fan2510"],
  [2001, 10, "fan0110"],
  [2009, 4, "fan0904"],
  [2026, "04", "fan2604"],
]) {
  check(
    `fanIdOf(${year}, ${JSON.stringify(month)}): ${expected}`,
    same(parserMod.fanIdOf(year, month), expected),
  );
}
for (const id of ["fan2604", "fan2510", "fan0110"]) {
  const { year, month } = parserMod.parseFanId(id);
  check(`parseFanId → fanIdOf: ${id}`, same(parserMod.fanIdOf(year, month), id));
}
check(
  "courseColumns(1): 18列の名前と順序",
  same(rowsMod.courseColumns(1), [
    "c1_entries", "c1_top2_rate", "c1_avg_st", "c1_avg_start_rank",
    "c1_p1", "c1_p2", "c1_p3", "c1_p4", "c1_p5", "c1_p6",
    "c1_f", "c1_l0", "c1_l1", "c1_k0", "c1_k1", "c1_s0", "c1_s1", "c1_s2",
  ]),
);
check(
  "courseColumns(6): 先頭4列の名前と順序",
  same(rowsMod.courseColumns(6).slice(0, 4), [
    "c6_entries", "c6_top2_rate", "c6_avg_st", "c6_avg_start_rank",
  ]),
);
const courseColumns = [1, 2, 3, 4, 5, 6].flatMap(rowsMod.courseColumns);
check("courseColumns(1〜6): 108列", courseColumns.length === 108);
check("courseColumns(1〜6): 重複なし", new Set(courseColumns).size === courseColumns.length);
check(
  "courseColumns(1〜6): 全列がSTATS_COLUMNSに含まれる",
  courseColumns.every((column) => rowsMod.STATS_COLUMNS.includes(column)),
);

// ---------------------------------------------------------------------------
// フィクスチャ（実ファイルから抜粋した選手のレコード）
// ---------------------------------------------------------------------------
const FIXTURE = JSON.parse(
  fs.readFileSync(path.join(LIB, "__fixtures__/fan/fan-sample.json"), "utf8"),
);

/** フィクスチャの選手レコード → ファイルのバイト列（CRLF区切り） */
function fileBytes(id, filter = () => true) {
  const parts = [];
  for (const r of FIXTURE.files[id].records) {
    if (!filter(r)) continue;
    parts.push(new Uint8Array(Buffer.from(r.b64, "base64")));
    parts.push(new Uint8Array([0x0d, 0x0a]));
  }
  const total = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) {
    out.set(p, pos);
    pos += p.length;
  }
  return out;
}

/** パーサー・行変換に対する評価（期待値と中身は verifyData/fan-period-evaluate.js）。変異検証で、壊した版にも同じ評価をかける */
const evaluate = (P, R) => evaluateWith(P, R, fileBytes);

// ---------------------------------------------------------------------------
// 1〜4 の評価
// ---------------------------------------------------------------------------
{
  evaluateScenes({ parserMod, rowsMod, check, same, fileBytes, evaluate });
}

// ---------------------------------------------------------------------------
// 5. DDL案（083）
// ---------------------------------------------------------------------------
{
  const sql = fs.readFileSync(
    path.join(ROOT, "docs/db-migration/083_racer_period_stats.sql"),
    "utf8",
  );
  const body =
    /CREATE TABLE IF NOT EXISTS racer_period_stats \(([\s\S]*?)\n\);/.exec(
      sql,
    )[1];
  const cols = [];
  const types = {};
  for (const line of body.split("\n")) {
    const m = /^\s{2}([a-z0-9_]+)\s+([a-z]+(?:\([\d,]+\))?)/.exec(line);
    if (m && !["primary", "constraint"].includes(m[1])) {
      cols.push(m[1]);
      types[m[1]] = m[2];
    }
  }
  const expected = [...rowsMod.STATS_COLUMNS, "created_at", "updated_at"];
  check(
    "DDL 083: 列が STATS_COLUMNS + created_at・updated_at と完全一致（順序も）",
    same(cols, expected),
    `DDL=${cols.length}列 行=${expected.length}列 差=${expected
      .filter((c) => !cols.includes(c))
      .concat(cols.filter((c) => !expected.includes(c)))
      .join(",")}`,
  );
  const scales = rowsMod.NUMERIC_SCALES.racer_period_stats;
  const scaleOk = Object.entries(scales).every(([c, s]) =>
    new RegExp(`^numeric\\(\\d+,${s}\\)$`).test(types[c] ?? ""),
  );
  check(
    "DDL 083: NUMERIC_SCALES の全列が numeric(桁,丸め桁) で、丸め桁が一致",
    scaleOk,
    JSON.stringify(
      Object.entries(scales)
        .filter(
          ([c, s]) =>
            !new RegExp(`^numeric\\(\\d+,${s}\\)$`).test(types[c] ?? ""),
        )
        .slice(0, 3),
    ),
  );
  const numericCols = cols.filter((c) => types[c].startsWith("numeric"));
  check(
    "DDL 083: numeric の列は全て NUMERIC_SCALES に登録（変更の無い行の判定が丸めで狂わない）",
    numericCols.every((c) => c in scales),
    numericCols.filter((c) => !(c in scales)).join(","),
  );
  check(
    "DDL 083: 主キー (racer_id, period_year, period_no)・RLS有効・anon/authenticated の権限剥奪",
    /PRIMARY KEY \(racer_id, period_year, period_no\)/.test(sql) &&
      /ALTER TABLE racer_period_stats ENABLE ROW LEVEL SECURITY/.test(sql) &&
      /REVOKE ALL ON racer_period_stats FROM anon, authenticated/.test(sql),
  );
  check(
    "DDL 083: racer_profiles に sex・training_term を追加（IF NOT EXISTS）",
    /ADD COLUMN IF NOT EXISTS sex smallint/.test(sql) &&
      /ADD COLUMN IF NOT EXISTS training_term smallint/.test(sql),
  );
  check(
    "DDL 083: 外部キーを張らない（未登録の選手を保存できる）",
    !/REFERENCES/i.test(sql.replace(/--[^\n]*/g, "")),
  );
  check("DDL 083: 本番へ未適用の案であることを明記", /本番へ未適用/.test(sql));
}

// ---------------------------------------------------------------------------
// 6. CLI（取得）。fetch を差し替え、公式サイトへは接続しない
// ---------------------------------------------------------------------------

/** 無圧縮（-lh0-）のLZHを作る（手作り。CLIの取得・展開経路の検証用） */
function makeLzh(name, data) {
  const crc16 = (buf) => {
    let crc = 0;
    for (const b of buf) {
      crc ^= b;
      for (let i = 0; i < 8; i++)
        crc = crc & 1 ? (crc >>> 1) ^ 0xa001 : crc >>> 1;
    }
    return crc & 0xffff;
  };
  const nameBytes = Buffer.from(name, "ascii");
  const size = 22 + nameBytes.length;
  const hdr = Buffer.alloc(size + 2);
  hdr[0] = size;
  hdr.write("-lh0-", 2, "ascii");
  hdr.writeUInt32LE(data.length, 7); // 圧縮後
  hdr.writeUInt32LE(data.length, 11); // 元
  hdr.writeUInt32LE(0x5a3b0000, 15); // 更新日時（DOS形式。値は任意）
  hdr[19] = 0x20; // 属性
  hdr[20] = 0; // レベル0
  hdr[21] = nameBytes.length;
  nameBytes.copy(hdr, 22);
  hdr.writeUInt16LE(crc16(data), 22 + nameBytes.length);
  let sum = 0;
  for (let i = 2; i < hdr.length; i++) sum += hdr[i];
  hdr[1] = sum & 0xff;
  return new Uint8Array(
    Buffer.concat([hdr, Buffer.from(data), Buffer.from([0])]),
  );
}

const lzh2604 = makeLzh("fan2604.txt", fileBytes("fan2604"));
check(
  "手作りLZH（-lh0-）を、decodeLzhBytes が元のバイト列に展開できる",
  same([...(await decodeLzhBytes(lzh2604))], [...fileBytes("fan2604")]),
);

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "fan-verify-"));
const dirs = [];
const newDir = () => {
  const d = fs.mkdtempSync(path.join(tmp, "a-"));
  dirs.push(d);
  return d;
};
const baseOpts = (dir, extra = {}) =>
  cli.validateOptions({
    ...cli.parseArgs(["download"], new Date("2026-09-21T00:00:00Z")),
    from: "fan1904",
    to: "fan2604",
    archiveDir: dir,
    window: "any",
    minRecords: 1, // フィクスチャは12人分（実ファイルは1,500人以上）
    ...extra,
  });
const resp = (status, bytes = new Uint8Array(), lastModified = null) => ({
  status,
  bytes,
  ms: 5,
  lastModified,
});
const harness = (responder, nowIso = "2026-09-21T13:00:00Z") => {
  const sleeps = [];
  const urls = [];
  let t = Date.parse(nowIso);
  return {
    sleeps,
    urls,
    deps: {
      sleep: async (ms) => {
        sleeps.push(ms);
        t += ms;
      },
      fetchOnce: async (url) => {
        urls.push(url);
        return responder(url, urls.length);
      },
      now: () => new Date(t),
      backoffBaseMs: 30000,
      log: () => {},
    },
  };
};
const manifestOf = (dir) =>
  fs.existsSync(path.join(dir, "manifest.jsonl"))
    ? fs
        .readFileSync(path.join(dir, "manifest.jsonl"), "utf8")
        .trim()
        .split("\n")
        .filter(Boolean)
        .map(JSON.parse)
    : [];

const downloadTests = (mods = { cli }) =>
  runDownloadTests(mods.cli, {
    newDir,
    baseOpts,
    harness,
    resp,
    manifestOf,
    lzh2604,
  });

{
  const results = await downloadTests();
  for (const r of results) check(r.label, r.pass, r.detail);
}

// ---------------------------------------------------------------------------
// parse → load → sync-profiles（偽のDBクライアント）
// ---------------------------------------------------------------------------

{
  const dir = newDir();
  const h = harness(() => resp(200, lzh2604));
  await cli.cmdDownload(
    baseOpts(dir, { from: "fan2604", to: "fan2604" }),
    h.deps,
  );
  const o = baseOpts(dir, { from: "fan2604", to: "fan2604" });
  const logs = [];
  const code = await cli.cmdParse(o, { log: (s) => logs.push(s) });
  const parsed = cli.readParsedFan(dir, "fan2604");
  check(
    "parse: 生LZH → 中間JSON（fan-period/v1、12人、期2026年2期）。DB・ネットワーク不要",
    code === 0 &&
      parsed.schema === "fan-period/v1" &&
      parsed.record_count === 12 &&
      parsed.period.year === 2026 &&
      parsed.source.sha256,
    logs.join(" / "),
  );
  const again = await cli.cmdParse(o, { log: () => {} });
  check(
    "parse: 再実行は既存をスキップ、--force で再生成",
    again === 0 &&
      (await cli.cmdParse({ ...o, force: true }, { log: () => {} })) === 0,
  );
  // 生ファイルの改ざんをsha256で検知する
  const raw = cli.rawPath(dir, "fan2604");
  const orig = fs.readFileSync(raw);
  fs.writeFileSync(raw, Buffer.concat([orig, Buffer.from([0])]));
  let detected = false;
  try {
    await cli.cmdParse({ ...o, force: true }, { log: () => {} });
  } catch (e) {
    detected = /sha256/.test(e.message);
  }
  fs.writeFileSync(raw, orig);
  check("parse: 生ファイルの破損・差し替えを sha256 で検知する", detected);

  await loadScenes({ cli, fakeClient, check, o });
  const failing = fakeClient({}, { failUpsert: true });
  const dir2 = newDir();
  fs.cpSync(dir, dir2, { recursive: true });
  fs.rmSync(path.join(dir2, "loaded.jsonl"), { force: true });
  const codeFail = await cli.cmdLoad(
    { ...o, archiveDir: dir2, apply: true, sleepMs: 0 },
    { client: failing, sleep: async () => {}, log: () => {} },
  );
  check(
    "load --apply: 書き込み失敗は loaded に記録せず終了コード1（再実行で再試行）",
    codeFail === 1 && !fs.existsSync(path.join(dir2, "loaded.jsonl")),
  );

  await syncProfilesScenes({ cli, fakeClient, check, dir, o });
}

// ---------------------------------------------------------------------------
// 8. 変異検証: 壊した版で、評価・取得の検証が失敗する
// ---------------------------------------------------------------------------
/**
 * 変異ごとに別モジュールとして読み込むための通し番号。以前は import の URL を `?t=${Date.now()}` で区別していたが、
 * 同じファイルの変異が同じミリ秒に続くと URL が一致し、ESM のキャッシュから直前の変異が返る（BOA-648/BOA-671と同種）。
 * 時刻ではなく通し番号で区別する（下の取得ループの変異（archiveDownloader/fan-backfill）とも共有する）
 */
let mutantSeq = 0;
async function withMutant(fileName, replacements, run) {
  let mutated = fs.readFileSync(path.join(LIB, fileName), "utf8");
  for (const [from, to] of replacements) {
    if (!mutated.includes(from))
      throw new Error(
        `変異の対象が見つかりません（${fileName}）: ${from.slice(0, 60)}`,
      );
    mutated = mutated.replace(from, to);
  }
  const tmpFile = path.join(
    LIB,
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}-${++mutantSeq}.tmp.mjs`,
  );
  fs.writeFileSync(tmpFile, mutated);
  try {
    return await run(await import(tmpFile));
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

await parserRowsMutantScenes({ parserMod, rowsMod, parserMutants, rowsMutants, check, evaluate, withMutant });

for (const [label, reps] of downloaderMutants) {
  // archiveDownloader を差し替えた版を使う fan-backfill のコピーを作る
  const failed = await (async () => {
    const dl = fs.readFileSync(path.join(LIB, "archiveDownloader.js"), "utf8");
    let mutatedDl = dl;
    for (const [from, to] of reps) {
      if (!mutatedDl.includes(from))
        throw new Error(
          `変異の対象が見つかりません（archiveDownloader.js）: ${from.slice(0, 60)}`,
        );
      mutatedDl = mutatedDl.replace(from, to);
    }
    const seq = ++mutantSeq;
    const dlTmp = path.join(
      LIB,
      `archiveDownloader.mutant-${process.pid}-${seq}.tmp.mjs`,
    );
    const cliSrc = fs
      .readFileSync(
        path.join(ROOT, "scripts/maintenance/fan-backfill.js"),
        "utf8",
      )
      .replace(
        '"../lib/archiveDownloader.js"',
        `"../lib/${path.basename(dlTmp)}"`,
      );
    const cliTmp = path.join(
      ROOT,
      "scripts/maintenance",
      `fan-backfill.mutant-${process.pid}-${seq}.tmp.mjs`,
    );
    fs.writeFileSync(dlTmp, mutatedDl);
    fs.writeFileSync(cliTmp, cliSrc);
    try {
      const mod = await import(cliTmp);
      return (await downloadTests({ cli: mod })).filter((r) => !r.pass);
    } catch (e) {
      return [{ label: `例外: ${e.message}` }];
    } finally {
      fs.rmSync(dlTmp, { force: true });
      fs.rmSync(cliTmp, { force: true });
    }
  })();
  check(
    `変異検証（取得ループ）: ${label}`,
    failed.length > 0,
    "この変異を検知できない（検証が通ってしまう）",
  );
}

fs.rmSync(tmp, { recursive: true, force: true });

console.log(`\nKNOWN_GAPS: ${KNOWN_GAPS.length}件（失敗には含めない）`);
for (const gap of KNOWN_GAPS) {
  console.log(`${gap.input}: ${gap.spec} / 今の値=${JSON.stringify(gap.current())}`);
}

console.log(
  failures === 0
    ? "\n全ての検証に成功しました"
    : `\n${failures}件の検証に失敗しました`,
);
process.exit(failures === 0 ? 0 : 1);
