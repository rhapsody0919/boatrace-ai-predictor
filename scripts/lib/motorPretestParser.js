/**
 * 公式のモーター抽選結果・前検タイム（boatrace.jp race/rankingmotor）のパーサー（純関数。DB・取得先に接続しない）
 *
 * 目的: 節の全選手の前検タイムと、モーター・ボートの番号・2連対率を取り出す（N23。docs/design/scraping-vercel-consolidation/
 * data-catalog.md §2.7、BOA-266）。日次ジョブ（scripts/lib/motorPretestJob.js）と、過去分の一括取得CLI
 * （scripts/maintenance/motor-pretest-backfill.js）が、このパーサーを共有する。
 *
 * ページの構造（2026-09-21に実ページ13件で確認。fixtures は scripts/lib/__fixtures__/motorPretest/）:
 *   - URL: race/rankingmotor?jcd=会場コード2桁&hd=YYYYMMDD。会場×日で1ページ。過去日も取得できる（2025-12-03で確認）
 *   - 見出し: `.heading2_area img`（text_place2_NN.png が会場）、`h2.heading2_titleName`（開催名）。タブのリンクの `hd=`（日付）
 *   - 表: `.table1 table`。thead は2段（1段目: 順位・登録番号・ボートレーサー・級別・モーター(2列)・ボート(2列)・前検タイム、
 *     2段目: 番号・2連対率・番号・2連対率）。tbody が選手ごとに1つ（`tr` に `td` 9つ）。節の全選手（約45人。開催日に走らない選手も含む）
 *   - **「順位」は、表示中の並び順の順位**（既定の並びは、モーターの2連対率の降順）。前検タイムの順位ではない。
 *     前検タイムの昇順で並べたページ（sort=5）の順位と、本パーサーが前検タイムから計算する順位（同じ値は同順位）が一致することを、
 *     fixtures（rankingmotor_18_20260921_sort5.html）で検証している。前検順位はページの順位を読まず、前検タイムから計算する
 *   - 2連対率は「66.6%」のように小数第1位までの表示（race_entries.motor_2rate・boat_2rate は小数第2位で、同じ値の
 *     高精度版）。モーター番号・ボート番号も race_entries と同じ値。**このページにしか無い新しい情報は、前検タイムのみ**
 *   - データが無いとき（開催が無い日・会場）: 表が無く、`.heading1_mainLabel` に「データがありません。」
 *
 * 項目の解釈は位置ではなく、見出しのラベルで行う。未知のラベル・必須のラベルの欠落・想定外のセルは、`anomalies` に残し、
 * status = "unrecognized" とする（黙って一部だけを返さない。呼び出し側が parse_anomaly として扱う）。
 */

import * as cheerio from "cheerio";

export const MOTOR_PRETEST_PARSER_VERSION = "rankingmotor/v1";

export const MOTOR_PRETEST_STATUSES = Object.freeze({
  /** 表を解析できた */
  ok: "ok",
  /** 「データがありません」（開催が無い日・会場） */
  noData: "no_data",
  /** 想定外の構造 */
  unrecognized: "unrecognized",
});

/** 見出しのラベル（多段は「親/子」）。値は、行のフィールドの名前（null は、読むが保存しない列） */
const KNOWN_HEADERS = Object.freeze({
  順位: null,
  登録番号: "racer_id",
  ボートレーサー: null,
  級別: "racer_class",
  "モーター/番号": "motor_number",
  "モーター/2連対率": "motor_2rate",
  "ボート/番号": "boat_number",
  "ボート/2連対率": "boat_2rate",
  前検タイム: "pretest_time",
});
const REQUIRED_FIELDS = [
  "racer_id",
  "racer_class",
  "motor_number",
  "motor_2rate",
  "boat_number",
  "boat_2rate",
  "pretest_time",
];

const nfkc = (s) => (s ?? "").normalize("NFKC");
const squash = (s) =>
  nfkc(s)
    .replace(/[\s\u3000]+/g, " ")
    .trim();

