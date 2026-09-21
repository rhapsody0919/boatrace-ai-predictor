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

// ---------------------------------------------------------------------------
// 期待値（実データ）
// ---------------------------------------------------------------------------

// 公式の選手ページ「期別成績」（2026-09-21取得。集計期間 2025/11/01〜2026/04/30）
const OFFICIAL_SEASON = {
  3448: {
    win_rate: 4.61,
    top2_rate: 24.4,
    starts: 90,
    finals: 1,
    wins: 0,
    avg_st: 0.19,
    ability: 47,
    flying: 1,
    false_start: 0,
    places: [10, 12, 17, 13, 26, 11],
  },
  3809: {
    win_rate: 3.86,
    top2_rate: 12.3,
    starts: 65,
    finals: 0,
    wins: 0,
    avg_st: 0.19,
    ability: 45,
    flying: 1,
    false_start: 1,
    places: [2, 6, 15, 13, 14, 13],
  },
  3955: {
    win_rate: 4.84,
    top2_rate: 24.5,
    starts: 57,
    finals: 0,
    wins: 0,
    avg_st: 0.19,
    ability: 49,
    flying: 0,
    false_start: 0,
    places: [5, 9, 13, 13, 7, 10],
  },
  4177: {
    win_rate: 4.53,
    top2_rate: 25,
    starts: 76,
    finals: 1,
    wins: 1,
    avg_st: 0.17,
    ability: 46,
    flying: 0,
    false_start: 0,
    places: [12, 7, 13, 10, 15, 19],
  },
  5111: {
    win_rate: 5.55,
    top2_rate: 40,
    starts: 95,
    finals: 1,
    wins: 0,
    avg_st: 0.15,
    ability: 50,
    flying: 0,
    false_start: 0,
    places: [20, 18, 14, 14, 13, 16],
  },
  5158: {
    win_rate: 6.78,
    top2_rate: 52,
    starts: 123,
    finals: 6,
    wins: 1,
    avg_st: 0.16,
    ability: 54,
    flying: 0,
    false_start: 0,
    places: [44, 20, 17, 22, 14, 5],
  },
};
// 出走0の選手（公式ページは全項目が「-」）
const OFFICIAL_NO_STARTS = [5472, 3391];
// 公式の選手ページ「コース別成績」（2026-09-21取得）。進入率=進入回数/出走回数、3連対率=(1〜3着)/進入回数
const OFFICIAL_COURSE = {
  3448: {
    entry_rate: [16.7, 16.7, 17.8, 17.8, 17.8, 13.3],
    top3_rate: [93.3, 46.7, 50, 18.8, 18.8, 33.3],
    avg_st: [0.17, 0.18, 0.2, 0.19, 0.21, 0.19],
    start_rank: [3.4, 4.7, 3.9, 3.6, 4.1, 3.8],
  },
  4365: {
    entry_rate: [19, 19, 13, 15, 16, 18],
    top3_rate: [84.2, 78.9, 69.2, 66.7, 18.8, 11.1],
    avg_st: [0.14, 0.16, 0.18, 0.17, 0.18, 0.22],
    start_rank: [2.7, 3.3, 3.5, 2.5, 3.4, 4],
  },
};
// 公式の選手ページ「プロフィール」（2026-09-21取得）。氏名・出身地・血液型・級の表記は、ページとfanで異なる（空白・県・型）
const OFFICIAL_PROFILE = {
  3024: {
    name: "西島義則",
    birth: "1961-10-30",
    height: 166,
    weight: 59,
    branch: "広島",
    term: 49,
    blood: "AB",
    hometown: "島根",
    sex: 1,
  },
  3618: {
    name: "海野ゆかり",
    birth: "1973-11-28",
    height: 164,
    weight: 45,
    branch: "広島",
    term: 71,
    blood: "O",
    hometown: "広島",
    sex: 2,
  },
  5186: {
    name: "遠藤圭吾",
    birth: "2000-04-14",
    height: 171,
    weight: 54,
    branch: "東京",
    term: 128,
    blood: "A",
    hometown: "神奈川",
    sex: 1,
  },
};
// 本番DBの racer_profiles（2026-09-21 SELECT。B6が2026-09-19〜20に取得した値）: [能力指数, F, 出遅れ, 勝率]。出走0はNULL
const DB_PROFILES = {
  3024: [53, 3, 0, 6.68],
  3448: [47, 1, 0, 4.61],
  3809: [45, 1, 1, 3.86],
  3618: [57, 0, 0, 6.36],
  5186: [43, 1, 1, 3.62],
  3955: [49, 0, 0, 4.84],
  4177: [46, 0, 0, 4.53],
  5111: [50, 0, 0, 5.55],
  5158: [54, 0, 0, 6.78],
  4365: [50, 0, 0, 5.56],
  5472: [null, null, null, null],
  3391: [null, null, null, null],
};

