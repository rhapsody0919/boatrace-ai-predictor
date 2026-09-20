/**
 * K/B中間形式（kb-day/v1）→ アーカイブ表（kb_archive_*）の行への変換
 *
 * 中間形式は全項目を持つが、DBへ入れるのは分析（BOA-271: アナロジー・ファインダー）で
 * 使う列だけに絞る。列を増やしたくなったら、この変換とDDLを更新し、生ファイルの再解析
 * （kb-backfill.js parse）→ 再投入（load）で追加する。公式サイトへの再リクエストは要らない。
 *
 * 命名の注意: 本体テーブル race_results は payout_trifecta=3連複・payout_trio=3連単と
 * 逆転している（DB命名の既知の癖）。アーカイブ表では payout_3tan（3連単）・payout_3fuku（3連複）
 * と曖昧さの無い名前にし、本体テーブルの逆転を持ち込まない。
 * 本体テーブルと値が完全一致しない列がある（例: local_win_rate は本体=racelistページ由来、
 * アーカイブ=Bファイル由来で、同じレースでも数値が異なる場合がある）ため、混ぜずに別表にしている。
 */

export const KB_ARCHIVE_TABLES = {
  venueDays: {
    table: "kb_archive_venue_days",
    onConflict: "venue_day_id",
    keyColumns: ["venue_day_id"],
    chunkColumn: "venue_day_id",
  },
  races: {
    table: "kb_archive_races",
    onConflict: "race_id",
    keyColumns: ["race_id"],
    chunkColumn: "race_id",
  },
  boats: {
    table: "kb_archive_boats",
    onConflict: "race_id,boat_number",
    keyColumns: ["race_id", "boat_number"],
    chunkColumn: "race_id",
  },
};

const pad2 = (n) => String(n).padStart(2, "0");

/** "1.49.3" → 109.3（秒）。取得できなければ null */
export function raceTimeToSeconds(raw) {
  if (!raw) return null;
  const m = /^(\d)\.(\d{2})\.(\d)$/.exec(raw);
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 10;
}

/**
 * ステージ名（K/Bでは8文字程度に切り詰められる）の大まかな区分。
 * 判定は名称の部分一致のみで、DBの race_stage（racelistページ由来）とは完全一致しない。
 * 原文は stage 列に残す。
 */
export function classifyStage(stage) {
  if (!stage) return null;
  if (stage.startsWith("準優")) return "semifinal";
  if (stage.startsWith("優勝") || stage.startsWith("優出")) return "final";
  if (stage.includes("予選") || stage.includes("予")) return "qualifier";
  return "other";
}

/** 同着（同じ着順が複数）の艇があるか */
function hasDeadHeat(rows) {
  const ranks = rows.filter((r) => r.rank !== null).map((r) => r.rank);
  return new Set(ranks).size !== ranks.length;
}

const firstPayout = (payouts, kind) =>
  payouts.find((p) => p.kind === kind) ?? null;

/**
 * @param {ReturnType<import("./kbFileParser.js").buildKbDay>} day
 * @returns {{venueDays: object[], races: object[], boats: object[], warnings: string[]}}
 */
