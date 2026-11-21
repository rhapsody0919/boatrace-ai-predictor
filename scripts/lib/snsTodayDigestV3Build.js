/**
 * snsTodayDigestV3.js の buildTodayDigestV3 から移した、本文を組む段（純粋）。順・文字・鍵の順は元のまま。
 * buildTodayDigestV3 が venueDayLabels → 載せるレース → 優勝戦・準優・開催中 → 率の塊 → 脚注 の順に呼ぶ。
 */
import { getVenueSeriesDayLabel } from "../../src/utils/raceDetailHeading.js";
import { buildSeriesDayByVenue } from "./raceSeriesLookup.js";
import { addDaysToDateString } from "./dateUtils.js";
import {
  GRADE_ORDER,
  LADY_KINDS,
  V3_FINAL,
  V3_LINK_LEAD,
  V3_MAX_FINALS,
  V3_MAX_SEMI_VENUES,
  V3_MIN_RUNS,
  V3_MIN_RUNS_FALLBACK,
  V3_NIGASHI_HEADING,
  gradeRank,
  hm,
  hmShort,
  isIsoDate,
  nameOf,
  nfkc,
  v3DateLine,
} from "./snsTodayDigestV3Base.js";

/** 会場ごとの何日目の表示（画面の getVenueSeriesDayLabel。race_conditions に無い日目は節から補う） */
export function venueDayLabels(
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

/** レースを引く道具（会場名・条件・節・グレード・大会名・並び・「会場R 締切」の表記） */
export function raceHelpers({ conditions, series }, t) {
  const venue = (code) => t(`venues.${code}`);
  const cond = new Map(conditions.map((c) => [c.race_id, c]));
  const seriesOf = new Map(series.map((s) => [Number(s.venue_code), s]));
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
  return { venue, cond, seriesOf, gradeOf, titleOf, byGrade, at };
}

/** 載せてよいレース。返り値 { held, venues, live } か { fail } */
export function liveRaces(races, sendAt) {
  // 中止は確定（confirmed）だけでなく疑い（tentative）も載せない。送る直前の検査（pickRaceStatus）は中止の値が入っていれば止めるので、
  // 載せると朝の投稿ごと送れなくなる（/code-review の指摘）
  const held = races.filter((r) => r.cancellation_status == null);
  const venues = new Set(held.map((r) => r.venue_code));
  if (!venues.size) return { fail: { ok: false, reason: "no_races" } };
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
  if (!live.length) return { fail: { ok: false, reason: "no_live_races" } };
  return { held, venues, live };
}

/** 1〜3行目: 日付と場の数（SG・G1 の優勝戦の日は大会名・最終日・会場）、🏆 優勝戦（無い日は最初と最後の締切）、リンク */
export function headerLines(
  { date, url, venues, live, top, bigFinal },
  h,
  dayLabels,
) {
  const { venue, titleOf, at } = h;
  const firstLast = `最初の締切 ${hmShort(live[0].start_time)} ${venue(live[0].venue_code)}${live[0].race_number}R・最後 ${hmShort(live.at(-1).start_time)} ${venue(live.at(-1).venue_code)}${live.at(-1).race_number}R`;
  return [
    bigFinal
      ? `${v3DateLine(date)}${titleOf(top)} ${dayLabels.get(top.venue_code) ?? "最終日"}（${venue(top.venue_code)}）`
      : `${v3DateLine(date)}今日のボートレース ${venues.size}場`,
    top ? `🏆 優勝戦 ${at(top)}` : firstLast,
    `${V3_LINK_LEAD}${url}`,
  ];
}

/** 2番目以降の優勝戦の行（info）と、載せたレース（mentioned） */
export function finalsInfo(finals, at) {
  const restFinals = finals.slice(1);
  if (!restFinals.length) return { info: [], mentioned: [] };
  const shown = restFinals.slice(0, V3_MAX_FINALS - 1);
  const more = restFinals.length - shown.length;
  return {
    info: [
      `【優勝戦】${shown.map(at).join("／")}${more ? `（ほか${more}場）` : ""}`,
    ],
    mentioned: shown,
  };
}

/** 準優勝戦は場ごとに1行（並びは優勝戦と同じ: グレード→最初の締切） */
export function semiInfo(semis, { venue, byGrade }) {
  const semiVenues = [...new Set(semis.map((r) => r.venue_code))]
    .map((code) =>
      semis
        .filter((r) => r.venue_code === code)
        .sort((a, b) => a.race_number - b.race_number),
    )
    .sort((a, b) => byGrade(a[0], b[0]));
  const shownSemi = semiVenues.slice(0, V3_MAX_SEMI_VENUES);
  const info = [];
  const mentioned = [];
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
  return { info, mentioned };
}

/** 【開催中】SG・G1・G2・G3 と女子戦。優勝戦・準優の行に出た場は重ねない。丸一日中止の場は出さない。返り値 { holding, info } */
export function holdingInfo({ venues, finals, semis, held }, h, dayLabels) {
  const { venue, seriesOf, gradeOf, titleOf } = h;
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
  const info = holding.map((v) => {
    const title = titleOf(v.race);
    const day = dayLabels.get(v.code);
    return `【開催中】${[GRADE_ORDER.includes(v.grade) ? v.grade : null, title, `${venue(v.code)}${day ?? ""}`].filter(Boolean).join(" ")}`;
  });
  return { holding, info };
}

/** 率の塊の材料: 欠場・出走表・選手×コースの率（窓の終わりが最新の行だけ）。返り値 { absent, entryOf, statOf, latestEnd } */
function rateIndex({ date, entries, exhibition, stats }) {
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
  // 率の窓: 窓の日付が壊れた行・終わりが前日より後の行は使わない。窓の終わりが今の最新（7:00 の時点では前々日）でない行（更新が止まった選手）も
  // 使わない。脚注の期間「〜{終わり}」を、載せた全員の率に当てはまる文にするため（/code-review の指摘）
  const yesterday = addDaysToDateString(date, -1);
  const usable = stats.filter(
    (s) =>
      isIsoDate(s.window_start) &&
      isIsoDate(s.window_end) &&
      s.window_start <= s.window_end &&
      s.window_end <= yesterday,
  );
  const latestEnd = usable.reduce(
    (m, s) => (s.window_end > m ? s.window_end : m),
    "",
  );
  const statOf = new Map(
    usable
      .filter((s) => s.window_end === latestEnd)
      .map((s) => [`${s.racer_id}|${s.course}`, s]),
  );
  return { absent, entryOf, statOf, latestEnd };
}

/** その艇・率の候補（レース順）。選手・率・走数がそろわない行は除く */
function rateCandidates(live, idx, boats, rateKey) {
  const { absent, entryOf, statOf } = idx;
  return live.flatMap((race) =>
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
      return [{ race, boat, entry: e, rate, runs: s.runs, stat: s }];
    }),
  );
}

