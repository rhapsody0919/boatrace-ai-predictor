import {
  PENDING_MARKER,
  squash,
  toInt,
  toNum,
  splitVenueBlocks,
  applyDayLabel,
} from "./kbFileParserText.js";

// ---------------------------------------------------------------------------
// Kファイル（競走成績）
// ---------------------------------------------------------------------------

const K_VENUE_HDR_RE =
  /^(.{1,5}?)［成績］\s+(\d{1,2})\/\s*(\d{1,2})\s+(.*?)\s*(第\s*\d+日|最終日)?\s*$/;
const K_DAY_LINE_RE =
  /^\s+(第\s*\d+日|最終日)\s+(\d{4})\/\s*(\d{1,2})\/\s*(\d{1,2})\s+(\S.*?)\s*$/;
const K_SUMMARY_ROW_RE = /^\s+\d{1,2}R\s+\S+/;
// 同着で払戻が複数ある場合の、レース番号なしの継続行（例: "               1-2-5     520    1-2-5     200"）
const K_SUMMARY_CONT_RE = /^\s{10,}\d(?:-\d){1,2}\s+\d+/;
/** 払戻金の要約に出る中止の行（例: "           1R  中[U+3000]止"。全角スペースの有無は問わない。BOA-412） */
const K_SUMMARY_CANCELLED_RE = /^\s+(\d{1,2})R\s+中[\s\u3000]*止\s*$/;
const K_RACE_HDR_RE =
  /^\s{0,4}(\d{1,2})R\s+(.*?)\s+H(\d+)m\s+(\S+)\s+風\s+(\S+?)\s+(\d+)m\s+波\s+(\d+)cm\s*$/;
const K_RESULT_HDR_RE = /^\s+着\s+艇\s+登番/;
const K_RESULT_PREFIX_RE = /^\s{2}(\S{1,2})\s+([1-6])\s+(\d{4})\s+(.+)$/;
const K_NAME_TAIL_RE = /^(.+?)\s+(\d{1,3})\s+(\d{1,3})\s+(.*)$/;
const K_PAYOUT_ITEM_RE =
  /(\d(?:-\d){0,2})\s+(\d+)(?:\s+人気\s+(\d+))?|特払い\s+(\d+)/g;

const PAYOUT_KIND = {
  単勝: "win",
  複勝: "place",
  "２連単": "exacta",
  "２連複": "quinella",
  拡連複: "wide",
  "３連単": "trifecta",
  "３連複": "trio",
};

/** スタート欄の解釈。フライング・出遅れ・欠場はrawを残しつつ区別する */
function parseStartField(raw) {
  const s = raw.replace(/\s+/g, "");
  if (s === "" || s === "." || s === "K." || s === "K") {
    return { start_timing: null, is_flying: false, is_late_start: false };
  }
  const m = /^(F)?(L)?(-?\d*\.\d{2})$/.exec(s);
  if (m) {
    const v = Number.parseFloat(m[3]);
    return {
      start_timing: m[1] ? -Math.abs(v) : v, // フライングは負値（race_start_timingsと同義）
      is_flying: Boolean(m[1]),
      is_late_start: Boolean(m[2]),
    };
  }
  if (/^L/.test(s))
    return { start_timing: null, is_flying: false, is_late_start: true };
  if (/^F/.test(s))
    return { start_timing: null, is_flying: true, is_late_start: false };
  return { start_timing: null, is_flying: false, is_late_start: false };
}

/**
 * 1艇分の結果行をパースする。認識できなければ null。
 * 着・艇・登番・氏名・モーター・ボートは固定形式。
 * 展示・進入・スタート・レースタイムの欄は、欠場（K0/K1）・F・L・失格等で形が変わるため、
 * 尾部を生文字列（tail_raw）としても保持し、レースタイム（末尾）と進入（先頭の1〜6）を優先して抽出する。
 */
