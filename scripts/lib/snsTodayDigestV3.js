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
import { getVenueSeriesDayLabel } from "../../src/utils/raceDetailHeading.js";
import { isRaceCancelled } from "../../src/utils/raceCancellation.js";
import { buildSeriesDayByVenue } from "./raceSeriesLookup.js";
import { xPostValid } from "../../api/_lib/snsXLength.js";

export const V3_BODY = "digest_v3";
export const V3_FINAL = "優勝戦";
export const V3_SEMI = "準優勝戦";
/** 走数の足切り（目安、根拠なし。起票の下書き）。該当が無ければ朝の一覧の MIN_RUNS=10 まで下げる */
export const V3_MIN_RUNS = 30;
export const V3_MIN_RUNS_FALLBACK = 10;
/** 優勝戦は🏆を含めて3つ、準優勝戦は3場まで書き、残りは「ほか◯場」 */
export const V3_MAX_FINALS = 3;
export const V3_MAX_SEMI_VENUES = 3;
export const V3_RULE = "━━━━━━━━━━";
export const V3_NIGASHI_NOTE =
  "※逃し率＝2コースに入ったとき、1コースの艇の逃げで決まった割合";
export const V3_TAG = "#ボートレース";
export const V3_LINK_LEAD = "全レースの一覧 → ";

const GRADE_ORDER = ["SG", "G1", "G2", "G3"];
const gradeRank = (g) =>
  GRADE_ORDER.includes(g) ? GRADE_ORDER.indexOf(g) : GRADE_ORDER.length;
const LADY_KINDS = ["lady", "venus"];
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];
const PAGE = 1000;

