/**
 * 公式の出走表ページ（boatrace.jp racelist）の全項目パーサー（純関数。DB・取得先に接続しない）
 *
 * 目的: 出走表を1回取得すれば、選手の登録体重・支部/出身地・F数・L数・平均ST、締切予定時刻（同日12レース分）、
 * レースラベル（安定板使用等）・距離、欠場艇の表示まで全項目を取り出せるようにする
 * （docs/design/pre-race-full-fields/plan.md、全データ設計のN13・N14・N15・N17・N18）。
 * 旧実装（scripts/daily/update-race-info.js の scrapeRacers・scrapeRaceMeta）は、これらを解析して捨てていた
 * （凍結した旧実装: scripts/lib/__fixtures__/raceInfo/legacyRaceListParser.js）。
 *
 * ページの構造（2026-09-21に実ページ12件で確認。fixtures は scripts/lib/__fixtures__/raceInfo/）:
 *   - ヘッダ `.heading2_title`: クラスに開催のグレード（is-G1b・is-G3b・is-ippan 等）、`.heading2_titleName` に開催名
 *   - 日程タブ `.tab2_inner`: 開催日数分。当日だけ `<li class="is-active2">`（「初日」「Ｎ日目」「最終日」）
 *   - 締切予定時刻の表（`.table1.h-mt10`）: 同日12レース分の時刻の行。races.start_time と同じ値（日中に1分〜変わることがある。
 *     唐津 2026-09-16 8R は、朝の値 12:04 が、ページでは 12:05）
 *   - `.title16_titleDetail__add2020`: 「予選 1800m」形式（ステージ名と距離。間に全角空白。距離は1200m・1800mを確認）、
 *     `.title16_titleLabels__add2020 .label2`: レースラベル（「安定板使用」= is-type1。他の種類は未観測）
 *   - 出走表 `.table1 tbody.is-fs12`（1艇1つ、6つ）: 欠場艇は `class="is-miss is-fs12"`（唐津 2026-09-16 12R の1号艇）。
 *       セル（td.is-lineH2）: [F数/L数/平均ST][全国 勝率/2連率/3連率][当地 同][モーター No/2連率/3連率][ボート 同]。
 *       `.is-fs11` の1つ目「登番 / 級別」、2つ目「支部/出身地」と「年齢/体重」（<br>区切り）。「-」はデータなし（集計期間内）
 *   - 「モーター・ボート変更時は赤で表示されます。」の注記があるが、変更のあった艇（児島 2026-09-21 7R の5号艇: ボート30→42）の
 *     ページでも、赤の表示（is-fColor 系のクラス）は無かった。変更の検出は、この解析では行わない
 *     （導出: 同じ選手・節の前回の値との比較。plan.md）。モーター・ボートのセルに未知の is-fColor 系が現れたら anomalies に記録する
 *
 * 出力は、ページにある情報を型付きで全て持つ。DBへ入れる列の選択・旧形式への変換は呼び出し側
 * （scripts/lib/preRaceRows.js、scripts/daily/update-race-info.js）が行う。
 */

import * as cheerio from "cheerio";
import { normalizeText as normalizeDigits } from "./venueMotorStats/parserUtils.js";
import { scrapeRaceStage } from "./raceStageParser.js";

export const RACELIST_PARSER_VERSION = "racelist/v1";

const toFloat = (s) => {
  const v = parseFloat(s);
  return Number.isNaN(v) ? null : v;
};
const toInt = (s) => {
  const v = parseInt(s, 10);
  return Number.isNaN(v) ? null : v;
};

/** <br>区切りのセルを、行の配列にする（HTMLに改行が無くても分けられる） */
function splitCellLines($, el) {
  const html = $(el).html() ?? "";
  return html
    .split(/<br\s*\/?>/i)
    .map((chunk) => cheerio.load(`<i>${chunk}</i>`)("i").text().trim())
    .filter(Boolean);
}

/** 開催のグレード。旧実装（scrapeRaceMeta）と同じ規則: SG・G1・G2・G3、その他は ippan、ヘッダが無ければ null */
function parseGrade($) {
  const el = $(".heading2_title");
  if (!el.length) return { gradeClass: null, raceGrade: null };
  const classAttr = el.attr("class") || "";
  const gradeClass =
    classAttr.split(/\s+/).find((c) => /^is-/.test(c) && c !== "is-title") ??
    null;
  const cls = classAttr.toLowerCase();
  let raceGrade = "ippan";
  if (cls.includes("is-sg")) raceGrade = "SG";
  else if (cls.includes("is-g1")) raceGrade = "G1";
  else if (cls.includes("is-g2")) raceGrade = "G2";
  else if (cls.includes("is-g3")) raceGrade = "G3";
  return { gradeClass, raceGrade };
}

