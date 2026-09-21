/**
 * 公式の直前情報ページ（boatrace.jp beforeinfo）の全項目パーサー（純関数。DB・取得先に接続しない）
 *
 * 目的: 直前情報を1回取得すれば、展示タイム・チルト・プロペラ・部品交換・調整重量・当日体重・前走成績・
 * スタート展示（進入コース順・ST・F/L表記）・欠場艇の表示・気象まで全項目を取り出せるようにする
 * （docs/design/pre-race-full-fields/plan.md、全データ設計のN9・N10・N11）。
 * 旧実装（scripts/daily/scrape-exhibition-data.js の scrapeExhibitionData）は、スタート展示の行順（進入）と
 * F/L表記を解析して捨て、欠場艇の表示を読まず、前走の着順が数字でない（F・欠等）ときの内容を落としていた
 * （凍結した旧実装: scripts/lib/__fixtures__/beforeinfo/legacyExhibitionParser.js）。
 *
 * ページの構造（2026-09-21に実ページ8件で確認。fixtures は scripts/lib/__fixtures__/beforeinfo/）:
 *   - `.table1` は3つ: [0]=締切予定時刻の表（racelistと同じ）、[1]=直前情報の表、[2]=スタート展示の表
 *   - 直前情報の表（`tbody.is-fs12` が1艇1つ、6つ）。欠場艇は `class="is-fs12 is-miss"`（唐津 2026-09-16 12R の1号艇。
 *       体重だけが入り、展示タイム・チルト・プロペラは空）。1つの tbody は4行:
 *       1行目=[枠][写真][氏名（登番はリンクの toban=）][体重][展示タイム][チルト][プロペラ（「新」）][部品交換 li][「R」][前走のレース番号]
 *       2行目=[「進入」][前走の進入]、3行目=[調整重量][「ST」][前走のST]、4行目=[「着順」][前走の着順（全角）]
 *       前走のレース番号のセルの色（is-boatColor）は前走の枠番で、前走のレース番号があれば自社DBから導出できるため読まない
 *   - スタート展示（`.table1_boatImage1` が1艇1行）: **行順がコース順**（1行目=1コース）。欠場艇の行は無い（5行になる）。
 *       STは「.13」、フライングは「F.01」（`is-fColor1`）。展示航走前は行自体が無い
 *   - 気象（`.weather1`）: beforeinfoWeather.js の解析をそのまま使う。タイトルは「HH:MM現在」または「N R時点」
 *     （過去日は、その日の最後の観測が返る点に注意）
 *
 * 出力は、ページにある情報を型付きで全て持つ。DBへ入れる列の選択・旧形式への変換は呼び出し側
 * （scripts/lib/preRaceRows.js、scripts/daily/scrape-exhibition-data.js）が行う。
 */

import * as cheerio from "cheerio";
import { scrapeConditions } from "./beforeinfoWeather.js";
import { normalizeText, toIntOrNull } from "./venueMotorStats/parserUtils.js";

export const BEFOREINFO_PARSER_VERSION = "beforeinfo/v1";

/** 全角を半角にし、前後の空白を落とす（NFKC。着順の「５」→「5」、「Ｆ」→「F」） */
const nfkc = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .trim();

/**
 * スタート展示のSTの表記（「.13」「F.01」「L.05」「L」）から、ST・F/L を取り出す。
 * 旧実装（parseStartTimingText）は F の有無だけを持っていた。L も区別する。
 *
 * @param {string} text
 * @returns {{value: number|null, flag: "F"|"L"|null}}
 */
export function parseStartExhibitionCell(text) {
  const t = nfkc(text);
  if (!t) return { value: null, flag: null };
  const flag = t.startsWith("F") ? "F" : t.startsWith("L") ? "L" : null;
  const num = t.match(/[FL]?\.(\d+)/);
  return { value: num ? parseFloat(`0.${num[1]}`) : null, flag };
}

const toPositive = (n) => (Number.isNaN(n) || !(n > 0) ? null : n);

/** 直前情報の表の1艇分（tbody）を読む */
function parseBoat($, tbody) {
  const $tbody = $(tbody);
  const rows = $tbody.find("tr");
  const mainCells = rows.eq(0).find("td");
  const boatNumber = parseInt(mainCells.eq(0).text().trim(), 10);

  const toban = /toban=(\d+)/.exec(
    mainCells.eq(2).find("a").attr("href") ||
      mainCells.eq(1).find("a").attr("href") ||
      "",
  );
  const weight = parseFloat(mainCells.eq(3).text().trim());
  const exhibitionTime = parseFloat(mainCells.eq(4).text().trim());
  const tilt = parseFloat(mainCells.eq(5).text().trim());
  const propellerText = mainCells.eq(6).text().trim();
  const partsChanged = mainCells
    .eq(7)
    .find("li")
    .map((_, li) => $(li).text().trim())
    .get()
    .filter(Boolean);
  const prevRaceNo = parseInt(mainCells.eq(9).text().trim(), 10);
  const adjustmentWeight = parseFloat(
    rows.eq(2).find("td").eq(0).text().trim(),
  );
  const prevEntryCourse = parseInt(
    rows.eq(1).find("td").eq(1).text().trim(),
    10,
  );
  const prevStart = parseStartExhibitionCell(
    rows.eq(2).find("td").eq(2).text().trim(),
  );
  const prevFinishText = nfkc(rows.eq(3).find("td").eq(1).text());

  return {
    boat_number: boatNumber,
    racer_id: toban ? parseInt(toban[1], 10) : null,
    player_name: mainCells.eq(2).text().trim() || null,
    is_absent: $tbody.hasClass("is-miss"),
    weight_kg: toPositive(weight),
    exhibition_time: toPositive(exhibitionTime),
    tilt: Number.isNaN(tilt) ? null : tilt,
    propeller_text: propellerText || null,
    parts_changed: partsChanged,
    adjustment_weight: Number.isNaN(adjustmentWeight) ? null : adjustmentWeight,
    prev_race_no: Number.isNaN(prevRaceNo) ? null : prevRaceNo,
    prev_entry_course: Number.isNaN(prevEntryCourse) ? null : prevEntryCourse,
    prev_start_timing: prevStart.value,
    // 着順の生表記（1〜6・F・欠・落・転 等）と、数字のときの着。数字でない前走は、mark だけに残る
    prev_finish_mark: prevFinishText || null,
    prev_finish_rank: toIntOrNull(rows.eq(3).find("td").eq(1).text().trim()),
    // スタート展示の欄（以下は、表を読んだ後に埋める）
    exhibition_course: null,
    start_timing: null,
    start_flag: null,
  };
}