function parseKResultRow(line) {
  const pre = K_RESULT_PREFIX_RE.exec(line);
  if (!pre) return null;
  const nt = K_NAME_TAIL_RE.exec(pre[4]);
  if (!nt) return null;
  const tail = nt[4];
  const timeM = /(\d\.\d{2}\.\d)\s*$/.exec(tail);
  // レースタイム欄は、完走できなかった艇では ".  ." のプレースホルダになる
  const body = timeM
    ? tail.slice(0, timeM.index)
    : tail.replace(/\s*\.\s+\.\s*$/, "");
  const exM = /^\s*(\d\.\d{2})\s+/.exec(body);
  const afterEx = exM
    ? body.slice(exM[0].length)
    : body.replace(/^\s*K?\s*\.\s*/, "");
  const courseM = /^\s*([1-6])\s+(.*)$/.exec(afterEx);
  const stRaw = (courseM ? courseM[2] : afterEx).trim();
  const rank = /^0[1-6]$/.test(pre[1]) ? Number.parseInt(pre[1], 10) : null;
  return {
    finish_raw: pre[1],
    rank,
    boat_number: toInt(pre[2]),
    racer_id: toInt(pre[3]),
    name: squash(nt[1]),
    name_raw: nt[1].trim(),
    motor_number: toInt(nt[2]),
    boat_id: toInt(nt[3]),
    exhibition_time: exM ? toNum(exM[1]) : null,
    course: courseM ? toInt(courseM[1]) : null,
    start_raw: stRaw,
    ...parseStartField(stRaw),
    race_time: timeM ? timeM[1] : null,
    tail_raw: tail.trim(),
  };
}

/**
 * 払戻ブロックの行を解釈する。特払い・不成立・空欄も項目として残す。
 * 返還等の未知の行は呼び出し側で extra_lines に残す。
 */
function parsePayoutLine(line, state) {
  const m =
    /^\s{6,}(単勝|複勝|２連単|２連複|拡連複|３連単|３連複)?\s*(\S.*)?$/.exec(
      line,
    );
  if (!m) return false;
  const kindJa = m[1] ?? state.lastKind;
  if (!kindJa) return false;
  const rest = (m[2] ?? "").trim();
  const kind = PAYOUT_KIND[kindJa];
  const items = [];
  if (rest === "") {
    if (!m[1]) return false;
    items.push({
      kind,
      combo: null,
      amount: null,
      popularity: null,
      special: "blank",
    });
  } else if (/^不成立\s*$/.test(rest)) {
    items.push({
      kind,
      combo: null,
      amount: null,
      popularity: null,
      special: "不成立",
    });
  } else {
    for (const it of rest.matchAll(K_PAYOUT_ITEM_RE)) {
      if (it[4] !== undefined) {
        items.push({
          kind,
          combo: null,
          amount: toInt(it[4]),
          popularity: null,
          special: "特払い",
        });
      } else {
        items.push({
          kind,
          combo: it[1],
          amount: toInt(it[2]),
          popularity: toInt(it[3]),
          special: null,
        });
      }
    }
    if (items.length === 0) return false;
  }
  state.lastKind = kindJa;
  state.payouts.push(...items);
  return true;
}

function newKVenue(venueCode) {
  return {
    venue_code: venueCode,
    venue_name: null,
    status: "complete",
    header: null,
    title: null,
    title_short: null,
    day_label: null,
    series_day: null,
    is_final_day: false,
    date_in_body: null,
    payout_summary_lines: [],
    // 払戻金の要約に「NR 中[U+3000]止」と書かれたレース番号（昇順）。成績の本体には中止のレースの記録が無いため、
    // 全日中止（races が空）と途中打ち切り（前半は成績あり）を、ここで区別できる（BOA-412）
    cancelled_race_numbers: [],
    races: [],
    unparsed: [],
  };
}

// 以下の parseK*Line は、行を処理したら true を返す（呼び出し側はその行を次の処理へ渡さない）。
// ctx = { out, race, payoutState, seenTitleBanner }（行をまたぐ状態）

function parseKVenueHeaderLine(ctx, line) {
  const vh = K_VENUE_HDR_RE.exec(line);
  if (!(vh && !ctx.race)) return false;
  const { out } = ctx;
  out.venue_name = squash(vh[1]);
  out.header = line.trim();
  out.title_short = squash(vh[4]);
  if (vh[5]) out.day_label = squash(vh[5]);
  return true;
}

function parseKTitleLine(ctx, line) {
  const { out } = ctx;
  if (/＊＊＊\s*競走成績\s*＊＊＊/.test(line)) {
    ctx.seenTitleBanner = true;
    return true;
  }
  if (
    ctx.seenTitleBanner &&
    out.title === null &&
    !ctx.race &&
    /^\s{4,}\S/.test(line) &&
    !K_DAY_LINE_RE.test(line)
  ) {
    out.title = squash(line.trim());
    return true;
  }
  return false;
}