/**
 * 日程タブ（`.tab2_inner`）から開催の何日目かを取得する（BOA-226、series_day/is_final_day。旧実装と同じ規則）。
 *
 * 日程タブは開催日数分の`<li>`が並び、当日に対応する要素だけ`<li class="is-active2">`で囲まれる
 * （過去日はリンク付き`<a>`、未来日はリンク無し`<span>`だが、当日判定にリンクの有無は使えない）。
 * ラベルは「初日」「Ｎ日目」「最終日」の3パターン（全角数字）。
 */
export function scrapeSeriesDay($) {
  const tabs = $(".tab2_inner");
  const totalDays = tabs.length;
  if (totalDays === 0) {
    return { seriesDay: null, isFinalDay: null, totalDays: null };
  }

  let label = null;
  tabs.each((i, el) => {
    const $el = $(el);
    if ($el.closest("li").hasClass("is-active2")) {
      label = $el.find("span").first().text().trim();
      return false;
    }
  });
  if (!label) return { seriesDay: null, isFinalDay: null, totalDays };

  const isFinalDay = label === "最終日";
  let seriesDay = null;
  if (label === "初日") {
    seriesDay = 1;
  } else if (isFinalDay) {
    seriesDay = totalDays;
  } else {
    const match = label.match(/([０-９]+)日目/);
    if (match) {
      const n = parseInt(normalizeDigits(match[1]), 10);
      seriesDay = isNaN(n) ? null : n;
    }
  }
  return { seriesDay, isFinalDay, totalDays };
}

/**
 * 開催・レースのメタ情報（グレード・開催名・ステージ名・日目・距離・ラベル）。旧実装の scrapeRaceMeta と同じ値に、
 * 距離・ラベル・総日数・グレードの生のクラスを加える。
 */
export function scrapeRaceMeta($) {
  const { gradeClass, raceGrade } = parseGrade($);
  const raceTitle = $(".heading2_titleName").text().trim() || null;
  const raceStage = scrapeRaceStage($);
  const { seriesDay, isFinalDay, totalDays } = scrapeSeriesDay($);
  const detailText = normalizeDigits(
    $(".title16_titleDetail__add2020").text(),
  ).replace(/\s+/g, " ");
  const distance = /(\d{3,4})\s*m/.exec(detailText);
  const labels = $(".title16_titleLabels__add2020 .label2")
    .map((_, el) => ({
      text: $(el).text().trim(),
      type:
        ($(el).attr("class") || "")
          .split(/\s+/)
          .find((c) => /^is-type\d+$/.test(c)) ?? null,
    }))
    .get()
    .filter((label) => label.text !== "");
  return {
    gradeClass,
    raceGrade,
    raceTitle,
    raceStage,
    seriesDay,
    isFinalDay,
    totalDays,
    distanceM: distance ? parseInt(distance[1], 10) : null,
    labels,
  };
}

/**
 * 締切予定時刻の表（同日12レース分）。表は、行見出しに「締切予定時刻」を持つ `.table1`。
 * 時刻が空（中止・順延等）のレースは time=null。
 *
 * @returns {Array<{race_number: number, time: string|null}>}
 */
function parseDeadlines($) {
  let table = null;
  $(".table1").each((_, el) => {
    if ($(el).find("tbody td").first().text().includes("締切予定時刻")) {
      table = $(el);
      return false;
    }
  });
  if (!table) return [];
  const numbers = table
    .find("thead th")
    .map((_, th) => {
      const m = /(\d{1,2})\s*R/.exec(normalizeDigits($(th).text()));
      return m ? parseInt(m[1], 10) : null;
    })
    .get()
    .filter((n) => n !== null);
  const times = table
    .find("tbody tr")
    .first()
    .find("td")
    .slice(1)
    .map((_, td) => {
      const m = /^(\d{1,2}):(\d{2})$/.exec(normalizeDigits($(td).text()));
      return m ? `${m[1].padStart(2, "0")}:${m[2]}` : null;
    })
    .get();
  return numbers.map((race_number, i) => ({
    race_number,
    time: times[i] ?? null,
  }));
}

/** F数・L数・平均ST のセル（「F0 / L0 / 0.15」。平均STが無いときは「-」） */
function parseFlStCell(lines) {
  const f = /^F(\d+)$/.exec(normalizeDigits(lines[0] ?? ""));
  const l = /^L(\d+)$/.exec(normalizeDigits(lines[1] ?? ""));
  return {
    f_count: f ? parseInt(f[1], 10) : null,
    l_count: l ? parseInt(l[1], 10) : null,
    avg_st: toFloat(lines[2]),
  };
}

