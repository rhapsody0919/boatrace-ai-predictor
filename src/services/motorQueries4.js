// src/services/supabaseDataService.js から scripts/maintenance/split-data-layer.mjs で字のまま移した（領域: motor）。
// 本体の字下げは元のまま。手で直すときは普通の関数として直してよい

import { getTodayJST } from "../utils/dateUtils.js";
import { supabase } from "./supabaseClient";
import { addDaysToDateString } from "../../scripts/lib/dateUtils.js";
import { competitionRank } from "../utils/competitionRank.js";
import {
  VENUE_SITE_STATS_HIDDEN,
  rankBy,
  currentSeriesRiders,
  currentSeriesRange,
} from "../utils/venueMotorRanking.js";
import { withCache } from "./core.js";
import { getVenueMotorSnapshot } from "./motorQueries3.js";

/**
 * 指定会場・モーター番号が、同一会場内の全モーターの中で指標順に何位かを
 * 算出する（BOA-301 FR-1）。venue_motor_stats（会場公式サイト由来、BOA-264）の
 * 最新スクレイピング日1件分のスナップショットのみを対象とし、自社race_results
 * からの再計算は行わない（会場公式値の方が正確という既存合意、spec.md参照）。
 * metricがaccidentRate（事故率）の場合のみ昇順（低いほど良い）でランクする。
 * 値がnullのモーター（会場によって非公開の指標がある）はランキング対象外にし、
 * totalにも含めない
 * @param {number} venueCode
 * @param {number} motorNumber
 * @param {'winRate'|'top2Rate'|'top3Rate'|'accidentRate'} metric
 * @returns {Promise<{rank:number,total:number,metric:string,value:number,scrapedDate:string}|null>}
 */
export function getVenueMotorRanking(
    venueCode,
    motorNumber,
    metric = "top2Rate",
    asOfDate = null,
  ) {
    return withCache(
      // asOfDate（YYYY-MM-DD）を渡すと、その日以前で最新のスナップショットで順位を
      // 出す（過去レースのドリルダウン、BOA-521）
      // v2: 同じ値は同じ順位・tied を追加（BOA-529）
      // v3: 出走数 0 のモーターを順位・母数から外す（BOA-428。一覧の6基とそろえる）
      asOfDate === null
        ? `venue-motor-ranking-v3-${venueCode}-${motorNumber}-${metric}`
        : `venue-motor-ranking-v3-asof-${venueCode}-${motorNumber}-${metric}-${asOfDate}`,
      async () => {
        // 会場全体の取得は getVenueMotorSnapshot に任せる（会場×日付でキャッシュ。BOA-428）。
        // 取得の失敗・データ無しは、これまでどおり null（ドリルダウンは出さないだけ）
        const snapshot = await getVenueMotorSnapshot(venueCode, asOfDate);
        if (snapshot.state !== "ok") return null;

        const columnByMetric = {
          winRate: "win_rate",
          top2Rate: "top2_rate",
          top3Rate: "top3_rate",
          accidentRate: "accident_rate",
        };
        const column = columnByMetric[metric] ?? "top2_rate";
        // 事故率のみ低いほど良いため昇順、他は降順
        const ascending = metric === "accidentRate";

        // 出走数 0（入れ替え直後で集計前）のモーターは、値が 0 でも順位・母数に入れない。
        // 一覧の6基（getVenueMotorRanks）と同じ扱いにして、同じ画面で母数がずれないようにする（BOA-428）
        const valued = snapshot.rows.filter(
          (row) =>
            row[column] !== null &&
            row[column] !== undefined &&
            row.race_count !== 0,
        );
        const own = valued.find((row) => row.motor_number === motorNumber);
        if (!own) return null;
        // 同じ値は同じ順位（BOA-529）。並べ替えた位置を順位にすると、同値の中の
        // 順位が DB の行順で決まっていた
        const { rank, tied } = competitionRank(
          valued.map((row) => Number(row[column])),
          Number(own[column]),
          { ascending },
        );

        return {
          rank,
          tied,
          total: valued.length,
          metric,
          value: own[column],
          scrapedDate: snapshot.scrapedDate,
        };
      },
    );
  }

/**
 * レースの6基の「会場内順位」（会場公式サイトの2連率、`top2_rate`）をまとめて返す（BOA-428 子1）。
 * 会場全体を1回だけ引く（1基ずつ getVenueMotorRanking を呼ぶと 2クエリ×6）。
 *   - 当日のレースは最新のスナップショット（asOfDate = null）、過去のレースはレース日以前で最新
 *   - 浜名湖・宮島は会場サイトの値を出さない（VENUE_SITE_STATS_HIDDEN、2026-10-02 ユーザー判断）
 * @param {number} venueCode
 * @param {string|null} asOfDate
 *   - 出走数 0（集計前）のモーターは順位に入れない（画面は「-」）
 * @returns {Promise<{state:"ok", scrapedDate:string, periodEnd:string|null, total:number, ranks:Map<number,{rank:number,tied:number}>}|{state:"empty"}|{state:"error"}>}
 */