/** スタート展示の表を、行順（=コース順）で読む。表が無い・展示航走前は空配列 */
function parseStartExhibition($, table) {
  const rows = [];
  if (!table) return rows;
  table.find(".table1_boatImage1").each((index, el) => {
    const boatText =
      $(el).find(".table1_boatImage1Number").text().trim() ||
      $(el).text().trim().split("\n")[0].trim();
    const boatNumber = parseInt(boatText, 10);
    if (!(boatNumber >= 1 && boatNumber <= 6)) return;
    const cell = parseStartExhibitionCell(
      $(el).find(".table1_boatImage1Time").text().trim(),
    );
    rows.push({
      boat_number: boatNumber,
      course: index + 1,
      start_timing: cell.value,
      start_flag: cell.flag,
    });
  });
  return rows;
}

/** 距離・ラベル（racelist と同じ書式の見出し） */
function parseHeading($) {
  const detail = normalizeText($(".title16_titleDetail__add2020").text());
  const distance = /(\d{3,4})\s*m/.exec(detail.normalize("NFKC"));
  const labels = $(".title16_titleLabels__add2020 .label2")
    .map((_, el) => $(el).text().trim())
    .get()
    .filter(Boolean);
  return { distanceM: distance ? parseInt(distance[1], 10) : null, labels };
}

/**
 * 直前情報ページ（cheerio）の全項目を解析する。
 * @param {import("cheerio").CheerioAPI} $
 */
export function parseBeforeInfoDocument($) {
  const anomalies = [];
  const tables = $(".table1");
  // 表は、内容で特定する（直前情報の表=艇ごとの tbody.is-fs12、スタート展示の表=.table1_boatImage1）。
  // 内容で特定できないとき（クラスの変更・展示航走前の空の表）は、旧実装と同じ位置（2つ目・3つ目の .table1）を使う
  let mainTable = null;
  let startTable = null;
  tables.each((_, el) => {
    const $el = $(el);
    if (!mainTable && $el.find("tbody.is-fs12").length > 0) mainTable = $el;
    else if (!startTable && $el.find(".table1_boatImage1").length > 0) {
      startTable = $el;
    }
  });
  if (!mainTable && tables.length >= 2) mainTable = tables.eq(1);
  if (!startTable && tables.length >= 3) startTable = tables.eq(2);

  const boats = [];
  if (mainTable) {
    const classed = mainTable.find("tbody.is-fs12");
    (classed.length > 0 ? classed : mainTable.find("tbody")).each(
      (index, tbody) => {
        if (index >= 6) return false;
        const boat = parseBoat($, tbody);
        if (boat.boat_number >= 1 && boat.boat_number <= 6) boats.push(boat);
      },
    );
  }

  const startRows = parseStartExhibition($, startTable);
  for (const row of startRows) {
    const boat = boats.find((b) => b.boat_number === row.boat_number);
    if (!boat) continue;
    boat.exhibition_course = row.course;
    boat.start_timing = row.start_timing;
    boat.start_flag = row.start_flag;
  }
  const expectedRows = boats.filter((b) => !b.is_absent).length;
  if (startRows.length > 0 && startRows.length !== expectedRows) {
    anomalies.push(`start_exhibition_rows:${startRows.length}/${expectedRows}`);
  }
  if (boats.length !== 0 && boats.length !== 6) {
    anomalies.push(`boats_count:${boats.length}`);
  }

  let conditions = null;
  try {
    conditions = scrapeConditions($);
  } catch (error) {
    anomalies.push(`weather_parse_error:${error.message}`);
  }

  return {
    parser_version: BEFOREINFO_PARSER_VERSION,
    tables_count: tables.length,
    ...parseHeading($),
    boats,
    start_exhibition: {
      published: startRows.length > 0,
      order: startRows.map((row) => row.boat_number),
    },
    conditions,
    anomalies,
  };
}

/**
 * 直前情報ページのHTMLの全項目を解析する。
 * @param {string} html
 */
export function parseBeforeInfoPage(html) {
  return parseBeforeInfoDocument(cheerio.load(html));
}
