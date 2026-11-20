/**
 * /today の X 投稿の型 v3「今日はこれだけ」（BOA-1314、オーナー 2026-11-04 承認、hq の台帳 TD02）。文だけで画像は無い。7:00 に送る。
 * 正本は hq の起票の下書き（x-today-v3-ticket-20261104.md）と hq の .claude/skills/sns-copy-rules/SKILL.md（日付・何日目・締切）。
 *
 * - 材料（loadTodayV3Material）は DB から読む（races・race_conditions・race_entries・exhibition_data・race_series・
 *   racer_course_technique_stats）。朝の一覧（morning_digest_*）の行はしきい値で先に絞ってあり「最も高い1人」を選べないため使わない
 * - 本文（buildTodayDigestV3）と検査（checkTodayDigestV3）は純粋関数
 * - 何日目は画面と同じ関数（src/utils/raceDetailHeading.js の getVenueSeriesDayLabel）。race_conditions の値が無ければ
 *   節（race_series）の開始日からの引き算で補う（scripts/lib/raceSeriesLookup.js の buildSeriesDayByVenue。節の中に中止があれば補わない）。
 *   丸一日中止の日は出さない（同じ関数が判定する）
 * - 載せるのは締切が送る時刻より後のレースだけ。欠場の艇・中止のレースは選ばない
 */
import { xPostValid } from "./sns/xLength.js";
import { addDaysToDateString } from "./dateUtils.js";
import {
  PAGE,
  V3_BANNED_PHRASES,
  V3_FINAL,
  V3_LINK_LEAD,
  V3_NIGASHI_HEADING,
  V3_NIGASHI_NOTE,
  V3_RATE_NOTE,
  V3_RULE,
  V3_SEMI,
  V3_TAG,
  isIsoDate,
  v3DateLine,
  v3PeriodNote,
} from "./snsTodayDigestV3Base.js";
import {
  finalsInfo,
  headerLines,
  holdingInfo,
  liveRaces,
  periodOf,
  raceHelpers,
  rateBlocks,
  semiInfo,
  venueDayLabels,
} from "./snsTodayDigestV3Build.js";

// 定数・文言は snsTodayDigestV3Base.js へ移した。import 元は変えずに済むよう、公開の名前を再 export する
export {
  V3_BANNED_PHRASES,
  V3_BODY,
  V3_FINAL,
  V3_LINK_LEAD,
  V3_MAX_FINALS,
  V3_MAX_SEMI_VENUES,
  V3_MIN_RUNS,
  V3_MIN_RUNS_FALLBACK,
  V3_NIGASHI_HEADING,
  V3_NIGASHI_NOTE,
  V3_RATE_NOTE,
  V3_RULE,
  V3_SEMI,
  V3_TAG,
  v3DateLine,
  v3PeriodNote,
} from "./snsTodayDigestV3Base.js";

/** PostgREST の上限1000行を超える表は、並びを固定して1000行ずつ読む（黙って切り捨てられないように） */
async function readAll(db, path) {
  const out = [];
  for (let offset = 0; ; offset += PAGE) {
    const rows = await db(`${path}&limit=${PAGE}&offset=${offset}`);
    out.push(...rows);
    if (rows.length < PAGE) return out;
  }
}

/**
 * 材料を読む（純粋でない）。失敗は投げる（次の5分でやり直す）
 * @param {(path: string) => Promise<any[]>} db PostgREST の読み取り（service_role）
 */
