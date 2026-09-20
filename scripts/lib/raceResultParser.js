/**
 * 公式の結果ページ（boatrace.jp raceresult）の全項目パーサー（純関数。DB・取得先に接続しない）
 *
 * 目的: 結果ページを1回取得すれば、着欄の生表記・返還・不成立・同着・特払・進入・レースタイムまで
 * 全項目を取り出せるようにする（docs/design/race-result-full-fields/plan.md、全データ設計のN1〜N6）。
 * 旧実装（scripts/daily/scrape-results.js の parseRaceResultHtml）は、着欄を読まず表の先頭6行を着順とし、
 * 払戻の「不成立 ¥100」を金額として保存し、進入を読み違えていた（BOA-362・BOA-257）。
 *
 * ページの構造（2026-09-20に実ページ16件で確認。fixtures は scripts/lib/__fixtures__/raceresult/）:
 *   - 着順表（thead に「着」「ボートレーサー」）: 1艇1行（tbody>tr が6行。欠場艇も1行）。
 *       セル0=着欄（全角。「１」〜「６」・「Ｆ」・「Ｌ」・「欠」・「落」・「転」・「沈」・「妨」・「エ」・「＿」）、
 *       セル1=枠番、セル2=登番・氏名、セル3=レースタイム（1'50"7。完走できなかった艇・5〜6着は空欄）。
 *       完走した艇が先に、着順どおりに並ぶ。同着は同じ着が続く（「１」「１」「３」）。非完走の艇は最後に並ぶ
 *   - スタート情報（thead に「スタート情報」）: **行順が進入コース順**（1行目=1コース）。各行の
 *       .table1_boatImage1Number のテキストは「枠番」（進入コースではない。旧実装はこれを進入と読み違えた）。
 *       ST は「.07」、フライングは「F.04」、出遅れは「L」（数字なし）。先頭の1艇に決まり手が続く（「.07 逃げ」）。
 *       欠場艇の行は無い（5行になる）
 *   - 払戻表（thead に「勝式」「組番」）: 勝式ごとに tbody。組番の代わりに「不成立」（払戻金は返還の¥100）、
 *       「特払」（払戻金¥70）が入る。複勝で払戻金が空欄の艇がある（特払の勝者）。同着は同じ勝式の行が増える
 *   - 返還（thead に「返還」）: 返還艇の枠番。決まり手・備考（「【返還艇あり】」「【同着あり】」）
 *
 * 出力は、ページにある情報を型付きで全て持つ。DBへ入れる列の選択・旧形式への変換は呼び出し側
 * （scripts/lib/raceResultRows.js、scripts/daily/scrape-results.js）が行う。
 */

import * as cheerio from "cheerio";
import { scrapeConditions } from "./beforeinfoWeather.js";

export const RESULT_PARSER_VERSION = "raceresult/v1";

/**
 * 着欄の表記（NFKC正規化後）と意味。2026-09-20に実ページで確認できたものは observed=true。
 * refunded は、その艇への投票が返還されるか（返還表に載るか）。実ページの返還表で確認:
 * F・L・欠は返還、落・転・沈・妨・エは返還されない（着外扱い）。
 */
export const FINISH_MARKS = Object.freeze({
  F: {
    label: "フライング",
    refunded: true,
    observed: true,
    example: "戸田 2026-09-19 9R",
  },
  L: {
    label: "出遅れ",
    refunded: true,
    observed: true,
    example: "多摩川 2026-06-01 5R",
  },
  欠: {
    label: "欠場",
    refunded: true,
    observed: true,
    example: "唐津 2026-09-16 12R",
  },
  落: {
    label: "落水",
    refunded: false,
    observed: true,
    example: "若松 2026-09-11 1R",
  },
  転: {
    label: "転覆",
    refunded: false,
    observed: true,
    example: "多摩川 2026-09-10 12R",
  },
  沈: {
    label: "沈没",
    refunded: false,
    observed: true,
    example: "芦屋 2026-04-03 10R",
  },
  妨: {
    label: "妨害（失格）",
    refunded: false,
    observed: true,
    example: "若松 2026-09-11 1R",
  },
  エ: {
    label: "エンスト（推定。表記の意味は公式の凡例で未確認）",
    refunded: false,
    observed: true,
    example: "芦屋 2026-04-03 10R",
  },
  _: {
    label:
      "順位なし（5艇がFの不成立レースで、唯一フライングしなかった艇。全角の「＿」）",
    refunded: false,
    observed: true,
    example: "浜名湖 2026-09-14 6R",
  },
  失: {
    label: "失格（公式の表記として想定。実ページでは未観測）",
    refunded: false,
    observed: false,
    example: null,
  },
});