function parseEntries($, anomalies) {
  const entries = [];
  $(".table1 tbody.is-fs12").each((index, tbody) => {
    if (index >= 6) return false;
    const $tbody = $(tbody);
    const $fs11 = $tbody.find(".is-fs11");

    const gradeText = $fs11.eq(0).text().trim();
    const racerIdMatch = gradeText.match(/^(\d+)/);
    const gradeMatch = gradeText.match(/\s*\/\s*([AB][12])/);

    // 「支部/出身地」と「年齢/体重」は、同じ .is-fs11 の中の <br> 区切りの2行
    const profileLines = splitCellLines($, $fs11.eq(1));
    const areaMatch = /^([^/]+?)\s*\/\s*(.+)$/.exec(profileLines[0] ?? "");
    const ageMatch = /(\d+)歳/.exec(profileLines[1] ?? "");
    const weightMatch = /(\d+(?:\.\d+)?)\s*kg/.exec(profileLines[1] ?? "");

    const $stats = $tbody.find("td.is-lineH2");
    const cellLines = (i) => splitCellLines($, $stats.eq(i));
    const fl = parseFlStCell(cellLines(0));
    const global = cellLines(1);
    const local = cellLines(2);
    const motor = cellLines(3);
    const boat = cellLines(4);

    // モーター・ボートの変更の赤表示は、実ページで未観測。未知の is-fColor 系のクラスが現れたら、発見できるよう記録する
    for (const cellIndex of [3, 4]) {
      $stats
        .eq(cellIndex)
        .find("*")
        .addBack()
        .each((_, el) => {
          for (const c of ($(el).attr("class") || "").split(/\s+/)) {
            if (/^is-fColor/.test(c)) {
              anomalies.push(
                `motor_boat_marker:${c}（${index + 1}号艇の${cellIndex === 3 ? "モーター" : "ボート"}。変更の赤表示の可能性）`,
              );
            }
          }
        });
    }

    entries.push({
      boat_number: index + 1,
      is_absent: $tbody.hasClass("is-miss"),
      racer_id: racerIdMatch ? parseInt(racerIdMatch[1], 10) : null,
      player_name: $tbody.find(".is-fs18.is-fBold a").text().trim() || null,
      grade: gradeMatch ? gradeMatch[1] : null,
      branch: areaMatch ? areaMatch[1].trim() : null,
      hometown: areaMatch ? areaMatch[2].trim() : null,
      age: ageMatch ? parseInt(ageMatch[1], 10) : null,
      weight_kg: weightMatch ? parseFloat(weightMatch[1]) : null,
      ...fl,
      win_rate: toFloat(global[0]),
      global_2rate: toFloat(global[1]),
      global_3rate: toFloat(global[2]),
      local_win_rate: toFloat(local[0]),
      local_2rate: toFloat(local[1]),
      local_3rate: toFloat(local[2]),
      motor_number: toInt(motor[0]),
      motor_2rate: toFloat(motor[1]),
      motor_3rate: toFloat(motor[2]),
      boat_number_id: toInt(boat[0]),
      boat_2rate: toFloat(boat[1]),
      boat_3rate: toFloat(boat[2]),
    });
  });
  return entries;
}

/**
 * 出走表ページ（cheerio）の全項目を解析する。
 * @param {import("cheerio").CheerioAPI} $
 */
export function parseRaceListDocument($) {
  const anomalies = [];
  const meta = scrapeRaceMeta($);
  const deadlines = parseDeadlines($);
  const entries = parseEntries($, anomalies);
  if (entries.length !== 0 && entries.length !== 6) {
    anomalies.push(`entries_count:${entries.length}`);
  }
  if (entries.length > 0 && deadlines.length !== 12) {
    anomalies.push(`deadlines_count:${deadlines.length}`);
  }
  return {
    parser_version: RACELIST_PARSER_VERSION,
    meta,
    deadlines,
    entries,
    anomalies,
  };
}

/**
 * 出走表ページのHTMLの全項目を解析する。
 *
 * 選手が1人も取れない（entries が空）のは、中止・未公開の可能性（呼び出し側が判断する。旧実装と同じ）。
 *
 * @param {string} html
 * @returns {{
 *   parser_version: string,
 *   meta: ReturnType<typeof scrapeRaceMeta>,
 *   deadlines: Array<{race_number: number, time: string|null}>,
 *   entries: ReturnType<typeof parseEntries>,
 *   anomalies: string[],
 * }}
 */
export function parseRaceListPage(html) {
  return parseRaceListDocument(cheerio.load(html));
}