/** 会場コード（数値）・日付（YYYY-MM-DD）から、公式のURLを作る */
export function buildMotorPretestUrl(venueCode, date) {
  const code = Number(venueCode);
  if (!Number.isInteger(code) || code < 1 || code > 24) {
    throw new Error(`会場コードが不正です: ${String(venueCode)}`);
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date));
  if (!m)
    throw new Error(`日付の形式が不正です（YYYY-MM-DD）: ${String(date)}`);
  return `https://www.boatrace.jp/owpc/pc/race/rankingmotor?jcd=${String(code).padStart(2, "0")}&hd=${m[1]}${m[2]}${m[3]}`;
}

/**
 * thead（2段）から、列ごとのラベルを作る。rowspan・colspan を展開し、多段のラベルは「親/子」にする
 * （同じ th が2段にまたがる列は、そのラベルのみ）。
 *
 * @returns {string[]} 列ごとのラベル
 */
export function readHeaderLabels($, thead) {
  const grid = [];
  $(thead)
    .find("tr")
    .each((r, tr) => {
      grid[r] = grid[r] ?? [];
      let c = 0;
      $(tr)
        .children("th")
        .each((_, th) => {
          while (grid[r][c] !== undefined) c++;
          const colspan = Number($(th).attr("colspan") ?? 1);
          const rowspan = Number($(th).attr("rowspan") ?? 1);
          const label = squash($(th).text());
          for (let dr = 0; dr < rowspan; dr++) {
            grid[r + dr] = grid[r + dr] ?? [];
            for (let dc = 0; dc < colspan; dc++) {
              grid[r + dr][c + dc] = { label, id: `${r}:${c}` };
            }
          }
          c += colspan;
        });
    });
  const width = Math.max(0, ...grid.map((row) => row.length));
  return Array.from({ length: width }, (_, c) => {
    const parts = [];
    let lastId = null;
    for (const row of grid) {
      const cell = row[c];
      if (!cell || cell.id === lastId) continue;
      lastId = cell.id;
      if (cell.label !== "") parts.push(cell.label);
    }
    return parts.join("/");
  });
}

/** 「66.6%」→ 66.6。空・「-」は null。それ以外は undefined（想定外） */
function parsePercent(text) {
  const t = squash(text);
  if (t === "" || /^[-－ー]+$/.test(t)) return null;
  const m = /^(\d{1,3}(?:\.\d)?)%$/.exec(t);
  return m ? Number(m[1]) : undefined;
}

/** 「6.65」→ 6.65。空・「-」は null。それ以外は undefined */
function parseTime(text) {
  const t = squash(text);
  if (t === "" || /^[-－ー]+$/.test(t)) return null;
  return /^\d\.\d{2}$/.test(t) ? Number(t) : undefined;
}

/** 前検タイムの昇順の順位（同じ値は同順位、次は飛ぶ。1・2・2・4）。null は順位なし */
export function competitionRanks(values) {
  return values.map((v) =>
    v === null ? null : values.filter((o) => o !== null && o < v).length + 1,
  );
}

/**
 * @param {string} html
 * @returns {{
 *   status: "ok"|"no_data"|"unrecognized",
 *   parserVersion: string,
 *   venueCode: number|null,
 *   date: string|null,
 *   seriesTitle: string|null,
 *   rows: Array<{racer_id: number, racer_class: string, motor_number: number, motor_2rate: number|null,
 *     boat_number: number, boat_2rate: number|null, pretest_time: number|null, pretest_rank: number|null}>,
 *   anomalies: string[],
 * }}
 */