/** 払戻表の勝式名 → bet_type（新しい表の値）。3連単・3連複は、旧列名（payout_trifecta=3連複）の逆転を持ち込まない */
export const BET_TYPE_BY_LABEL = Object.freeze({
  単勝: "win",
  複勝: "place",
  "2連単": "2tan",
  "2連複": "2fuku",
  拡連複: "wide",
  "3連単": "3tan",
  "3連複": "3fuku",
});
const BET_TYPE_LABELS = Object.keys(BET_TYPE_BY_LABEL);

const FULL_BOAT_IMG = /img_boat2_(\d)\.png/;

/** 全角の英数・記号を半角にし、前後の空白（全角・nbspを含む）を落とす */
const normalizeText = (text) =>
  String(text ?? "")
    .normalize("NFKC")
    .trim();

/** 組番の正規化（旧実装 normalizeCombo と同じ。区切り「-」「=」「→」等を「-」に揃え、空白を除く） */
function normalizeCombo(text) {
  return text
    .replace(/[０-９]/g, (s) => String.fromCharCode(s.charCodeAt(0) - 0xfee0))
    .replace(/[→－−ー=]/g, "-")
    .replace(/\s+/g, "");
}

/**
 * レースタイム（1'50"7）を秒（110.7）にする。形式が違う・空欄は null。
 * @param {string|null} text
 */
export function parseRaceSeconds(text) {
  if (!text) return null;
  const m = /^(\d+)'(\d{2})"(\d)$/.exec(normalizeText(text));
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10;
}

/**
 * スタート情報のセルの文字列（「.07 逃げ」「F.04」「L」）から、ST・フライング・出遅れを取り出す。
 * 決まり手が続く場合があるため、先頭の語だけを見る。
 *
 * @param {string} cellText
 * @returns {{startTiming: number|null, isFlying: boolean, isLateStart: boolean}}
 */
export function parseStartCell(cellText) {
  const token = normalizeText(cellText).split(/\s+/)[0] ?? "";
  const m = /^([FL])?(?:\.(\d+))?$/.exec(token);
  if (!m) return { startTiming: null, isFlying: false, isLateStart: false };
  return {
    startTiming: m[2] !== undefined ? parseFloat(`0.${m[2]}`) : null,
    isFlying: m[1] === "F",
    isLateStart: m[1] === "L",
  };
}

/** 表を、thead の見出しの内容で特定する（位置に依存しない。位置依存で誤読した過去の不具合: 2026-09-09 桐生2R） */
function findTable($, includes) {
  let found = null;
  $(".is-w495, .is-w243").each((_, table) => {
    const head = $(table).find("thead").first().text();
    if (includes.every((word) => head.includes(word))) {
      found = $(table);
      return false;
    }
  });
  return found;
}

function parseBoats($, resultTable, startInfo) {
  const boats = [];
  if (!resultTable) return boats;
  resultTable.find("tbody tr").each((_, row) => {
    const cells = $(row).find("td");
    const boatNumber = parseInt(cells.eq(1).text().trim(), 10);
    if (!boatNumber || Number.isNaN(boatNumber)) return;
    const racerId = parseInt(
      $(cells.eq(2)).find(".is-fs12").first().text().trim(),
      10,
    );
    const mark = normalizeText(cells.eq(0).text());
    const raceTime = cells.eq(3).text().trim() || null;
    const start = startInfo.byBoat.get(boatNumber);
    boats.push({
      boat_number: boatNumber,
      racer_id: Number.isNaN(racerId) ? null : racerId,
      finish_mark: mark === "" ? null : mark,
      finish_rank: /^[1-6]$/.test(mark) ? Number(mark) : null,
      race_time: raceTime,
      race_seconds: parseRaceSeconds(raceTime),
      entry_course: start?.entryCourse ?? null,
      start_timing: start?.startTiming ?? null,
      is_flying: start?.isFlying ?? false,
      is_late_start: start ? start.isLateStart : mark === "L",
    });
  });
  return boats;
}