export async function getVenueMotorRanks(venueCode, asOfDate = null) {
    if (VENUE_SITE_STATS_HIDDEN.includes(Number(venueCode))) {
      return { state: "empty" };
    }
    const snapshot = await getVenueMotorSnapshot(venueCode, asOfDate);
    if (snapshot.state !== "ok") return { state: snapshot.state };
    // 出走数が 0 のモーター（入れ替え直後でまだ走っていない）は、2連率の 0 が「集計前」なので
    // 順位にも母数にも入れない（唐津は 9/22 時点で65基中19基。「40位タイ」と出ていた。データ精度検証）
    const rows = snapshot.rows.map((row) => ({
      motorNumber: row.motor_number,
      top2Rate: row.race_count === 0 ? null : row.top2_rate,
    }));
    const ranks = rankBy(rows, "top2Rate");
    if (ranks.size === 0) return { state: "empty" };
    // 会場サイトの集計の締め日。びわこ・唐津・大村は節の途中で止まっていて、取得日（10/3）と
    // 中身の時点（9/18 締め等）がずれる。締め日が混ざる会場（びわこは 9/09 と 9/18）は古い方を出す
    // （2026-10-02 ユーザー判断、ファン評価3周目の P1）。締め日の無い会場は null（画面は取得日）
    const periodEnds = snapshot.rows
      .map((row) => row.stats_period_end)
      .filter(Boolean)
      .sort();
    return {
      state: "ok",
      scrapedDate: snapshot.scrapedDate,
      periodEnd: periodEnds[0] ?? null,
      total: ranks.size,
      ranks,
    };
  }

const toNumber = (v) => (v === null || v === undefined ? null : Number(v));