export async function loadTodayV3Material(db, date) {
  const day = encodeURIComponent(`${date}*`);
  const [races, conditions, entries, exhibition, series] = await Promise.all([
    readAll(
      db,
      `races?race_date=eq.${date}&select=race_id,venue_code,race_number,start_time,race_grade,cancellation_status&order=race_id`,
    ),
    readAll(
      db,
      `race_conditions?race_id=like.${day}&select=race_id,race_stage,series_day,is_final_day,race_title&order=race_id`,
    ),
    readAll(
      db,
      `race_entries?race_id=like.${day}&select=race_id,boat_number,racer_id,player_name,grade,is_absent&order=race_id,boat_number`,
    ),
    readAll(
      db,
      `exhibition_data?race_id=like.${day}&is_absent=is.true&select=race_id,boat_number&order=race_id,boat_number`,
    ),
    db(
      `race_series?start_date=lte.${date}&end_date=gte.${date}&select=venue_code,start_date,end_date,title,grade,kind`,
    ),
  ]);
  // 選手×コースの率は、使う組み合わせ（1号艇の1コース・2号艇の2コース・3・4号艇のそのコース）だけ読む（PK は racer_id, course）
  const paths = [1, 2, 3, 4].flatMap((course) => {
    const ids = [
      ...new Set(
        entries
          .filter(
            (e) => e.boat_number === course && Number.isInteger(e.racer_id),
          )
          .map((e) => e.racer_id),
      ),
    ];
    return Array.from(
      { length: Math.ceil(ids.length / 300) },
      (_, i) =>
        `racer_course_technique_stats?course=eq.${course}&racer_id=in.(${ids.slice(i * 300, i * 300 + 300).join(",")})&select=racer_id,course,window_start,window_end,runs,nige_rate,makuri_rate,nigashi_rate`,
    );
  });
  const stats = (await Promise.all(paths.map((p) => db(p)))).flat();
  // 節の中の中止（何日目の補いに使う。中止のある節は補わない）
  const minStart = series.reduce(
    (m, s) => (String(s.start_date) < m ? String(s.start_date) : m),
    date,
  );
  const cancelledBefore =
    minStart < date
      ? await readAll(
          db,
          `races?cancellation_status=eq.confirmed&race_date=gte.${minStart}&race_date=lt.${date}&select=venue_code,race_date&order=race_date,venue_code`,
        )
      : [];
  return {
    date,
    races,
    conditions,
    entries,
    exhibition,
    series,
    stats,
    cancelledBefore,
  };
}

// 率の塊（罫線で囲む）と脚注の行。塊が無い日は、タグの前を1行空ける（塊のある日は罫線・注の直後）
function blockAndFootLines(blocks, period, nigashi) {
  const lines = [];
  if (blocks.length) {
    lines.push("", V3_RULE);
    for (const [i, b] of blocks.entries())
      lines.push(...(i ? [""] : []), ...b.lines);
    lines.push(V3_RULE);
  }
  if (period) lines.push(v3PeriodNote(period.from, period.to), V3_RATE_NOTE);
  if (nigashi) lines.push(V3_NIGASHI_NOTE);
  if (!blocks.length) lines.push("");
  lines.push(V3_TAG);
  return lines;
}

// 送る直前に読み直す対象（本文に書いた全レース。率の塊は艇番つき、ほかは艇番 null）。同じ組は1回
function picksOf(mentioned, blocks) {
  return [
    ...mentioned.map((r) => ({ race_id: r.race_id, boat_number: null })),
    ...blocks.flatMap((b) =>
      b.boats.map((boat) => ({ race_id: b.race.race_id, boat_number: boat })),
    ),
  ].filter(
    (p, i, all) =>
      all.findIndex(
        (q) => q.race_id === p.race_id && q.boat_number === p.boat_number,
      ) === i,
  );
}

/**
 * 本文（純粋関数）。返り値 { ok: true, text, picks, featured, blocks, summary } か { ok: false, reason }
 * picks は送る直前に欠場・中止を読み直す対象（本文に書いた全レース。率の塊は艇番つき、ほかは艇番 null）
 * @param {object} material loadTodayV3Material の値
 * @param {{sendAt: string, t: Function, url: string}} options sendAt は "HH:MM"
 */
export function buildTodayDigestV3(material, { sendAt, t, url }) {
  if (!/^\d{2}:\d{2}$/.test(sendAt)) throw new Error("sendAt は HH:MM");
  const { date } = material;
  const h = raceHelpers(material, t);
  const day = liveRaces(material.races, sendAt);
  if (day.fail) return day.fail;
  const { held, venues, live } = day;
  const raceById = new Map(live.map((r) => [r.race_id, r]));
  const dayLabels = venueDayLabels(material, t);
  const finals = live
    .filter((r) => h.cond.get(r.race_id)?.race_stage === V3_FINAL)
    .sort(h.byGrade);
  const semis = live.filter(
    (r) => h.cond.get(r.race_id)?.race_stage === V3_SEMI,
  );
  const top = finals[0] ?? null;
  const bigFinal =
    top && ["SG", "G1"].includes(h.gradeOf(top)) && h.titleOf(top);
  const lines = headerLines(
    { date, url, venues, live, top, bigFinal },
    h,
    dayLabels,
  );
  const fin = finalsInfo(finals, h.at);
  const semi = semiInfo(semis, h);
  const hold = holdingInfo({ venues, finals, semis, held }, h, dayLabels);
  const info = [...fin.info, ...semi.info, ...hold.info];
  const mentioned = [
    ...(top ? [top] : []),
    ...fin.mentioned,
    ...semi.mentioned,
  ];
  const rates = rateBlocks(live, material, h.venue);
  if (info.length) lines.push("", ...info);
  const period = periodOf(rates.found, rates.latestEnd);
  lines.push(...blockAndFootLines(rates.blocks, period, rates.nigashi));
  // 2行目の最初と最後の締切のレースも、送る直前に中止を読み直す
  if (!top) mentioned.push(live[0], live.at(-1));
  const picks = picksOf(mentioned, rates.blocks);
  if (picks.some((p) => !raceById.has(p.race_id)))
    return { ok: false, reason: "pick_not_live" };
  return {
    ok: true,
    text: lines.join("\n"),
    picks,
    featured: top ? { race_id: top.race_id, boat_number: null } : null,
    blocks: rates.blocks.map(({ key, race, boats, racer_id, rate, runs }) => ({
      key,
      race_id: race.race_id,
      boats,
      racer_id,
      rate,
      runs,
    })),
    summary: {
      venues: venues.size,
      finals: finals.map((r) => r.race_id),
      semis: semis.map((r) => r.race_id),
      holding: hold.holding.map((v) => v.code),
      big_final: Boolean(bigFinal),
      period,
    },
  };
}

