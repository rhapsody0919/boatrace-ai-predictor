import {
  squash,
  half,
  toInt,
  toNum,
  splitVenueBlocks,
  applyDayLabel,
} from "./kbFileParserText.js";

// ---------------------------------------------------------------------------
// Bファイル（番組表）
// ---------------------------------------------------------------------------

// 例: 「ボートレース唐津 ３月２４日 第９回サッポロビール 第３日」（会場名・日目の途中に全角空白が入る）
//     2005年頃は「唐津 競艇場 １月４日 ...」の表記
const B_VENUE_HDR_RE =
  /^(?:ボートレース(.{1,5}?)|(.{1,6}?)\s*競艇場)\s+([0-9０-９]{1,2})月\s*([0-9０-９]{1,2})日\s+(.*?)\s*(第\s*[0-9０-９]+\s*日|最終日)\s*$/;
const B_DAY_LINE_RE =
  /^\s+(第\s*[0-9０-９]+\s*日|最終日)\s+([0-9０-９]{4})年\s*([0-9０-９]{1,2})月\s*([0-9０-９]{1,2})日\s+\S/;
const B_RACE_HDR_RE =
  /^\s*([0-9０-９]{1,2})[RＲ]\s+(.*?)\s+[HＨ]([0-9０-９]+)[mｍ]\s+電話投票締切予定\s*([0-9０-９]{1,2})[:：]([0-9０-９]{2})/;
const B_ENTRY_RE =
  /^([1-6])\s?(\d{4})(.{4})(\d{2})(\D{2,3}?)(\d{2})(A1|A2|B1|B2)\s*(\d+\.\d{2})\s*(\d+\.\d{2})\s*(\d+\.\d{2})\s*(\d+\.\d{2})\s*(\d{1,3})\s*(\d+\.\d{2})\s*(\d{1,3})\s*(\d+\.\d{2})(.*)$/;

function newBVenue(venueCode) {
  return {
    venue_code: venueCode,
    venue_name: null,
    header: null,
    title: null,
    title_short: null,
    day_label: null,
    series_day: null,
    is_final_day: false,
    date_in_body: null,
    races: [],
    unparsed: [],
  };
}

// parseB*Line は、行を処理したら true を返す。ctx = { out, race, seenBanner }（行をまたぐ状態）

function parseBHeaderLine(ctx, line) {
  const { out } = ctx;
  const vh = B_VENUE_HDR_RE.exec(line);
  if (vh && !ctx.race) {
    out.venue_name = squash(vh[1] ?? vh[2]);
    out.header = line.trim();
    out.title_short = squash(vh[5]);
    out.day_label = squash(vh[6]);
    return true;
  }
  if (/＊＊＊\s*番組表\s*＊＊＊/.test(line)) {
    ctx.seenBanner = true;
    return true;
  }
  if (
    ctx.seenBanner &&
    out.title === null &&
    !ctx.race &&
    /^\s{4,}\S/.test(line)
  ) {
    out.title = squash(line.trim());
    return true;
  }
  const dl = B_DAY_LINE_RE.exec(line);
  if (dl && !ctx.race) {
    const p2 = (x) => half(x).padStart(2, "0");
    out.date_in_body = `${half(dl[2])}-${p2(dl[3])}-${p2(dl[4])}`;
    return true;
  }
  return /内容については主催者発行のもの/.test(line);
}

function parseBRaceHeaderLine(ctx, line) {
  const rh = B_RACE_HDR_RE.exec(line);
  if (!rh) return false;
  const race = {
    race_number: toInt(half(rh[1])),
    stage_raw: rh[2].trim(),
    stage: squash(rh[2]),
    distance_m: toInt(half(rh[3])),
    deadline_time: `${half(rh[4]).padStart(2, "0")}:${half(rh[5])}`,
    entries: [],
    extra_lines: [],
  };
  ctx.race = race;
  ctx.out.races.push(race);
  return true;
}

function toBEntry(e) {
  const tail = e[16];
  return {
    boat_number: toInt(e[1]),
    racer_id: toInt(e[2]),
    name: squash(e[3]),
    name_raw: e[3],
    age: toInt(e[4]),
    branch: squash(e[5]),
    weight: toInt(e[6]),
    class: e[7],
    national_win_rate: toNum(e[8]),
    national_2rate: toNum(e[9]),
    local_win_rate: toNum(e[10]),
    local_2rate: toNum(e[11]),
    motor_number: toInt(e[12]),
    motor_2rate: toNum(e[13]),
    boat_id: toInt(e[14]),
    boat_2rate: toNum(e[15]),
    series_results_raw: tail.slice(0, tail.length).trimEnd(), // 今節成績（日別着順）と早見欄。列位置が意味を持つため原文を保持
  };
}

/** レースの中の行（区切り・見出しは捨て、出走表の行は艇として、それ以外は extra_lines へ） */
function parseBRaceBodyLine(ctx, line) {
  const { race } = ctx;
  if (
    /^-{10,}\s*$/.test(line) ||
    /^艇\s+選手\s+選手/.test(line) ||
    /^番\s+登番\s+名/.test(line)
  )
    return;

  const e = B_ENTRY_RE.exec(line.trim());
  if (e) {
    race.entries.push(toBEntry(e));
    return;
  }
  race.extra_lines.push(line.trimEnd());
}

function parseBLine(ctx, line) {
  if (parseBHeaderLine(ctx, line) || parseBRaceHeaderLine(ctx, line)) return;
  if (!ctx.race) {
    ctx.out.unparsed.push(line.trimEnd());
    return;
  }
  parseBRaceBodyLine(ctx, line);
}

function parseBVenue(lines, venueCode) {
  const out = newBVenue(venueCode);
  const ctx = { out, race: null, seenBanner: false };
  for (const line of lines) {
    if (line.trim() === "") continue;
    parseBLine(ctx, line);
  }
  applyDayLabel(out);
  return out;
}

/**
 * Bファイルのテキストを全項目つきの中間形式にパースする。
 * @param {string} text
 */
export function parseBText(text) {
  const blocks = splitVenueBlocks(text, "B");
  return { venues: blocks.map((b) => parseBVenue(b.lines, b.venue_code)) };
}

export { B_RACE_HDR_RE, B_ENTRY_RE };