// 会場サイトの値（スナップショット）と、会場の最新の前検日を並列で引く
function fetchSnapshotAndLatestPretest(venue, hidden) {
  return Promise.all([
    hidden
      ? Promise.resolve({ state: "empty" })
      : getVenueMotorSnapshot(venue, null),
    supabase
      .from("motor_pretest_stats")
      .select("race_date")
      .eq("venue_code", venue)
      .order("race_date", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
}

// 前検日の前検データと、節を含む出走表を並列で引く
function fetchPretestAndEntries(venue, pretestDate) {
  // 出走表は、節（最長7日）を含む前検日の8日前から今日まで。会場で絞る（race_id は
  // YYYY-MM-DD-VV-RR）。1日最大72行なので、9日分でも1000行の上限に届かない
  const venuePart = String(venue).padStart(2, "0");
  return Promise.all([
    supabase
      .from("motor_pretest_stats")
      .select("racer_id, motor_number, motor_2rate, pretest_time")
      .eq("venue_code", venue)
      .eq("race_date", pretestDate),
    supabase
      .from("race_entries")
      .select("race_id, racer_id, motor_number, motor_2rate, player_name")
      .like("race_id", `____-__-__-${venuePart}-%`)
      .gte("race_id", addDaysToDateString(pretestDate, -8))
      .lte("race_id", `${getTodayJST()}-99`),
  ]);
}

// 出走表に名前が無い選手の名前（racer_id → name）。該当が無ければ空の Map
async function fetchNamesWithoutEntry(pretestRows, riders) {
  // 出走表に名前が無い選手（まだ走っていない）だけ racer_profiles から引く
  const withoutName = [...new Set(pretestRows.map((r) => r.racer_id))].filter(
    (id) => ![...riders.values()].some((e) => e.racer_id === id),
  );
  if (withoutName.length === 0) return new Map();
  const { data: profiles } = await supabase
    .from("racer_profiles")
    .select("racer_id, name")
    .in("racer_id", withoutName);
  return new Map((profiles ?? []).map((p) => [p.racer_id, p.name]));
}

// 前検日があるときの、前検の行・節の使用者・節の範囲・名前の引き当て
async function fetchSeriesData(venue, pretestDate) {
  const [pretest, entries] = await fetchPretestAndEntries(venue, pretestDate);
  const pretestRows = pretest.data ?? [];
  const riders = currentSeriesRiders(entries.data ?? [], pretestDate);
  const seriesRange = currentSeriesRange(entries.data ?? [], pretestDate);
  const nameByRacer = await fetchNamesWithoutEntry(pretestRows, riders);
  return { pretestRows, riders, seriesRange, nameByRacer };
}

// 使用者は、今の節の出走表で直近に乗った選手（節の途中の入れ替えを反映する）。
// まだ走っていなければ前検データの選手。前検タイムはモーターの前検の値
function makeUserOf(pretestByMotor, riders, nameByRacer) {
  return (motorNumber) => {
    const p = pretestByMotor.get(motorNumber);
    const e = riders.get(motorNumber);
    const racerId = e?.racer_id ?? p?.racer_id ?? null;
    const name = e?.player_name ?? nameByRacer.get(racerId) ?? null;
    return {
      pretestTime: toNumber(p?.pretest_time),
      racerId,
      racerName: name?.replace(/\s+/g, "") ?? null,
      raceId: e?.race_id ?? null,
    };
  };
}

// 会場サイトの値があるとき（source: "venueSite"）の一覧
function buildVenueSiteList(snapshot, usedMotors, userOf) {
  // スナップショットに無いモーター（丸亀は入れ替え後の一部が欠ける）も、今節使われて
  // いれば一覧に出す（2連率は「-」）
  const motorNumbers = new Set([
    ...snapshot.rows.map((r) => r.motor_number),
    ...usedMotors,
  ]);
  const statsByMotor = new Map(snapshot.rows.map((r) => [r.motor_number, r]));
  return [...motorNumbers].map((motorNumber) => {
    const s = statsByMotor.get(motorNumber);
    return {
      motorNumber,
      // 出走数 0（入れ替え直後で集計前）の 0% は値として扱わない。順位・最良にも入れない
      // （6基の会場内順位・ドリルダウンと同じ扱い。BOA-428）
      top2Rate: s?.race_count === 0 ? null : toNumber(s?.top2_rate),
      finalCount: toNumber(s?.final_count),
      championshipCount: toNumber(s?.championship_count),
      // 会場サイトの出走数。入れ替え直後の数走の値が上位に並ぶので、2連率に添える
      // （ファン評価 2026-10-06 P1、ユーザー決定: 新しい列は足さない）
      raceCount: toNumber(s?.race_count),
      ...userOf(motorNumber),
    };
  });
}

// 会場サイトの値を出さない会場の一覧（source: "pretest"）
function buildPretestList(usedMotors, pretestByMotor, riders, userOf) {
  return usedMotors.map((motorNumber) => ({
    motorNumber,
    top2Rate: toNumber(
      pretestByMotor.get(motorNumber)?.motor_2rate ??
        riders.get(motorNumber)?.motor_2rate,
    ),
    finalCount: null,
    championshipCount: null,
    raceCount: null,
    ...userOf(motorNumber),
  }));
}

/**
 * 会場の全モーターの一覧（分析ツール「モーターランキング」、BOA-428 子3）。
 *
 * - 2連率・優出・優勝: 会場公式サイトのモーター成績の最新スナップショット（getVenueMotorSnapshot）
 * - 使用者・前検: `motor_pretest_stats` の会場の最新の前検日1日分（節の全選手がそろう。
 *   出走表の1日分だと、その日に走らない選手のモーターが欠ける）
 * - 会場サイトの値を出さない会場（戸田・平和島はデータが無い、浜名湖・宮島は出さない）は、
 *   前検データに載るモーターだけを BOATRACE 公式の2連率で並べる（source: "pretest"）
 * - 機番のリンク用に、そのモーターが今節走った直近のレース（race_id）を出走表から引く
 *
 * 取得の失敗は `{state:"error"}`。会場サイトの値の失敗を「データが無い」と取り違えて
 * 前検データだけの一覧に差し替えない（設計レビュー）
 * @param {number} venueCode
 * @returns {Promise<{state:"ok", source:"venueSite"|"pretest", scrapedDate:string|null,
 *   pretestDate:string|null, rows:Array<object>}|{state:"error"}>}
 */
export function getVenueMotorList(venueCode) {
    const venue = Number(venueCode);
    return withCache(`venue-motor-list-v2-${venue}`, async () => {
      const failed = { state: "error", fetchFailed: true };
      if (!supabase) {
        console.error("Supabase client not initialized");
        return failed;
      }
      const hidden = VENUE_SITE_STATS_HIDDEN.includes(venue);
      try {
        const [snapshot, latestPretest] = await fetchSnapshotAndLatestPretest(
          venue,
          hidden,
        );
        if (snapshot.state === "error") return failed;
        const pretestDate = latestPretest.data?.race_date ?? null;

        let series = {
          pretestRows: [],
          riders: new Map(),
          seriesRange: null,
          nameByRacer: new Map(),
        };
        if (pretestDate !== null) {
          series = await fetchSeriesData(venue, pretestDate);
        }
        const { pretestRows, riders, seriesRange, nameByRacer } = series;

        const pretestByMotor = new Map(
          pretestRows.map((r) => [r.motor_number, r]),
        );
        const userOf = makeUserOf(pretestByMotor, riders, nameByRacer);
        // 今の節で使われたモーター（前検データ ∪ その節の出走表）
        const usedMotors = [
          ...new Set([...pretestByMotor.keys(), ...riders.keys()]),
        ];

        if (snapshot.state === "ok") {
          return {
            state: "ok",
            source: "venueSite",
            scrapedDate: snapshot.scrapedDate,
            pretestDate,
            seriesRange,
            rows: buildVenueSiteList(snapshot, usedMotors, userOf),
          };
        }

        // 会場サイトの値を出さない会場: 今節使われたモーターだけを BOATRACE 公式の2連率で
        // （前検データの値。節の途中で入ったモーターは出走表の値）
        return {
          state: "ok",
          source: "pretest",
          scrapedDate: null,
          pretestDate,
          seriesRange,
          rows: buildPretestList(usedMotors, pretestByMotor, riders, userOf),
        };
      } catch (err) {
        console.error("会場のモーター一覧の取得エラー(例外):", err.message);
        return failed;
      }
    });
  }