export function buildArchiveRows(day) {
  const date = day.date;
  const venueDays = [];
  const races = [];
  const boats = [];
  const warnings = [];

  const kByVenue = new Map((day.k?.venues ?? []).map((v) => [v.venue_code, v]));
  const bByVenue = new Map((day.b?.venues ?? []).map((v) => [v.venue_code, v]));
  const venueCodes = [
    ...new Set([...kByVenue.keys(), ...bByVenue.keys()]),
  ].sort((a, b) => a - b);

  for (const vc of venueCodes) {
    const kv = kByVenue.get(vc) ?? null;
    const bv = bByVenue.get(vc) ?? null;
    if (kv?.status === "pending") {
      warnings.push(
        `${date} 会場${vc}: Kファイルが未確定（プレースホルダ）のため除外`,
      );
      continue;
    }
    const src = kv ?? bv;
    if (kv?.date_in_body && kv.date_in_body !== date) {
      warnings.push(
        `${date} 会場${vc}: Kファイル本文の日付が不一致（${kv.date_in_body}）`,
      );
    }
    const venueDayId = `${date}-${pad2(vc)}`;
    venueDays.push({
      venue_day_id: venueDayId,
      race_date: date,
      venue_code: vc,
      title: src.title ?? bv?.title ?? null,
      title_short: src.title_short ?? null,
      day_label: src.day_label ?? null,
      series_day: src.series_day ?? bv?.series_day ?? null,
      is_final_day: Boolean(src.is_final_day || bv?.is_final_day),
      has_k: Boolean(kv),
      has_b: Boolean(bv),
      race_grade: null, // race/index（boatrace.jp）で後から補完する。K/Bには無い
      created_at: null, // バックフィル行はNULL（取得時刻を偽らない。data-acquisition.md）
    });

    const kRaces = new Map((kv?.races ?? []).map((r) => [r.race_number, r]));
    const bRaces = new Map((bv?.races ?? []).map((r) => [r.race_number, r]));
    const raceNumbers = [...new Set([...kRaces.keys(), ...bRaces.keys()])].sort(
      (a, b) => a - b,
    );

    for (const rn of raceNumbers) {
      const kr = kRaces.get(rn) ?? null;
      const br = bRaces.get(rn) ?? null;
      const raceId = `${date}-${pad2(vc)}-${pad2(rn)}`;
      const payouts = kr?.payouts ?? [];
      const win = firstPayout(payouts, "win");
      const exacta = firstPayout(payouts, "exacta");
      const quinella = firstPayout(payouts, "quinella");
      const tri3t = firstPayout(payouts, "trifecta");
      const tri3f = firstPayout(payouts, "trio");
      const rows = kr?.rows ?? [];
      races.push({
        race_id: raceId,
        venue_day_id: venueDayId,
        race_date: date,
        venue_code: vc,
        race_number: rn,
        stage: kr?.stage ?? br?.stage ?? null,
        stage_kind: classifyStage(kr?.stage ?? br?.stage ?? null),
        distance_m: kr?.distance_m ?? br?.distance_m ?? null,
        deadline_time: br?.deadline_time ?? null,
        weather: kr?.weather ?? null,
        wind_direction: kr?.wind_direction ?? null,
        wind_speed: kr?.wind_speed ?? null,
        wave_height: kr?.wave_height ?? null,
        technique: kr?.technique ?? null,
        has_result: rows.length > 0,
        dead_heat: hasDeadHeat(rows),
        payout_win: win?.amount ?? null,
        payout_2tan: exacta?.amount ?? null,
        payout_2fuku: quinella?.amount ?? null,
        payout_3tan: tri3t?.amount ?? null,
        payout_3fuku: tri3f?.amount ?? null,
        combo_3tan: tri3t?.combo ?? null,
        popularity_3tan: tri3t?.popularity ?? null,
        created_at: null,
      });

      const kByBoat = new Map();
      for (const r of rows)
        if (!kByBoat.has(r.boat_number)) kByBoat.set(r.boat_number, r);
      const bByBoat = new Map(
        (br?.entries ?? []).map((e) => [e.boat_number, e]),
      );
      const boatNumbers = [
        ...new Set([...kByBoat.keys(), ...bByBoat.keys()]),
      ].sort((a, b) => a - b);
      for (const bn of boatNumbers) {
        const k = kByBoat.get(bn) ?? null;
        const e = bByBoat.get(bn) ?? null;
        if (k && e && k.racer_id !== e.racer_id) {
          warnings.push(
            `${raceId} ${bn}号艇: 登録番号がK(${k.racer_id})とB(${e.racer_id})で不一致（選手変更の可能性）`,
          );
        }
        boats.push({
          race_id: raceId,
          boat_number: bn,
          racer_id: k?.racer_id ?? e?.racer_id ?? null,
          class: e?.class ?? null,
          age: e?.age ?? null,
          branch: e?.branch ?? null,
          weight: e?.weight ?? null,
          national_win_rate: e?.national_win_rate ?? null,
          national_2rate: e?.national_2rate ?? null,
          local_win_rate: e?.local_win_rate ?? null,
          local_2rate: e?.local_2rate ?? null,
          motor_number: k?.motor_number ?? e?.motor_number ?? null,
          motor_2rate: e?.motor_2rate ?? null,
          boat_id: k?.boat_id ?? e?.boat_id ?? null,
          boat_2rate: e?.boat_2rate ?? null,
          exhibition_time: k?.exhibition_time ?? null,
          course: k?.course ?? null,
          start_timing: k?.start_timing ?? null,
          is_flying: k ? k.is_flying : null,
          is_late_start: k ? k.is_late_start : null,
          finish_raw: k?.finish_raw ?? null,
          finish_rank: k?.rank ?? null,
          race_seconds: raceTimeToSeconds(k?.race_time),
          created_at: null,
        });
      }
    }
  }
  return { venueDays, races, boats, warnings };
}