/** スタート情報の行を、行順（=進入コース順）で読む */
function parseStartInfo($, table) {
  const rows = [];
  const byBoat = new Map();
  if (!table) return { rows, byBoat };
  table.find(".table1_boatImage1").each((index, el) => {
    const imgSrc = $(el).find(".table1_boatImage1Boat img").attr("src") || "";
    const boatMatch = imgSrc.match(FULL_BOAT_IMG);
    const numberText = $(el).find(".table1_boatImage1Number").text().trim();
    // 枠番は、画像URLと、Numberセルの数字（枠番の色分け）の両方にある。旧実装は画像URLを使っていた
    const boatNumber = boatMatch
      ? parseInt(boatMatch[1], 10)
      : parseInt(numberText, 10);
    if (!boatNumber || Number.isNaN(boatNumber)) return;
    const start = parseStartCell($(el).find(".table1_boatImage1Time").text());
    // boatLabel は、行のNumberセルの数字（枠番の色分けの表示。進入コースではない）。旧実装の互換出力にだけ使う
    const boatLabel = parseInt(numberText, 10);
    const row = {
      boatNumber,
      boatLabel: Number.isNaN(boatLabel) ? null : boatLabel,
      entryCourse: index + 1,
      ...start,
    };
    rows.push(row);
    byBoat.set(boatNumber, row);
  });
  return { rows, byBoat };
}

/**
 * 払戻表を、行（勝式・組番・払戻・人気）へ展開する。
 *   paid       通常の払戻（組番あり・金額あり）
 *   special    特払（組番の位置が「特払」、金額70。実際に払われる額）
 *   no_amount  組番はあるが払戻金が空欄（特払の勝者の複勝）
 *   no_race    不成立（組番の位置が「不成立」。表示の¥100は返還額で、払戻ではない）
 *
 * @returns {{rows: Array<{bet_type: string, seq: number, combination: string|null, payout: number|null, payout_status: string, popularity: number|null}>, anomalies: string[]}}
 */
function parsePayouts($, table) {
  const rows = [];
  const anomalies = [];
  if (!table) return { rows, anomalies };
  let currentLabel = "";
  const seqByType = new Map();

  table.find("tbody tr").each((_, tr) => {
    const cells = $(tr).find("td");
    // 型ラベル行は4セル（勝式/組番/払戻金/人気）、継続行（複勝2口目・拡連複2〜3口目・同着）は3セル
    let offset;
    if (cells.length === 4) {
      const label = normalizeText(cells.eq(0).text());
      if (BET_TYPE_LABELS.includes(label)) currentLabel = label;
      offset = 1;
    } else if (cells.length === 3) {
      offset = 0;
    } else {
      return;
    }
    const comboText = normalizeText(cells.eq(offset).text());
    const amountText = normalizeText(cells.eq(offset + 1).text());
    const popularityText = normalizeText(cells.eq(offset + 2).text());
    if (comboText === "" && amountText === "") return; // 空の埋め行
    if (!currentLabel) {
      anomalies.push(`勝式が不明な払戻の行: ${comboText} ${amountText}`);
      return;
    }
    const betType = BET_TYPE_BY_LABEL[currentLabel];
    const seq = (seqByType.get(betType) ?? 0) + 1;
    seqByType.set(betType, seq);

    const amount = parseInt(amountText.replace(/[^0-9]/g, ""), 10);
    const popularity = parseInt(popularityText.replace(/[^0-9]/g, ""), 10);
    const base = {
      bet_type: betType,
      seq,
      popularity:
        Number.isNaN(popularity) || popularity <= 0 ? null : popularity,
    };

    if (comboText.startsWith("不成立")) {
      rows.push({
        ...base,
        combination: null,
        payout: null,
        payout_status: "no_race",
        popularity: null,
      });
    } else if (comboText.startsWith("特払")) {
      rows.push({
        ...base,
        combination: null,
        payout: Number.isNaN(amount) ? null : amount,
        payout_status: "special",
        popularity: null,
      });
      if (Number.isNaN(amount))
        anomalies.push(`特払の金額が読めない: ${currentLabel}`);
    } else if (/^[1-6]([-=→][1-6])*$/.test(comboText.replace(/\s+/g, ""))) {
      const combination = normalizeCombo(comboText);
      if (Number.isNaN(amount) || amount <= 0) {
        rows.push({
          ...base,
          combination,
          payout: null,
          payout_status: "no_amount",
        });
      } else {
        rows.push({
          ...base,
          combination,
          payout: amount,
          payout_status: "paid",
        });
      }
    } else {
      anomalies.push(`未知の組番の表記: ${currentLabel} 「${comboText}」`);
    }
  });
  return { rows, anomalies };
}

