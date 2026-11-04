/**
 * 公式の raceindex（/owpc/pc/race/raceindex?jcd=VV&hd=YYYYMMDD、会場の1日のレース一覧）の解析（BOA-1282）。
 *
 * 表の各行（tbody tr）の1列目が「NR」（racelist への a）、2列目が締切予定時刻（HH:MM）。行の単位で R と時刻を対にする
 * （朝の初期化の scripts/scrape-to-json.js の getRaceStartTimes は「時刻の形の td を順に 1R から割り当てる」ので、
 * 欠けた行があると番号がずれる。ここでは行の R の番号を読む）。日の札は上のタブの今の日（li.is-active1 の span）。
 *
 * 開催の無い日のページは行が無い（races は空配列）。開催の有無は呼ぶ側が race_series と照らして決める。
 */
import * as cheerio from "cheerio";

const HHMM = /^([01]?\d|2[0-3]):([0-5]\d)$/;

/**
 * @param {string} html
 * @returns {{dayLabel: string|null, races: Array<{raceNumber: number, deadline: string}>}} deadline は "HH:MM"（時は2桁）
 */
export function parseRaceIndex(html) {
  const $ = cheerio.load(html);
  const races = [];
  $(".table1 table tbody tr").each((_, tr) => {
    const tds = $(tr).children("td");
    const r = /^(\d{1,2})R$/.exec(tds.eq(0).text().trim());
    const t = HHMM.exec(tds.eq(1).text().trim());
    if (!r || !t) return;
    races.push({
      raceNumber: Number(r[1]),
      deadline: `${t[1].padStart(2, "0")}:${t[2]}`,
    });
  });
  const dayLabel =
    $(".tab2_tabs li.is-active1 .tab2_inner > span").first().text().trim() ||
    null;
  return { dayLabel, races };
}

/**
 * 解析の結果の並びの検査。開催のある会場で、これに引っかかる結果は書かない（解析の誤りが前夜の投稿に出ないよう）。
 * 1R から欠けずに続く・12R まで・時刻が狭義の昇順・06:00〜23:59 の中。
 * @returns {string[]} 理由（空なら正常）
 */
export function raceIndexProblems(races) {
  if (!Array.isArray(races) || races.length === 0) return ["行が無い"];
  const out = [];
  if (races.length > 12) out.push(`行が12より多い（${races.length}）`);
  races.forEach((r, i) => {
    if (r.raceNumber !== i + 1)
      out.push(`${i + 1}行目の R が ${r.raceNumber}（1R から続いていない）`);
    if (r.deadline < "06:00")
      out.push(`${r.raceNumber}R の締切 ${r.deadline} が 06:00 より前`);
    if (i > 0 && !(r.deadline > races[i - 1].deadline))
      out.push(
        `${r.raceNumber}R の締切 ${r.deadline} が前の R（${races[i - 1].deadline}）より後でない`,
      );
  });
  return out;
}

/** 最終日の札か（公式の表記「最終日」） */
export const isLastDayLabel = (label) => label === "最終日";

/** レース名が優勝戦か（「優勝戦」「女子優勝戦」等を含み、「準優勝戦」「優勝戦進出…」でない） */
export const isFinalRaceName = (name) =>
  typeof name === "string" &&
  /優勝戦/.test(name) &&
  !/準優勝戦|進出/.test(name);