const norm = (s) => (s ?? "").normalize("NFKC").replace(/\s+/g, "");

/**
 * パーサー・行変換に対する評価。変異検証で、壊した版にも同じ評価をかける。
 * @returns {Array<{label: string, pass: boolean, detail?: string}>}
 */
function evaluate(P, R) {
  const results = [];
  const add = (label, pass, detail = "") =>
    results.push({ label, pass, detail });
  const fan = P.parseFanFile(fileBytes("fan2604"), { id: "fan2604" });
  add(
    "fan2604: 12人・異常0",
    fan.record_count === 12 && fan.anomalies.length === 0,
    JSON.stringify(fan.anomalies.slice(0, 2)),
  );
  add(
    "期: 2026年2期、算出期間 2025-11-01〜2026-04-30",
    same(fan.period, {
      year: 2026,
      no: 2,
      calc_from: "2025-11-01",
      calc_to: "2026-04-30",
    }),
  );
  const by = new Map(fan.records.map((r) => [r.racer_id, r]));
  const { rows } = R.buildStatsRows(fan);
  const rowBy = new Map(rows.map((r) => [r.racer_id, r]));
  const prof = R.buildProfileSyncRows(fan).rows;
  const profBy = new Map(prof.map((r) => [r.racer_id, r]));
  const sum = (r, k) => r.courses.reduce((a, c) => a + c[k], 0);

  // 2. 公式の選手ページとの一致（期別成績）
  for (const [id, o] of Object.entries(OFFICIAL_SEASON)) {
    const r = by.get(Number(id));
    const row = rowBy.get(Number(id));
    const got = {
      win_rate: row.win_rate,
      top2_rate: row.top2_rate,
      starts: row.starts,
      finals: row.finals,
      wins: row.wins,
      avg_st: row.avg_st,
      ability: row.ability_now,
      flying: sum(r, "f"),
      false_start: sum(r, "l1") + r.no_course.l1,
      places: [0, 1, 2, 3, 4, 5].map((i) =>
        r.courses.reduce((a, c) => a + c.places[i], 0),
      ),
    };
    add(
      `公式の選手ページ（期別成績）と一致: ${id}`,
      same(got, o),
      `page=${JSON.stringify(o)} fan=${JSON.stringify(got)}`,
    );
  }
  for (const id of OFFICIAL_NO_STARTS) {
    const row = rowBy.get(id);
    add(
      `出走0の選手は勝率・2連対率・平均ST・能力指数がNULL（公式ページは「-」）: ${id}`,
      row.starts === 0 &&
        row.win_rate === null &&
        row.top2_rate === null &&
        row.avg_st === null &&
        row.ability_now === null,
      JSON.stringify(row).slice(0, 200),
    );
  }
  add(
    "進入0のコースの平均ST・スタート順位・2連対率はNULL（5472は全コース進入0）",
    [1, 2, 3, 4, 5, 6].every((c) => {
      const row = rowBy.get(5472);
      return (
        row[`c${c}_avg_st`] === null &&
        row[`c${c}_avg_start_rank`] === null &&
        row[`c${c}_top2_rate`] === null
      );
    }),
  );
  // 公式の選手ページ（コース別成績）との一致
  for (const [id, o] of Object.entries(OFFICIAL_COURSE)) {
    const r = by.get(Number(id));
    const row = rowBy.get(Number(id));
    const got = {
      entry_rate: r.courses.map(
        (c) => Math.round((c.entries / r.starts) * 1000) / 10,
      ),
      top3_rate: r.courses.map(
        (c) =>
          Math.round(
            ((c.places[0] + c.places[1] + c.places[2]) / c.entries) * 1000,
          ) / 10,
      ),
      avg_st: [1, 2, 3, 4, 5, 6].map((c) => row[`c${c}_avg_st`]),
      start_rank: [1, 2, 3, 4, 5, 6].map((c) => row[`c${c}_avg_start_rank`]),
    };
    add(
      `公式の選手ページ（コース別成績）と一致: ${id}`,
      same(got, o),
      `page=${JSON.stringify(o)} fan=${JSON.stringify(got)}`,
    );
  }
  // 公式の選手ページ（プロフィール）との一致
  for (const [id, o] of Object.entries(OFFICIAL_PROFILE)) {
    const r = by.get(Number(id));
    const got = {
      name: norm(r.name),
      birth: r.birth_date,
      height: r.height_cm,
      weight: r.weight_kg,
      branch: r.branch,
      term: r.training_term,
      blood: r.blood_type,
      hometown: norm(r.hometown),
      sex: r.sex,
    };
    add(
      `公式の選手ページ（プロフィール）と一致: ${id}`,
      same(got, o),
      `page=${JSON.stringify(o)} fan=${JSON.stringify(got)}`,
    );
  }
  // 3. 本番DBの racer_profiles との一致（反映する行の値）
  for (const [id, exp] of Object.entries(DB_PROFILES)) {
    const p = profBy.get(Number(id));
    if (!p) continue;
    const got = [
      p.ability_index,
      p.flying_count_period,
      p.false_start_count_period,
      p.official_win_rate_period,
    ];
    add(
      `racer_profiles（本番DB）の値と一致: ${id}`,
      same(got, exp),
      `db=${JSON.stringify(exp)} fan=${JSON.stringify(got)}`,
    );
  }
  add(
    "反映行の期の識別子は 2026-second（B6と同じ）",
    prof
      .filter((p) => p.ability_index !== null)
      .every((p) => p.period_label === "2026-second"),
  );
  // 旧レイアウト（410バイト）と、期のずれ
  const f1310 = P.parseFanFile(fileBytes("fan1310"), { id: "fan1310" });
  add(
    "fan1310（410バイト・出身地なし）: 異常0、期は 2014年1期（10月分は翌年の1期）、出身地はnull",
    f1310.anomalies.length === 0 &&
      same(f1310.layout_bytes, [410]) &&
      f1310.period.year === 2014 &&
      f1310.period.no === 1 &&
      f1310.records.every((r) => r.hometown === null),
    JSON.stringify(f1310.anomalies),
  );
  const f0110 = P.parseFanFile(fileBytes("fan0110"), { id: "fan0110" });
  const r310 = f0110.records.find((r) => r.racer_id === 310);
  add(
    "fan0110（最古・410バイト）: 登番0310、生年月日 S6=1931-05-18、2002年1期（算出 2001-05-01〜2001-10-31）",
    f0110.anomalies.length === 0 &&
      r310.birth_date === "1931-05-18" &&
      same(f0110.period, {
        year: 2002,
        no: 1,
        calc_from: "2001-05-01",
        calc_to: "2001-10-31",
      }),
    JSON.stringify([r310?.birth_date, f0110.period, f0110.anomalies]),
  );
  const f1904 = P.parseFanFile(fileBytes("fan1904"), { id: "fan1904" });
  add(
    "fan1904（416バイト）: 異常0、期は 2019年2期（算出 2018-11-01〜2019-04-30）、出身地あり",
    f1904.anomalies.length === 0 &&
      same(f1904.period, {
        year: 2019,
        no: 2,
        calc_from: "2018-11-01",
        calc_to: "2019-04-30",
      }) &&
      f1904.records.every((r) => r.hometown),
  );
  // 想定外の入力
  const bad = fileBytes("fan2604").slice(0, 418 * 3 + 6); // 3人分の後で途中で切れる
  const partial = P.parseFanFile(bad, { id: "fan2604" });
  add(
    "途中で切れたレコードは握りつぶさず anomalies に残る",
    partial.anomalies.some((a) => /レコード長/.test(a.problem)),
    JSON.stringify(partial.anomalies),
  );
  const wrongName = P.parseFanFile(fileBytes("fan2604"), {
    id: "fan2504",
  });
  add(
    "ファイル名と期が一致しない場合は anomalies に残る（fan2504 に fan2604 の内容）",
    wrongName.anomalies.some((a) => /一致しません/.test(a.problem)),
  );
  return results;
}

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

