/**
 * 朝の初期化（races-init）の shadow で記録する、レースごとのダイジェスト（純粋関数。DB・取得先に接続しない）。
 *
 * shadow は、取得・解析までして、races・race_entries へは書かない。書かない代わりに、解析した出走表の
 * ダイジェスト（レースごとの短いハッシュ）を scrape_job_state.cursor に残し、既存基盤（GitHub Actions の
 * morning-init）が races・race_entries に書いた値から同じ関数で計算したダイジェストと比べて、一致率を測る
 * （scripts/maintenance/check-morning-init-shadow.js。plan.md §4.6、tasks.md T4b-07-7）。
 *
 * 比べる項目は、その日のうちに変わらない識別情報に限る:
 *   - 発走予定時刻（HH:MM）
 *   - 艇ごとの 枠番・登録番号・級別・年齢・モーター番号・ボート番号
 * 勝率などの数値は、取得元の表記（文字列→数値）とDBの numeric の丸めの差で、内容が同じでも一致しなくなる恐れがあり、
 * 識別には不要なため含めない。天候・展示・予測（predictions）も、別経路が更新する値のため含めない。
 */
import { createHash } from "node:crypto";

const pad2 = (n) => String(n).padStart(2, "0");

/** race_id（YYYY-MM-DD-VV-RR）。generate-predictions.js の generateRaceId と同じ形式 */
export function raceIdOf(date, placeCd, raceNo) {
  return `${date}-${pad2(placeCd)}-${pad2(raceNo)}`;
}

// undefined・null・NaN を同一視する（DBのNULLと、解析できなかった値を同じ表記に揃える）
const norm = (v) =>
  v === undefined || v === null || (typeof v === "number" && Number.isNaN(v))
    ? ""
    : String(v);

/** "HH:MM" または "HH:MM:SS" → "HH:MM"（無ければ空文字） */
const hhmm = (t) => (t ? String(t).slice(0, 5) : "");

function hash(parts) {
  return createHash("sha1").update(parts.join("\n")).digest("hex").slice(0, 12);
}

/**
 * 解析したレース1件（scrape-to-json.js の scrapeVenue が返す races の要素）のダイジェスト。
 * 選手が1人もいないレースは、DBに行が作られない（予測が作れない）ため null。
 *
 * @param {string} date YYYY-MM-DD
 * @param {{placeCd: number, raceNo: number, startTime: string|null, racers: Array<Object>}} race
 * @returns {{raceId: string, digest: string, entryCount: number}|null}
 */
export function digestScrapedRace(date, race) {
  if (!race.racers || race.racers.length === 0) return null;
  const entries = [...race.racers]
    .sort((a, b) => a.lane - b.lane)
    .map((r) =>
      [r.lane, r.racerId, r.grade, r.age, r.motorNumber, r.boatNumber]
        .map(norm)
        .join(":"),
    );
  const raceId = raceIdOf(date, race.placeCd, race.raceNo);
  return {
    raceId,
    digest: hash([raceId, hhmm(race.startTime), ...entries]),
    entryCount: entries.length,
  };
}

/** 会場のレース一覧（scrapeVenue の返り値）→ {race_id: ダイジェスト} と件数 */
export function digestScrapedVenue(date, venue) {
  const digests = {};
  let races = 0;
  let entries = 0;
  for (const race of venue.races) {
    const d = digestScrapedRace(date, { ...race, placeCd: venue.placeCd });
    if (!d) continue;
    digests[d.raceId] = d.digest;
    races++;
    entries += d.entryCount;
  }
  return { digests, races, entries };
}

/**
 * DBの行（races・race_entries）から、同じ形のダイジェストを作る。
 *
 * @param {{race_id: string, start_time: string|null}} raceRow races の行
 * @param {Array<Object>} entryRows race_entries の行（同じレースの分）
 * @returns {string|null} 選手がいなければ null
 */
export function digestDbRace(raceRow, entryRows) {
  if (!entryRows || entryRows.length === 0) return null;
  const entries = [...entryRows]
    .sort((a, b) => a.boat_number - b.boat_number)
    .map((e) =>
      [
        e.boat_number,
        e.racer_id,
        e.grade,
        e.age,
        e.motor_number,
        e.boat_number_id,
      ]
        .map(norm)
        .join(":"),
    );
  return hash([raceRow.race_id, hhmm(raceRow.start_time), ...entries]);
}

/**
 * shadow のダイジェストと、DBの行から計算したダイジェストを比べる。
 *
 * @param {Record<string, string>} shadowDigests race_id → ダイジェスト（shadow が記録したもの）
 * @param {Array<Object>} raceRows races の行
 * @param {Array<Object>} entryRows race_entries の行
 * @param {{excludeRaceIds?: Iterable<string>}} [options] excludeRaceIds: 比較しないレース。
 *   中止・順延が確定したレースは、公式ページの発走予定時刻が仮の値（日全体の順延なら 10:00 から6分刻み）に
 *   置き換わり、朝にDBへ書いた時刻と一致しない。時刻が意味を持たないため、比較の対象から外す
 * @returns {{matched: number, mismatched: Array<{race_id: string, shadow: string, db: string}>,
 *   missingInDb: string[], extraInDb: string[], excluded: number}}
 *   missingInDb: shadow にあるが DB に無い（既存基盤が未初期化・書けなかった）／
 *   extraInDb: DB にあるが shadow に無い（shadow が取りこぼした会場・レース）／
 *   excluded: 比較から外した件数（shadow のダイジェストがあるレースのうち）
 */
export function compareRaceDigests(
  shadowDigests,
  raceRows,
  entryRows,
  { excludeRaceIds = [] } = {},
) {
  const excludedIds = new Set(excludeRaceIds);
  const entriesBy = new Map();
  for (const e of entryRows) {
    if (!entriesBy.has(e.race_id)) entriesBy.set(e.race_id, []);
    entriesBy.get(e.race_id).push(e);
  }
  const dbDigests = new Map();
  for (const r of raceRows) {
    const d = digestDbRace(r, entriesBy.get(r.race_id));
    if (d) dbDigests.set(r.race_id, d);
  }
  const out = {
    matched: 0,
    mismatched: [],
    missingInDb: [],
    extraInDb: [],
    excluded: 0,
  };
  for (const [raceId, digest] of Object.entries(shadowDigests)) {
    if (excludedIds.has(raceId)) {
      out.excluded++;
      continue;
    }
    const db = dbDigests.get(raceId);
    if (!db) out.missingInDb.push(raceId);
    else if (db === digest) out.matched++;
    else out.mismatched.push({ race_id: raceId, shadow: digest, db });
  }
  for (const raceId of dbDigests.keys()) {
    if (excludedIds.has(raceId)) continue;
    if (!(raceId in shadowDigests)) out.extraInDb.push(raceId);
  }
  out.missingInDb.sort();
  out.extraInDb.sort();
  return out;
}