/**
 * レースの状態を、払戻の状態と返還艇から決める。
 *   no_race         全ての勝式が不成立
 *   partial_refund  返還艇がある、または一部の勝式が不成立（残りは通常どおり払われる）
 *   normal          返還も不成立も無い
 * 払戻表が読めなかった（払戻の行が0件）場合は、判定できないため null。
 *
 * @param {Array<{payout_status: string}>} payoutRows
 * @param {number[]} refundBoats
 * @returns {"normal"|"partial_refund"|"no_race"|null}
 */
export function classifyRaceStatus(payoutRows, refundBoats) {
  if (payoutRows.length === 0) return null;
  const noRace = payoutRows.filter((r) => r.payout_status === "no_race").length;
  if (noRace === payoutRows.length) return "no_race";
  if (noRace > 0 || refundBoats.length > 0) return "partial_refund";
  return "normal";
}

/**
 * 結果ページのHTMLを、全項目つきで解析する（純関数）。
 * 着順表・払戻表のどちらも無い（未公開・構造の違い）ページでも、例外にせず、空の項目を返す
 * （公開済みかの判断は、呼び出し側が boats・payouts の有無で行う）。解析中の想定外は握りつぶさず、
 * anomalies に残す（呼び出し側がログ・監視に出す）。
 *
 * @param {string} html
 */
export function parseRaceResultPage(html) {
  const $ = cheerio.load(html);
  const anomalies = [];

  const resultTable = findTable($, ["着", "ボートレーサー"]);
  const startTable = findTable($, ["スタート情報"]);
  const payoutTable = findTable($, ["勝式", "組番"]);
  const refundTable = findTable($, ["返還"]);
  const techniqueTable = findTable($, ["決まり手"]);
  const remarkTable = findTable($, ["備考"]);

  const startInfo = parseStartInfo($, startTable);
  const boats = parseBoats($, resultTable, startInfo);
  for (const boat of boats) {
    const mark = boat.finish_mark;
    if (mark !== null && boat.finish_rank === null && !(mark in FINISH_MARKS)) {
      anomalies.push(`未知の着欄の表記: 枠${boat.boat_number} 「${mark}」`);
    }
  }
  if (boats.length > 0) {
    const names = new Set(boats.map((b) => b.boat_number));
    if (names.size !== boats.length) {
      anomalies.push(
        `着順表に艇番の重複がある: ${boats.map((b) => b.boat_number).join(",")}`,
      );
    }
    const stBoats = new Set(startInfo.rows.map((r) => r.boatNumber));
    for (const boat of boats) {
      if (boat.finish_mark !== "欠" && !stBoats.has(boat.boat_number)) {
        // 欠場艇以外でスタート情報に行が無い艇は、進入コースが取れない（構造の変化の疑い）
        if (startInfo.rows.length > 0) {
          anomalies.push(`スタート情報に行が無い艇: 枠${boat.boat_number}`);
        }
      }
    }
  }

  const refundBoats = [];
  if (refundTable) {
    refundTable.find(".numberSet1_number").each((_, el) => {
      const n = parseInt($(el).text().trim(), 10);
      if (n >= 1 && n <= 6 && !refundBoats.includes(n)) refundBoats.push(n);
    });
    refundBoats.sort((a, b) => a - b);
  }

  const { rows: payoutRows, anomalies: payoutAnomalies } = parsePayouts(
    $,
    payoutTable,
  );
  anomalies.push(...payoutAnomalies);

  const winningTechnique =
    (techniqueTable
      ? techniqueTable.find("tbody td").first().text().trim()
      : "") || null;
  const remarkText = remarkTable
    ? normalizeText(remarkTable.find("tbody td").first().text())
    : "";

  return {
    parser_version: RESULT_PARSER_VERSION,
    /** 着順表の行（表の行順）。欠場艇も1行 */
    boats,
    /** スタート情報の行（行順=進入コース順）。欠場艇の行は無い */
    start_info: startInfo.rows,
    refund_boats: refundBoats,
    remark: remarkText === "" ? null : remarkText,
    winning_technique: winningTechnique,
    payouts: payoutRows,
    race_status: classifyRaceStatus(payoutRows, refundBoats),
    weather: scrapeConditions($),
    anomalies,
  };
}