// 本文の行・リンク・禁止の字の検査
function textProblems(text, lines, { date, url }) {
  const problems = [];
  if (!lines[0]?.startsWith(v3DateLine(date)))
    problems.push("line1_date_missing");
  if (
    !/^(🏆 優勝戦 .+\d{1,2}:\d{2}締切|最初の締切 \d{1,2}:\d{2} .+・最後 \d{1,2}:\d{2} .+)$/.test(
      lines[1] ?? "",
    )
  )
    problems.push("line2_invalid");
  if (lines[2] !== `${V3_LINK_LEAD}${url}`) problems.push("line3_link_invalid");
  if (text.split(url).length !== 2) problems.push("link_count");
  if (/undefined|NaN|null|[{}]|\$\{|[◯○]/.test(text))
    problems.push("placeholder_left");
  // 会場名の訳が無いと i18n のキーがそのまま出る（venues.25）
  if (/venues\./.test(text)) problems.push("i18n_key_left");
  if (/https?:\/\//.test(text.replace(url, ""))) problems.push("extra_link");
  if (lines.at(-1) !== V3_TAG) problems.push("tag_missing");
  if (/競艇/.test(text)) problems.push("kyotei");
  return problems;
}

// 脚注の期間の行（※率は y/m/d〜y/m/d の…）が正しい形・暦・前日までか
function periodNoteValid(periodLines, date) {
  const m =
    periodLines.length === 1 &&
    periodLines[0].match(
      /^※率は (\d{4})\/(\d{1,2})\/(\d{1,2})〜(\d{4})\/(\d{1,2})\/(\d{1,2}) の全国の成績（そのコースに入ったとき）$/,
    );
  const iso = (y, mo, d) =>
    `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const from = m && iso(m[1], m[2], m[3]);
  const to = m && iso(m[4], m[5], m[6]);
  return Boolean(
    m &&
    isIsoDate(from) &&
    isIsoDate(to) &&
    from <= to &&
    to <= addDaysToDateString(date, -1),
  );
}

// 脚注（BOA-1315）: 率の塊がある日は期間と定義の2行。期間は年つきの両端で、終わりは前日まで。逃し率の行は逃し率の塊がある日だけ
function noteProblems(lines, date) {
  const problems = [];
  const hasRates = lines.includes(V3_RULE);
  const periodLines = lines.filter((l) => l.startsWith("※率は "));
  if (hasRates) {
    if (!periodNoteValid(periodLines, date))
      problems.push("period_note_invalid");
    if (!lines.includes(V3_RATE_NOTE)) problems.push("rate_note_missing");
  } else if (periodLines.length || lines.includes(V3_RATE_NOTE))
    problems.push("rate_note_without_rates");
  if (lines.includes(V3_NIGASHI_NOTE) !== lines.includes(V3_NIGASHI_HEADING))
    problems.push("nigashi_note_mismatch");
  return problems;
}

/**
 * 機械の検査（純粋関数）。返り値は通らなかった理由の配列（空なら通った）。禁止表現は計画の riskRules（今の /today と同じ）が別に見る。
 * ただし逃し率の向きの言い方（V3_BANNED_PHRASES、BOA-1324）だけはこの型の文の約束なので、ここで本文の全体を見る
 * 長文の1投稿（親1件だけのスレッド）として X の加重で確かめる（今の /today と同じ。送る直前の preflight も同じ線）
 */
export function checkTodayDigestV3(text, { date, url }) {
  const lines = text.split("\n");
  const problems = [
    ...textProblems(text, lines, { date, url }),
    ...noteProblems(lines, date),
  ];
  if (V3_BANNED_PHRASES.test(text)) problems.push("banned_phrase");
  if (!xPostValid(text, { long: true })) problems.push("weighted_text_invalid");
  return problems;
}
