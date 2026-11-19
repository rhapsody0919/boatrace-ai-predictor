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
  const results = evaluate(parserMod, rowsMod);
  for (const r of results) check(r.label, r.pass, r.detail);

  // 名前・ID・関数
  check(
    "レイアウト表の幅の合計が、レコード長（410・416）と一致する",
    parserMod.FAN_RECORD_BYTES_EXPECTED_NO_HOMETOWN ===
      parserMod.FAN_RECORD_BYTES_NO_HOMETOWN &&
      parserMod.FAN_RECORD_BYTES_NO_HOMETOWN + 6 === parserMod.FAN_RECORD_BYTES,
  );
  check(
    "fan{YYMM} の一覧: 2001-10〜2026-04 の50ファイル",
    parserMod.listFanIds("fan0110", "fan2604").length === 50 &&
      parserMod.listFanIds("fan0110", "fan2604")[1] === "fan0204",
  );
  check(
    "最新の期待ファイル: 2026-09 → fan2604、2026-11 → fan2610、2027-02 → fan2610",
    parserMod.latestExpectedFanId(new Date("2026-09-21T00:00:00Z")) ===
      "fan2604" &&
      parserMod.latestExpectedFanId(new Date("2026-11-03T00:00:00Z")) ===
        "fan2610" &&
      parserMod.latestExpectedFanId(new Date("2027-02-01T00:00:00Z")) ===
        "fan2610",
  );
  check(
    "URL: kibetsu/fan2604.lzh",
    parserMod.buildFanUrl("fan2604") ===
      "https://www.boatrace.jp/static_extra/pc_static/download/data/kibetsu/fan2604.lzh",
  );
  let threw = false;
  try {
    parserMod.parseFanId("fan2607");
  } catch {
    threw = true;
  }
  check("04・10 以外の月のファイル名は拒否する", threw);

  // 一意性・行の性質
  const fan = parserMod.parseFanFile(fileBytes("fan2604"), { id: "fan2604" });
  const { rows } = rowsMod.buildStatsRows(fan);
  check(
    "行: 主キー (racer_id, period_year, period_no) が一意",
    new Set(rows.map((r) => `${r.racer_id}|${r.period_year}|${r.period_no}`))
      .size === rows.length,
  );
  check(
    "行の列は STATS_COLUMNS と完全一致（135列）",
    rows.every((r) => same(Object.keys(r), rowsMod.STATS_COLUMNS)) &&
      rowsMod.STATS_COLUMNS.length === 135,
  );
  check(
    "回数は0を0のまま保持する（NULLにしない）: 出走0の選手の着回数",
    rows.find((r) => r.racer_id === 5472).c1_p1 === 0 &&
      rows.find((r) => r.racer_id === 5472).starts === 0,
  );
  const noNew = rowsMod.buildProfileSyncRows(fan, {
    includeNewColumns: false,
  }).rows;
  check(
    "反映行: 083未適用向けは sex・training_term を含まない",
    noNew.every((r) => !("sex" in r) && !("training_term" in r)),
  );
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

  // load: 既定は検証のみ
  const dry = fakeClient({});
  const codeDry = await cli.cmdLoad(o, { client: dry, log: () => {} });
  check(
    "load: --apply なしはDBに触れない（クライアントの呼び出し0回）",
    codeDry === 0 &&
      dry.calls.selects.length === 0 &&
      dry.calls.upserts.length === 0,
  );
  // --apply: 書き込み
  const db = fakeClient({});
  const codeApply = await cli.cmdLoad(
    { ...o, apply: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  check(
    "load --apply: 12行を racer_period_stats へ書く",
    codeApply === 0 &&
      db.tables.racer_period_stats.length === 12 &&
      db.calls.upserts.reduce((a, u) => a + u.n, 0) === 12,
  );
  // 再実行: 投入済みはスキップ。--force でも変更なしの行は書かない
  const codeAgain = await cli.cmdLoad(
    { ...o, apply: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  check(
    "load --apply: 再実行は投入済みでスキップ（書き込み増えず）",
    codeAgain === 0 && db.calls.upserts.length === 1,
  );
  const writesBefore = db.calls.upserts.length;
  await cli.cmdLoad(
    { ...o, apply: true, force: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  check(
    "load --apply --force: 変更の無い行は書かない（WAL・Disk IO対策）",
    db.calls.upserts.length === writesBefore,
  );
  // 1行だけ値が変わったとき、その1行だけ書く
  db.tables.racer_period_stats.find((r) => r.racer_id === 3955).win_rate = 9.99;
  await cli.cmdLoad(
    { ...o, apply: true, force: true, sleepMs: 0 },
    { client: db, sleep: async () => {}, log: () => {} },
  );
  const last = db.calls.upserts.at(-1);
  check(
    "load --apply --force: 値が変わった1行だけを書き直す",
    last &&
      last.n === 1 &&
      db.tables.racer_period_stats.find((r) => r.racer_id === 3955).win_rate ===
        4.84,
    JSON.stringify(last),
  );
  // DDL未適用（テーブルが無い）→ 書かずに失敗
  const noTable = fakeClient({}, { missing: new Set(["racer_period_stats"]) });
  const codeNo = await cli.cmdLoad(
    { ...o, apply: true, force: true },
    { client: noTable, log: () => {} },
  );
  check(
    "load --apply: DDL 083 が未適用（テーブルなし）なら、書き込まず終了コード1",
    codeNo === 1 && noTable.calls.upserts.length === 0,
  );
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

  // sync-profiles
  const fan = cli.readParsedFan(dir, "fan2604");
  const profiles = fan.records.map((r) => ({
    racer_id: r.racer_id,
    ability_index: 999,
    flying_count_period: 99,
    false_start_count_period: 99,
    period_label: "2026-first",
    official_win_rate_period: 1,
    height_cm: 100,
    weight_kg: 100,
    branch: "旧",
    sex: null,
    training_term: null,
  }));
  const pdb = fakeClient({ racer_profiles: profiles });
  const noApply = await cli.cmdSyncProfiles(
    { ...o, id: "fan2604" },
    { client: pdb, log: () => {} },
  );
  check(
    "sync-profiles: --apply なしは更新しない",
    noApply === 0 && pdb.calls.updates.length === 0,
  );
  const applied = await cli.cmdSyncProfiles(
    { ...o, id: "fan2604", apply: true, sleepMs: 0 },
    { client: pdb, sleep: async () => {}, log: () => {} },
  );
  const r3955 = pdb.tables.racer_profiles.find((r) => r.racer_id === 3955);
  check(
    "sync-profiles --apply: 期別成績・身長体重・支部・性別・養成期を更新し、氏名等は触れない",
    applied === 0 &&
      r3955.ability_index === 49 &&
      r3955.flying_count_period === 0 &&
      r3955.period_label === "2026-second" &&
      r3955.official_win_rate_period === 4.84 &&
      r3955.height_cm === 161 &&
      r3955.branch === "徳島" &&
      r3955.sex === 1 &&
      r3955.training_term === 82 &&
      !("name" in r3955) &&
      !!r3955.official_updated_at,
    JSON.stringify(r3955),
  );
  const n1 = pdb.calls.updates.length;
  await cli.cmdSyncProfiles(
    { ...o, id: "fan2604", apply: true, sleepMs: 0 },
    { client: pdb, sleep: async () => {}, log: () => {} },
  );
  check(
    "sync-profiles --apply: 再実行は変更の無い選手を更新しない",
    pdb.calls.updates.length === n1,
    `${pdb.calls.updates.length} vs ${n1}`,
  );
  check(
    "sync-profiles: 出走0の選手の期別成績はNULL（B6と同じ）",
    pdb.tables.racer_profiles.find((r) => r.racer_id === 5472).ability_index ===
      null &&
      pdb.tables.racer_profiles.find((r) => r.racer_id === 5472)
        .period_label === null,
  );
  // より新しい期の値が入っている行は書き戻さない
  const newer = fakeClient({
    racer_profiles: fan.records.map((r) => ({
      racer_id: r.racer_id,
      ability_index: 55,
      flying_count_period: 0,
      false_start_count_period: 0,
      period_label: "2027-first",
      official_win_rate_period: 5,
      height_cm: 100,
      weight_kg: 100,
      branch: "旧",
      sex: null,
      training_term: null,
    })),
  });
  await cli.cmdSyncProfiles(
    { ...o, id: "fan2604", apply: true, sleepMs: 0 },
    { client: newer, sleep: async () => {}, log: () => {} },
  );
  check(
    "sync-profiles: より新しい期（2027-first）の行は、古い期の値で書き戻さない",
    newer.calls.updates.length === 0,
  );
  // 083未適用（sex・training_term が無い）でも、既存の列だけ更新する
  const old = fakeClient(
    {
      racer_profiles: fan.records.map((r) => ({
        racer_id: r.racer_id,
        ability_index: 1,
        flying_count_period: 9,
        false_start_count_period: 9,
        period_label: "2026-first",
        official_win_rate_period: 1,
        height_cm: 100,
        weight_kg: 100,
        branch: "旧",
      })),
    },
    { missing: new Set(["racer_profiles.sex"]) },
  );
  const codeOld = await cli.cmdSyncProfiles(
    { ...o, id: "fan2604", apply: true, sleepMs: 0 },
    { client: old, sleep: async () => {}, log: () => {} },
  );
  check(
    "sync-profiles: DDL 083 未適用（sex なし）でも、既存の列だけ更新し、新しい列は書かない",
    codeOld === 0 &&
      old.calls.updates.length > 0 &&
      old.calls.updates.every(
        (u) => !("sex" in u.values) && !("training_term" in u.values),
      ),
  );
  // racer_profiles に無い選手は作らない
  const partial = fakeClient({
    racer_profiles: [
      {
        racer_id: 3955,
        ability_index: 1,
        flying_count_period: 9,
        false_start_count_period: 9,
        period_label: "2026-first",
        official_win_rate_period: 1,
        height_cm: 100,
        weight_kg: 100,
        branch: "旧",
        sex: null,
        training_term: null,
      },
    ],
  });
  await cli.cmdSyncProfiles(
    { ...o, id: "fan2604", apply: true, sleepMs: 0 },
    { client: partial, sleep: async () => {}, log: () => {} },
  );
  check(
    "sync-profiles: racer_profiles に無い選手（新人）は新規作成しない",
    partial.tables.racer_profiles.length === 1 &&
      partial.calls.updates.length === 1,
  );
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

const parserMutants = [
  [
    "氏名の幅を16→15バイトにする（全角の桁ずれ）",
    [
      [
        '["name", 16, "text", "名前漢字"],',
        '["name", 15, "text", "名前漢字"],',
      ],
    ],
  ],
  [
    "全体の2連対率の桁数を4→3にする",
    [
      [
        '["top2_rate", 4, "d1", "複勝率"],\n  ["first_count", 3, "int", "1着回数"],',
        '["top2_rate", 3, "d1", "複勝率"],\n  ["first_count", 3, "int", "1着回数"],',
      ],
    ],
  ],
  [
    "算出期間（至）の桁数を8→7にする",
    [
      [
        '["calc_to", 8, "raw", "算出期間（至）"],',
        '["calc_to", 7, "raw", "算出期間（至）"],',
      ],
    ],
  ],
  [
    "昭和の起点を1925→1926にする（生年月日が1年ずれる）",
    [["S: 1925,", "S: 1926,"]],
  ],
  [
    "コース別の着回数を6→5個しか読まない",
    [["const COURSE_DETAIL_PLACES = 6;", "const COURSE_DETAIL_PLACES = 5;"]],
  ],
  [
    "旧レイアウト（410バイト）を出身地ありとして読む",
    [
      [
        "const hasHometown = rec.length === FAN_RECORD_BYTES;",
        "const hasHometown = true;",
      ],
    ],
  ],
  [
    "ファイル名と期の一致を検査しない（10月分の年のずれを無視）",
    [
      [
        "if (period.year !== expectYear || period.no !== expectNo)",
        "if (false)",
      ],
    ],
  ],
];
const rowsMutants = [
  [
    "出走0でも勝率・2連対率をNULLにしない",
    [
      [
        "const noStarts = !r.starts;\n  const row = {",
        "const noStarts = false;\n  const row = {",
      ],
    ],
  ],
  [
    "出遅れ（選手責任）を L0 で数える",
    [
      [
        'sumCourses(r, "l1") + r.no_course.l1',
        'sumCourses(r, "l0") + r.no_course.l0',
      ],
    ],
  ],
  [
    "コース別の平均STを進入0でもNULLにしない",
    [
      [
        "row[`c${c}_avg_st`] = none ? null : course.avg_st;",
        "row[`c${c}_avg_st`] = course.avg_st;",
      ],
    ],
  ],
  [
    "期の識別子を導出せず固定値にする",
    [
      [
        "period_label: noStarts ? null : label,",
        'period_label: noStarts ? null : "2026-first",',
      ],
    ],
  ],
];

for (const [label, reps] of parserMutants) {
  const failed = await withMutant("fanPeriodParser.js", reps, async (mod) => {
    try {
      return evaluate(mod, rowsMod).filter((r) => !r.pass);
    } catch (e) {
      return [{ label: `例外: ${e.message}` }]; // 壊した版が例外で落ちるのも「検証が失敗した」とみなす
    }
  });
  check(
    `変異検証（パーサー）: ${label}`,
    failed.length > 0,
    "この変異を検知できない（検証が通ってしまう）",
  );
}
for (const [label, reps] of rowsMutants) {
  const failed = await withMutant("fanPeriodRows.js", reps, async (mod) => {
    try {
      return evaluate(parserMod, mod).filter((r) => !r.pass);
    } catch (e) {
      return [{ label: `例外: ${e.message}` }];
    }
  });
  check(
    `変異検証（行変換）: ${label}`,
    failed.length > 0,
    "この変異を検知できない（検証が通ってしまう）",
  );
}

// 取得ループの変異
const downloaderMutants = [
  [
    "403の連続停止を無効にする（閾値を大きくする）",
    [
      [
        "consecutiveBad >= cls.threshold",
        "consecutiveBad >= cls.threshold + 100",
      ],
    ],
  ],
  [
    "内容が想定外の応答の後に間隔を空けない",
    [
      ["      consecutiveInvalid = 0;\n", "      consecutiveInvalid = 0;\n"],
      [
        "        await pace();\n        continue;\n      }\n      consecutiveInvalid = 0;",
        "        continue;\n      }\n      consecutiveInvalid = 0;",
      ],
    ],
  ],
  [
    "未公開（想定内の404）を完了扱いにする",
    [['(s.status === "absent" && !s.expected)', '(s.status === "absent")']],
  ],
  [
    "日次上限を数えない",
    [["if (usedTonight >= opts.dailyLimit)", "if (false)"]],
  ],
];
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