function parseKDayLine(ctx, line) {
  const dl = K_DAY_LINE_RE.exec(line);
  if (!(dl && !ctx.race)) return false;
  ctx.out.day_label = squash(dl[1]);
  ctx.out.date_in_body = `${dl[2]}-${String(dl[3]).padStart(2, "0")}-${String(dl[4]).padStart(2, "0")}`;
  return true;
}

/** 払戻金の要約・注記の行（レースの前にある） */
function parseKSummaryLine(ctx, line) {
  const { out } = ctx;
  if (
    /内容については主催者発行のもの/.test(line) ||
    /\[払戻金\]/.test(line)
  ) {
    if (/\[払戻金\]/.test(line))
      out.payout_summary_lines.push(line.trimEnd());
    return true;
  }
  if (
    !ctx.race &&
    (K_SUMMARY_ROW_RE.test(line) || K_SUMMARY_CONT_RE.test(line)) &&
    !K_RACE_HDR_RE.test(line)
  ) {
    const cancelled = K_SUMMARY_CANCELLED_RE.exec(line);
    if (cancelled) out.cancelled_race_numbers.push(toInt(cancelled[1]));
    out.payout_summary_lines.push(line.trimEnd());
    return true;
  }
  return false;
}

function parseKRaceHeaderLine(ctx, line) {
  const rh = K_RACE_HDR_RE.exec(line);
  if (!rh) return false;
  const race = {
    race_number: toInt(rh[1]),
    stage_raw: rh[2].trim(),
    stage: squash(rh[2]),
    distance_m: toInt(rh[3]),
    weather: squash(rh[4]),
    wind_direction: squash(rh[5]),
    wind_speed: toInt(rh[6]),
    wave_height: toInt(rh[7]),
    technique: null,
    rows: [],
    payouts: [],
    extra_lines: [],
  };
  ctx.race = race;
  ctx.out.races.push(race);
  ctx.payoutState = { lastKind: null, payouts: race.payouts };
  return true;
}

/** レースの中の行（結果の見出し・区切り・艇の行・払戻・未知の行） */
function parseKRaceBodyLine(ctx, line) {
  const { race } = ctx;
  if (K_RESULT_HDR_RE.test(line)) {
    const t = line.split("ﾚｰｽﾀｲﾑ")[1];
    race.technique = t !== undefined && squash(t) !== "" ? squash(t) : null;
    return;
  }
  if (/^-{10,}\s*$/.test(line)) return;

  const row = parseKResultRow(line);
  if (row) {
    race.rows.push(row);
    return;
  }
  if (parsePayoutLine(line, ctx.payoutState)) return;
  race.extra_lines.push(line.trimEnd()); // 返還・レース不成立等の未知の行（捨てない）
}

function parseKLine(ctx, line) {
  if (
    parseKVenueHeaderLine(ctx, line) ||
    parseKTitleLine(ctx, line) ||
    parseKDayLine(ctx, line) ||
    parseKSummaryLine(ctx, line) ||
    parseKRaceHeaderLine(ctx, line)
  )
    return;
  if (!ctx.race) {
    ctx.out.unparsed.push(line.trimEnd());
    return;
  }
  parseKRaceBodyLine(ctx, line);
}

/**
 * @param {string[]} lines 会場ブロックの行
 * @param {number} venueCode
 */
function parseKVenue(lines, venueCode) {
  const out = newKVenue(venueCode);
  const joined = lines.join("\n");
  if (joined.includes(PENDING_MARKER)) {
    out.status = "pending";
    out.unparsed = lines.filter((l) => l.trim() !== "");
    return out;
  }

  const ctx = { out, race: null, payoutState: null, seenTitleBanner: false };
  for (const line of lines) {
    if (line.trim() === "") continue;
    parseKLine(ctx, line);
  }

  applyDayLabel(out);
  out.cancelled_race_numbers = [...new Set(out.cancelled_race_numbers)].sort(
    (a, b) => a - b,
  );
  return out;
}

/**
 * Kファイルのテキストを全項目つきの中間形式にパースする。
 * @param {string} text
 * @returns {{venues: object[], top_level_unparsed: string[]}}
 */
export function parseKText(text) {
  const blocks = splitVenueBlocks(text, "K");
  return {
    venues: blocks.map((b) => parseKVenue(b.lines, b.venue_code)),
    top_level_unparsed: [],
  };
}

export {
  K_VENUE_HDR_RE,
  K_SUMMARY_CANCELLED_RE,
  K_RACE_HDR_RE,
  parseStartField,
  parseKResultRow,
};