/** 「11月5日（水）」（文字列の年月日をそのまま使う。実行環境のタイムゾーンに左右されない） */
export function v3DateLine(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${m}月${d}日（${WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]}）`;
}

const hm = (startTime) => String(startTime).slice(0, 5);
const hmShort = (startTime) => hm(startTime).replace(/^0/, "");
const nameOf = (name) =>
  String(name ?? "")
    .replace(/[\s\u3000]+/g, " ")
    .trim();
const nfkc = (s) =>
  typeof s === "string" && s.trim() ? s.normalize("NFKC").trim() : null;

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
  const stats = [];
  for (const course of [1, 2, 3, 4]) {
    const ids = [
      ...new Set(
        entries
          .filter(
            (e) => e.boat_number === course && Number.isInteger(e.racer_id),
          )
          .map((e) => e.racer_id),
      ),
    ];
    for (let i = 0; i < ids.length; i += 300)
      stats.push(
        ...(await db(
          `racer_course_technique_stats?course=eq.${course}&racer_id=in.(${ids.slice(i, i + 300).join(",")})&select=racer_id,course,runs,nige_rate,makuri_rate,nigashi_rate`,
        )),
      );
  }
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

/** 会場ごとの何日目の表示（画面の getVenueSeriesDayLabel。race_conditions に無い日目は節から補う） */
function venueDayLabels(
  { date, races, conditions, series, cancelledBefore },
  t,
) {
  const cond = new Map(conditions.map((c) => [c.race_id, c]));
  const derived = buildSeriesDayByVenue(series, date, {
    cancelledRaces: cancelledBefore,
  });
  const byVenue = new Map();
  for (const r of races) {
    if (!byVenue.has(r.venue_code)) byVenue.set(r.venue_code, []);
    const c = cond.get(r.race_id) ?? {};
    byVenue.get(r.venue_code).push({
      seriesDay: c.series_day ?? null,
      // 優勝戦のある日は最終日（is_final_day はレースごとに入る時点がずれる。BOA-509）
      isFinalDay: c.race_stage === V3_FINAL ? true : (c.is_final_day ?? null),
      cancellationStatus: r.cancellation_status,
    });
  }
  const labels = new Map();
  for (const [venue, list] of byVenue) {
    const filled = list.some((r) => r.seriesDay != null)
      ? list
      : list.map((r) => ({ ...r, seriesDay: derived.get(venue) ?? null }));
    labels.set(venue, getVenueSeriesDayLabel(filled, t));
  }
  return labels;
}

/**
 * 本文（純粋関数）。返り値 { ok: true, text, picks, featured, blocks, summary } か { ok: false, reason }
 * picks は送る直前に欠場・中止を読み直す対象（本文に書いた全レース。率の塊は艇番つき、ほかは艇番 null）
 * @param {object} material loadTodayV3Material の値
 * @param {{sendAt: string, t: Function, url: string}} options sendAt は "HH:MM"
 */
export function buildTodayDigestV3(material, { sendAt, t, url }) {
  if (!/^\d{2}:\d{2}$/.test(sendAt)) throw new Error("sendAt は HH:MM");
  const { date, races, conditions, entries, exhibition, series, stats } =
    material;
  const venue = (code) => t(`venues.${code}`);
  const cond = new Map(conditions.map((c) => [c.race_id, c]));
  const seriesOf = new Map(series.map((s) => [Number(s.venue_code), s]));
  const held = races.filter(
    (r) => !isRaceCancelled({ cancellationStatus: r.cancellation_status }),
  );
  const venues = new Set(held.map((r) => r.venue_code));
  if (!venues.size) return { ok: false, reason: "no_races" };
  // 載せてよいレース: 中止でなく、締切が送る時刻より後
  const live = held
    .filter(
      (r) => typeof r.start_time === "string" && hm(r.start_time) > sendAt,
    )
    .sort(
      (a, b) =>
        hm(a.start_time).localeCompare(hm(b.start_time)) ||
        a.venue_code - b.venue_code ||
        a.race_number - b.race_number,
    );
  if (!live.length) return { ok: false, reason: "no_live_races" };
  const raceById = new Map(live.map((r) => [r.race_id, r]));
  const gradeOf = (r) =>
    r.race_grade ?? seriesOf.get(r.venue_code)?.grade ?? null;
  const titleOf = (r) =>
    nfkc(seriesOf.get(r.venue_code)?.title) ??
    nfkc(cond.get(r.race_id)?.race_title);
  const byGrade = (a, b) =>
    gradeRank(gradeOf(a)) - gradeRank(gradeOf(b)) ||
    hm(a.start_time).localeCompare(hm(b.start_time)) ||
    a.venue_code - b.venue_code;
  const at = (r) =>
    `${venue(r.venue_code)}${r.race_number}R ${hmShort(r.start_time)}締切`;
  const dayLabels = venueDayLabels(material, t);

  const finals = live
    .filter((r) => cond.get(r.race_id)?.race_stage === V3_FINAL)
    .sort(byGrade);
  const semis = live.filter((r) => cond.get(r.race_id)?.race_stage === V3_SEMI);
  const top = finals[0] ?? null;
  const bigFinal = top && ["SG", "G1"].includes(gradeOf(top)) && titleOf(top);

  const lines = [];
  // 1行目: 日付と場の数（SG・G1 の優勝戦の日は大会名・最終日・会場）
  lines.push(
    bigFinal
      ? `${v3DateLine(date)}${titleOf(top)} ${dayLabels.get(top.venue_code) ?? "最終日"}（${venue(top.venue_code)}）`
      : `${v3DateLine(date)}今日のボートレース ${venues.size}場`,
  );
  // 2行目: 🏆 優勝戦（優勝戦も準優も無い日は最初と最後の締切）
  const firstLast = `最初の締切 ${hmShort(live[0].start_time)} ${venue(live[0].venue_code)}${live[0].race_number}R・最後 ${hmShort(live.at(-1).start_time)} ${venue(live.at(-1).venue_code)}${live.at(-1).race_number}R`;
  lines.push(top ? `🏆 優勝戦 ${at(top)}` : firstLast);
  // 3行目: リンク
  lines.push(`${V3_LINK_LEAD}${url}`);

  const mentioned = [];
  const info = [];
  if (top) mentioned.push(top);
  const restFinals = finals.slice(1);
  if (restFinals.length) {
    const shown = restFinals.slice(0, V3_MAX_FINALS - 1);
    const more = restFinals.length - shown.length;
    info.push(
      `【優勝戦】${shown.map(at).join("／")}${more ? `（ほか${more}場）` : ""}`,
    );
    mentioned.push(...shown);
  }
  // 準優勝戦は場ごとに1行（並びは優勝戦と同じ: グレード→最初の締切）
  const semiVenues = [...new Set(semis.map((r) => r.venue_code))]
    .map((code) =>
      semis
        .filter((r) => r.venue_code === code)
        .sort((a, b) => a.race_number - b.race_number),
    )
    .sort((a, b) => byGrade(a[0], b[0]));
  const shownSemi = semiVenues.slice(0, V3_MAX_SEMI_VENUES);
  for (const [i, list] of shownSemi.entries()) {
    const nums = list.map((r) => r.race_number);
    const consecutive = nums.every((n, j) => j === 0 || n === nums[j - 1] + 1);
    const label =
      nums.length >= 3 && consecutive
        ? `${nums[0]}〜${nums.at(-1)}R`
        : `${nums.join("・")}R`;
    const more = semiVenues.length - shownSemi.length;
    info.push(
      `【準優勝戦】${venue(list[0].venue_code)}${label} ${list.map((r) => hmShort(r.start_time)).join("／")}締切${i === shownSemi.length - 1 && more ? `（ほか${more}場）` : ""}`,
    );
    mentioned.push(...list);
  }
  // 【開催中】SG・G1・G2・G3 と女子戦。優勝戦・準優の行に出た場は重ねない。丸一日中止の場は出さない
  const shownVenues = new Set([...finals, ...semis].map((r) => r.venue_code));
  const holding = [...venues]
    .filter((code) => !shownVenues.has(code))
    .map((code) => {
      const race = held.find((r) => r.venue_code === code);
      const grade = gradeOf(race);
      const lady = LADY_KINDS.includes(seriesOf.get(code)?.kind);
      return { code, race, grade, lady };
    })
    .filter((v) => GRADE_ORDER.includes(v.grade) || v.lady)
    .sort((a, b) => gradeRank(a.grade) - gradeRank(b.grade) || a.code - b.code);
  for (const v of holding) {
    const title = titleOf(v.race);
    const day = dayLabels.get(v.code);
    info.push(
      `【開催中】${[GRADE_ORDER.includes(v.grade) ? v.grade : null, title, `${venue(v.code)}${day ?? ""}`].filter(Boolean).join(" ")}`,
    );
  }

  // 率の塊（全国の値。枠番＝コースとみなすのは朝の一覧と同じ）
  const absent = new Set([
    ...entries
      .filter((e) => e.is_absent === true)
      .map((e) => `${e.race_id}:${e.boat_number}`),
    ...exhibition.map((e) => `${e.race_id}:${e.boat_number}`),
  ]);
  const entryOf = new Map(
    entries.map((e) => [`${e.race_id}:${e.boat_number}`, e]),
  );
  const statOf = new Map(stats.map((s) => [`${s.racer_id}|${s.course}`, s]));
  const usedRaces = new Set();
  const usedRacers = new Set();
  const candidates = (boats, rateKey) =>
    live.flatMap((race) =>
      boats.flatMap((boat) => {
        const e = entryOf.get(`${race.race_id}:${boat}`);
        if (
          !e ||
          absent.has(`${race.race_id}:${boat}`) ||
          !Number.isInteger(e.racer_id)
        )
          return [];
        const s = statOf.get(`${e.racer_id}|${boat}`);
        const rate = Number(s?.[rateKey]);
        if (
          !s ||
          s[rateKey] == null ||
          !Number.isFinite(rate) ||
          !Number.isInteger(s.runs)
        )
          return [];
        return [{ race, boat, entry: e, rate, runs: s.runs }];
      }),
    );
  // 率の高い順、同じ率は締切の早い順。走数30以上が無ければ10以上まで下げる。同じ選手・同じレースは2回出さない
  const pick = (list, extraOk = () => true) => {
    for (const min of [V3_MIN_RUNS, V3_MIN_RUNS_FALLBACK]) {
      const found = list
        .filter(
          (c) =>
            c.runs >= min &&
            !usedRaces.has(c.race.race_id) &&
            !usedRacers.has(c.entry.racer_id) &&
            extraOk(c),
        )
        .sort(
          (a, b) =>
            b.rate - a.rate ||
            hm(a.race.start_time).localeCompare(hm(b.race.start_time)) ||
            a.race.race_id.localeCompare(b.race.race_id) ||
            a.boat - b.boat,
        )[0];
      if (found) {
        usedRaces.add(found.race.race_id);
        usedRacers.add(found.entry.racer_id);
        return found;
      }
    }
    return null;
  };
  const pct = (rate) => `${Math.round(rate)}%`;
  const who = (e) => `${nameOf(e.player_name)} ${e.grade ?? ""}`.trim();
  const blocks = [];
  const nige = pick(candidates([1], "nige_rate"));
  if (nige)
    blocks.push({
      key: "nige",
      race: nige.race,
      boats: [1],
      racer_id: nige.entry.racer_id,
      rate: nige.rate,
      runs: nige.runs,
      lines: [
        "【逃げ率が高い選手】",
        `${who(nige.entry)}\u3000${pct(nige.rate)}（${nige.runs}走）`,
        `▶ ${venue(nige.race.venue_code)}${nige.race.race_number}R 1号艇 ${hmShort(nige.race.start_time)}締切`,
      ],
    });
  // 1号艇が逃げやすいレース: 2号艇の2コースの逃し率。名前は1号艇（欠場でない・名前がある）を出し、2号艇は数字だけ（実名を負の側で出さない）
  const nigashi = pick(candidates([2], "nigashi_rate"), (c) => {
    const one = entryOf.get(`${c.race.race_id}:1`);
    return Boolean(
      one &&
      !absent.has(`${c.race.race_id}:1`) &&
      nameOf(one.player_name) &&
      !usedRacers.has(one.racer_id),
    );
  });
  if (nigashi) {
    const one = entryOf.get(`${nigashi.race.race_id}:1`);
    usedRacers.add(one.racer_id);
    blocks.push({
      key: "nigashi",
      race: nigashi.race,
      boats: [1, 2],
      racer_id: nigashi.entry.racer_id,
      rate: nigashi.rate,
      runs: nigashi.runs,
      lines: [
        "【1号艇が逃げやすいレース】",
        at(nigashi.race),
        `1号艇 ${who(one)}／2号艇の逃し率 ${pct(nigashi.rate)}（${nigashi.runs}走）`,
      ],
    });
  }
  const makuri = pick(candidates([3, 4], "makuri_rate"));
  if (makuri)
    blocks.push({
      key: "makuri",
      race: makuri.race,
      boats: [makuri.boat],
      racer_id: makuri.entry.racer_id,
      rate: makuri.rate,
      runs: makuri.runs,
      lines: [
        "【まくり率が高い選手】",
        `${who(makuri.entry)}\u3000${pct(makuri.rate)}（${makuri.runs}走）`,
        `▶ ${venue(makuri.race.venue_code)}${makuri.race.race_number}R ${makuri.boat}号艇 ${hmShort(makuri.race.start_time)}締切`,
      ],
    });

  if (info.length) lines.push("", ...info);
  if (blocks.length) {
    lines.push("", V3_RULE);
    for (const [i, b] of blocks.entries())
      lines.push(...(i ? [""] : []), ...b.lines);
    lines.push(V3_RULE);
  }
  if (nigashi) lines.push(V3_NIGASHI_NOTE);
  // 罫線の塊が無い日は、タグの前を1行空ける（塊のある日は罫線・注の直後）
  if (!blocks.length) lines.push("");
  lines.push(V3_TAG);

  // 2行目の最初と最後の締切のレースも、送る直前に中止を読み直す
  if (!top) mentioned.push(live[0], live.at(-1));
  const picks = [
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
  if (picks.some((p) => !raceById.has(p.race_id)))
    return { ok: false, reason: "pick_not_live" };
  return {
    ok: true,
    text: lines.join("\n"),
    picks,
    featured: top ? { race_id: top.race_id, boat_number: null } : null,
    blocks: blocks.map(({ key, race, boats, racer_id, rate, runs }) => ({
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
      holding: holding.map((v) => v.code),
      big_final: Boolean(bigFinal),
    },
  };
}

/**
 * 機械の検査（純粋関数）。返り値は通らなかった理由の配列（空なら通った）。禁止表現は計画の riskRules（今の /today と同じ）が別に見る
 * 長文の1投稿（親1件だけのスレッド）として X の加重で確かめる（今の /today と同じ。送る直前の preflight も同じ線）
 */
export function checkTodayDigestV3(text, { date, url }) {
  const problems = [];
  const lines = text.split("\n");
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
  if (/https?:\/\//.test(text.replace(url, ""))) problems.push("extra_link");
  if (lines.at(-1) !== V3_TAG) problems.push("tag_missing");
  if (/競艇/.test(text)) problems.push("kyotei");
  if (!xPostValid(text, { long: true })) problems.push("weighted_text_invalid");
  return problems;
}