async function downloadTests(mods = { cli }) {
  const out = [];
  const add = (label, pass, detail = "") => out.push({ label, pass, detail });
  const C = mods.cli;

  // (a) 正常系: 全ファイルOK・生ファイルの保存・sha256・Last-Modified・最小間隔
  {
    const dir = newDir();
    const o = baseOpts(dir, { from: "fan2510", to: "fan2604" });
    const h = harness(() =>
      resp(200, lzh2604, "Mon, 29 Jun 2026 01:59:31 GMT"),
    );
    const code = await C.cmdDownload(o, h.deps);
    const m = manifestOf(dir);
    add(
      "download: 2ファイル取得（終了コード0）、URLは kibetsu/fan{YYMM}.lzh",
      code === 0 &&
        h.urls.length === 2 &&
        h.urls[0].endsWith("/kibetsu/fan2510.lzh"),
      `code=${code} urls=${h.urls}`,
    );
    add(
      "download: 生LZHをバイト単位で保存し、マニフェストに sha256・Last-Modified を記録",
      m.length === 2 &&
        m.every((e) => e.status === "ok" && e.sha256 && e.lastModified) &&
        Buffer.compare(
          fs.readFileSync(C.rawPath(dir, "fan2510")),
          Buffer.from(lzh2604),
        ) === 0,
    );
    add(
      "download: 全ての間隔が3秒以上（成功経路）",
      h.sleeps.length > 0 && h.sleeps.every((s) => s >= 3000),
      JSON.stringify(h.sleeps),
    );
    // 再実行で未取得なし
    const h2 = harness(() => resp(200, lzh2604));
    const code2 = await C.cmdDownload(o, h2.deps);
    add(
      "download: 再実行は取得済みをスキップ（リクエスト0）",
      code2 === 0 && h2.urls.length === 0,
    );
  }
  // (b) 403が2回連続 → 即停止（終了コード4）
  {
    const dir = newDir();
    const h = harness(() => resp(403));
    const code = await C.cmdDownload(baseOpts(dir), h.deps);
    add(
      "download: 403が2回連続で停止（終了コード4、リクエスト2回、間隔3秒以上）",
      code === 4 && h.urls.length === 2 && h.sleeps.every((s) => s >= 3000),
      `code=${code} n=${h.urls.length} sleeps=${h.sleeps}`,
    );
  }
  // (c) 503が3回連続 → バックオフ（30→60秒）して停止
  {
    const dir = newDir();
    const h = harness(() => resp(503));
    const code = await C.cmdDownload(baseOpts(dir), h.deps);
    add(
      "download: 503が3回連続で停止し、バックオフ（30秒→60秒）を挟む",
      code === 4 &&
        h.urls.length === 3 &&
        h.sleeps.includes(30000) &&
        h.sleeps.includes(60000),
      `code=${code} sleeps=${h.sleeps}`,
    );
  }
  // (d) 404が3回連続（想定外）→ 停止
  {
    const dir = newDir();
    const h = harness(() => resp(404));
    const code = await C.cmdDownload(baseOpts(dir, { to: "fan2510" }), h.deps);
    add(
      "download: 過去のファイルが404で3回連続すると停止（URL構造の変更・ブロックの疑い）",
      code === 4 && h.urls.length === 3,
      `code=${code} n=${h.urls.length}`,
    );
  }
  // (e) 最新の期のファイルが未公開（404）は想定内。完了扱いにせず、次回も試す
  {
    const dir = newDir();
    const o = baseOpts(dir, { from: "fan2510", to: "fan2604" });
    const h = harness((url) =>
      url.endsWith("fan2604.lzh") ? resp(404) : resp(200, lzh2604),
    );
    const code = await C.cmdDownload(o, h.deps);
    const m = manifestOf(dir);
    add(
      "download: 最新期の404は想定内（終了コード0、expected=true）",
      code === 0 && m.find((e) => e.key === "fan2604")?.expected === true,
      `code=${code}`,
    );
    const h2 = harness(() => resp(200, lzh2604));
    await C.cmdDownload(o, h2.deps);
    add(
      "download: 未公開だった最新期は、次回の実行で再取得される（fan2510は再取得しない）",
      h2.urls.length === 1 && h2.urls[0].endsWith("fan2604.lzh"),
      `urls=${h2.urls}`,
    );
  }
  // (f) LZHでない200が3回連続 → 停止、保存しない
  {
    const dir = newDir();
    const h = harness(() =>
      resp(200, new Uint8Array(Buffer.from("<html>blocked</html>"))),
    );
    const code = await C.cmdDownload(baseOpts(dir), h.deps);
    add(
      "download: LZHでない応答が3回連続で停止し、生ファイルを保存しない",
      code === 4 && !fs.existsSync(path.join(dir, "raw")),
      `code=${code}`,
    );
  }
  // (g) 窓の外・日次上限 → 安全停止（終了コード2）
  {
    const dir = newDir();
    const h = harness(() => resp(200, lzh2604), "2026-09-21T03:00:00Z"); // JST 12:00
    const code = await C.cmdDownload(
      baseOpts(dir, { window: "22-06" }),
      h.deps,
    );
    add(
      "download: 実行窓（JST 22-06）の外では、1件も取得せず安全停止（終了コード2）",
      code === 2 && h.urls.length === 0,
    );
    const dir2 = newDir();
    const h2 = harness(() => resp(200, lzh2604));
    const code2 = await C.cmdDownload(
      baseOpts(dir2, { dailyLimit: 2 }),
      h2.deps,
    );
    add(
      "download: 日次上限に到達すると安全停止（終了コード2、リクエストは上限まで）",
      code2 === 2 && h2.urls.length === 2,
      `code=${code2} n=${h2.urls.length}`,
    );
    const h3 = harness(() => resp(200, lzh2604), "2026-09-22T13:00:00Z");
    const code3 = await C.cmdDownload(
      baseOpts(dir2, { dailyLimit: 2 }),
      h3.deps,
    );
    add(
      "download: 翌日の再実行で続きから再開する（取得済みは再取得しない）",
      code3 === 2 &&
        h3.urls.length === 2 &&
        !h3.urls.some((u) =>
          manifestOf(dir2)
            .slice(0, 2)
            .some((e) => e.url === u),
        ),
      `urls=${h3.urls}`,
    );
  }
  // (h) 0件を成功にしない
  {
    const dir = newDir();
    const h = harness(() => resp(200, lzh2604));
    // 全て取得済みの状態で、planは何も取らない
    const o = baseOpts(dir, { from: "fan2604", to: "fan2604" });
    await C.cmdDownload(o, h.deps);
    const n = h.urls.length;
    const code = await C.cmdDownload(
      { ...o, dryRun: true },
      harness(() => resp(200)).deps,
    );
    add(
      "plan/--dry-run: ネットワークに接続しない（終了コード0）",
      code === 0 && n === 1,
    );
  }
  return out;
}

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
    `${fileName.replace(/\.js$/, "")}.mutant-${process.pid}.tmp.mjs`,
  );
  fs.writeFileSync(tmpFile, mutated);
  try {
    return await run(await import(`${tmpFile}?t=${Date.now()}`));
  } finally {
    fs.rmSync(tmpFile, { force: true });
  }
}

const parserMutants = [
  [
    "氏名の幅を16→15バイトにする（全角の桁ずれ）",
    [['["name", 16, "text", "名前漢字"],', '["name", 15, "text", "名前漢字"],']],
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
  ["算出期間（至）の桁数を8→7にする", [['["calc_to", 8, "raw", "算出期間（至）"],', '["calc_to", 7, "raw", "算出期間（至）"],']]],
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
    const dlTmp = path.join(
      LIB,
      `archiveDownloader.mutant-${process.pid}.tmp.mjs`,
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
      `fan-backfill.mutant-${process.pid}.tmp.mjs`,
    );
    fs.writeFileSync(dlTmp, mutatedDl);
    fs.writeFileSync(cliTmp, cliSrc);
    try {
      const mod = await import(`${cliTmp}?t=${Date.now()}`);
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

console.log(
  failures === 0
    ? "\n全ての検証に成功しました"
    : `\n${failures}件の検証に失敗しました`,
);
process.exit(failures === 0 ? 0 : 1);