export function parseMotorPretestHtml(html) {
  const $ = cheerio.load(html);
  const base = {
    parserVersion: MOTOR_PRETEST_PARSER_VERSION,
    venueCode: null,
    date: null,
    seriesTitle: null,
    rows: [],
    anomalies: [],
  };

  const table = $(".table1 table").first();
  if (table.length === 0) {
    if (
      squash($(".heading1_mainLabel").text()).includes("データがありません")
    ) {
      return { ...base, status: MOTOR_PRETEST_STATUSES.noData };
    }
    return {
      ...base,
      status: MOTOR_PRETEST_STATUSES.unrecognized,
      anomalies: ["table_not_found"],
    };
  }

  const venueImage = $(".heading2_area img").first().attr("src") ?? "";
  const venueMatch = /text_place2_(\d{2})\./.exec(venueImage);
  const hdMatch = /[?&]hd=(\d{4})(\d{2})(\d{2})/.exec(
    $(".tab3_tabs a[href*='hd=']").first().attr("href") ?? "",
  );
  const meta = {
    venueCode: venueMatch ? Number(venueMatch[1]) : null,
    date: hdMatch ? `${hdMatch[1]}-${hdMatch[2]}-${hdMatch[3]}` : null,
    seriesTitle: squash($(".heading2_titleName").first().text()) || null,
  };

  const anomalies = [];
  const labels = readHeaderLabels($, table.find("thead").first());
  const fieldByColumn = labels.map((label) => {
    if (!(label in KNOWN_HEADERS)) {
      anomalies.push(`unknown_header:${label || "(空)"}`);
      return null;
    }
    return KNOWN_HEADERS[label];
  });
  for (const field of REQUIRED_FIELDS) {
    if (!fieldByColumn.includes(field))
      anomalies.push(`missing_header:${field}`);
  }
  if (anomalies.length > 0) {
    return {
      ...base,
      ...meta,
      status: MOTOR_PRETEST_STATUSES.unrecognized,
      anomalies,
    };
  }

  const rows = [];
  const seen = new Set();
  table.find("tbody tr").each((i, tr) => {
    const cells = $(tr)
      .children("td")
      .map((_, td) => squash($(td).text()))
      .get();
    if (cells.length !== labels.length) {
      anomalies.push(`row_shape:${i + 1}:${cells.length}列`);
      return;
    }
    const raw = {};
    fieldByColumn.forEach((field, c) => {
      if (field) raw[field] = cells[c];
    });
    const racerId = /^\d{4}$/.test(raw.racer_id) ? Number(raw.racer_id) : null;
    const racerClass = /^(A1|A2|B1|B2)$/.test(raw.racer_class)
      ? raw.racer_class
      : null;
    const motorNumber = /^\d{1,3}$/.test(raw.motor_number)
      ? Number(raw.motor_number)
      : null;
    const boatNumber = /^\d{1,3}$/.test(raw.boat_number)
      ? Number(raw.boat_number)
      : null;
    const motor2 = parsePercent(raw.motor_2rate);
    const boat2 = parsePercent(raw.boat_2rate);
    const time = parseTime(raw.pretest_time);
    const problems = [
      racerId === null && `登録番号=${raw.racer_id}`,
      racerClass === null && `級別=${raw.racer_class}`,
      motorNumber === null && `モーター番号=${raw.motor_number}`,
      boatNumber === null && `ボート番号=${raw.boat_number}`,
      motor2 === undefined && `モーター2連対率=${raw.motor_2rate}`,
      boat2 === undefined && `ボート2連対率=${raw.boat_2rate}`,
      time === undefined && `前検タイム=${raw.pretest_time}`,
    ].filter(Boolean);
    if (problems.length > 0) {
      anomalies.push(`bad_cell:${i + 1}:${problems.join(",")}`);
      return;
    }
    if (seen.has(racerId)) {
      anomalies.push(`duplicate_racer:${racerId}`);
      return;
    }
    seen.add(racerId);
    rows.push({
      racer_id: racerId,
      racer_class: racerClass,
      motor_number: motorNumber,
      motor_2rate: motor2,
      boat_number: boatNumber,
      boat_2rate: boat2,
      pretest_time: time,
      pretest_rank: null,
    });
  });

  if (anomalies.length === 0 && rows.length === 0) {
    anomalies.push("no_rows");
  }
  if (anomalies.length > 0) {
    return {
      ...base,
      ...meta,
      status: MOTOR_PRETEST_STATUSES.unrecognized,
      anomalies,
    };
  }

  const ranks = competitionRanks(rows.map((r) => r.pretest_time));
  return {
    ...base,
    ...meta,
    status: MOTOR_PRETEST_STATUSES.ok,
    rows: rows.map((row, i) => ({ ...row, pretest_rank: ranks[i] })),
  };
}