// 率の高い順、同じ率は締切の早い順。走数30以上が無ければ10以上まで下げる。同じ選手・同じレースは2回出さない
// （選んだ物を覚えるので、呼ぶ順が結果に効く）
function makePicker() {
  const usedRaces = new Set();
  const usedRacers = new Set();
  return (list, extraOk = () => true) => {
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
}

const pct = (rate) => `${Math.round(rate)}%`;
const who = (e) => `${nameOf(e.player_name)} ${e.grade ?? ""}`.trim();

// 率の塊1つ（本文の3行と、記録の材料）
function rateBlock(found, { key, boats, heading }, venue, boatNo) {
  return {
    key,
    race: found.race,
    boats,
    racer_id: found.entry.racer_id,
    rate: found.rate,
    runs: found.runs,
    lines: [
      heading,
      `${who(found.entry)}\u3000${pct(found.rate)}（${found.runs}走）`,
      `▶ ${venue(found.race.venue_code)}${found.race.race_number}R ${boatNo}号艇 ${hmShort(found.race.start_time)}締切`,
    ],
  };
}

/**
 * 率の塊（逃げ・逃し・まくりの順に選ぶ）。返り値 { blocks, found: [nige, nigashi, makuri], nigashi, latestEnd }
 */
export function rateBlocks(live, material, venue) {
  const idx = rateIndex(material);
  const pick = makePicker();
  const blocks = [];
  const nige = pick(rateCandidates(live, idx, [1], "nige_rate"));
  if (nige)
    blocks.push(
      rateBlock(
        nige,
        { key: "nige", boats: [1], heading: "【逃げ率が高い選手】" },
        venue,
        1,
      ),
    );
  // 逃し率が高い選手: 2号艇の2コースの逃し率が最も高い選手（BOA-1324）。1号艇の名前は出さない。
  // 逃し率は「1コースの艇の逃げで決まった割合」なので、1号艇が出走する（欠場でない）レースに限る。名前を書くので2号艇の名前が無い行は選ばない
  const nigashi = pick(rateCandidates(live, idx, [2], "nigashi_rate"), (c) => {
    const one = idx.entryOf.get(`${c.race.race_id}:1`);
    return Boolean(
      one &&
      !idx.absent.has(`${c.race.race_id}:1`) &&
      nameOf(c.entry.player_name),
    );
  });
  if (nigashi)
    blocks.push(
      rateBlock(
        nigashi,
        // 載せるのは2号艇だけだが、1号艇の欠場も送る直前に読み直す（1号艇が欠場なら逃し率の前提が崩れる）
        { key: "nigashi", boats: [1, 2], heading: V3_NIGASHI_HEADING },
        venue,
        2,
      ),
    );
  const makuri = pick(rateCandidates(live, idx, [3, 4], "makuri_rate"));
  if (makuri)
    blocks.push(
      rateBlock(
        makuri,
        {
          key: "makuri",
          boats: [makuri.boat],
          heading: "【まくり率が高い選手】",
        },
        venue,
        makuri.boat,
      ),
    );
  return {
    blocks,
    found: [nige, nigashi, makuri],
    nigashi,
    latestEnd: idx.latestEnd,
  };
}

/** 脚注の期間: 載せた率の窓の初日の最も早い日〜窓の終わり（載せた全員で同じ。7:00 の時点では 2025-12-02〜前々日）。無ければ null */
export function periodOf(found, latestEnd) {
  const starts = found.filter(Boolean).map((c) => c.stat.window_start);
  return starts.length
    ? { from: starts.reduce((m, d) => (d < m ? d : m)), to: latestEnd }
    : null;
}
