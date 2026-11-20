// 予測のリフレッシュ（mainRefresh）と朝の生成（generateAndWriteFromRacesData）の、同期の部品（引数の解決・対象レースの決定・
// Deploy Hook・ログ）。scripts/daily/generate-predictions.js から元のまま移した（await は呼び元に残す）。
import { supabase } from "./supabaseClient.js";
import { getRacesInWindow } from "./raceSchedule.js";
import { decideDeployHook } from "./deployHookPolicy.js";
import { formatSkipSummary } from "./unchangedRows.js";

/** mainRefresh の引数を既定値つきで解く（既定の引数を関数の外へ出す。既定の値は元のまま） */
export function resolveRefreshOptions({
  isDryRun,
  specificRaceIds,
  forceTouchRaces = false,
  date: dateArg,
  writeMode = "upsert",
  includeStarted = false,
  client = supabase,
  now = () => new Date(),
}) {
  return {
    isDryRun,
    specificRaceIds,
    forceTouchRaces,
    dateArg,
    writeMode,
    includeStarted,
    client,
    now,
  };
}

/** リフレッシュの開始のログ（モードと時刻） */
export function logRefreshStart(isDryRun, now) {
  console.log(`🔄 予測リフレッシュモード${isDryRun ? " [DRY-RUN]" : ""}`);
  console.log(`⏰ ${now().toISOString()}`);
}

/** DRY-RUN で予測を生成した件数のログ */
export function logRefreshDryRun(raceCount) {
  console.log(
    `\n[DRY-RUN] ${raceCount}レースの予測を生成（Supabase書き込みはスキップ）`,
  );
}

/** races.volatility 更新の件数の要約文 */
export function volatilitySummary(stats, fallback) {
  return formatSkipSummary("races volatility", stats, { fallback });
}

/** races.volatility の1行の更新エラーのログ */
export function logVolatilityUpdateError(raceId, error) {
  console.error(`❌ races volatility更新エラー (${raceId}):`, error.message);
}

/** 書き込み方式と client を確かめる。満たさなければ例外（CLI の呼び出し側は catch して終了コード1にする） */
export function assertRefreshReady(writeMode, client) {
  if (writeMode !== "upsert") {
    throw new Error(
      `writeMode が不正です: ${writeMode}（"replace" は BOA-628 で廃止。"upsert" のみ）`,
    );
  }
  if (!client) {
    // Vercel Function から呼ぶため、process.exit ではなく例外にする（CLI の呼び出し側は catch して終了コード1にする）
    throw new Error(
      "Supabase環境変数が未設定です（SUPABASE_URL / SUPABASE_SERVICE_KEY）",
    );
  }
}

/** 更新対象の race_id を決める。指定が無ければ発走60/30/15/10/5分前ウィンドウのレースを自動検出する */
export function resolveTargetRaceIds(schedule, specificRaceIds) {
  const targetRaceIds = specificRaceIds || [];
  if (targetRaceIds.length === 0) {
    // 自動検出: 発走60/30/15/10/5分前ウィンドウのレース
    const WINDOWS = [60, 30, 15, 10, 5];
    const seen = new Set();
    for (const min of WINDOWS) {
      for (const r of getRacesInWindow(schedule, min, 8)) {
        if (!seen.has(r.race_id)) {
          seen.add(r.race_id);
          targetRaceIds.push(r.race_id);
        }
      }
    }
  }
  return targetRaceIds;
}

/** 発走済みのレースを対象から外す（BOA-628）。発走時刻が無いレースは、判定できないので従来どおり残す */
export function dropStartedRaceIds(targetRaceIds, schedule, now) {
  const startById = new Map(schedule.map((r) => [r.race_id, r.start_time]));
  const started = targetRaceIds.filter(
    (id) => startById.has(id) && startById.get(id) <= now(),
  );
  if (started.length > 0) {
    console.log(`⏭️ 発走済みの${started.length}レースは書かない`);
    return targetRaceIds.filter((id) => !started.includes(id));
  }
  return targetRaceIds;
}

/**
 * 更新対象の race_id を決める。includeStarted でなければ発走済みのレースを外す（BOA-628）。
 * 発走時刻が無いレースは、判定できないので従来どおり書く
 */
export function selectTargetRaceIds(schedule, specificRaceIds, includeStarted, now) {
  const targetRaceIds = resolveTargetRaceIds(schedule, specificRaceIds);
  return includeStarted
    ? targetRaceIds
    : dropStartedRaceIds(targetRaceIds, schedule, now);
}

/** レースの選手IDの集合（racer_aggregated_stats の一括取得用） */
export function collectRacerIds(races) {
  const allRacerIds = new Set();
  for (const race of races) {
    for (const racer of race.racers) {
      if (racer.racerId) allRacerIds.add(racer.racerId);
    }
  }
  return allRacerIds;
}

/** races.volatility 系列の1行の更新（await は呼び元。問い合わせをそのまま返す） */
export function updateRaceVolatilityRow(client, row, volatilityAt) {
  const { race_id: raceId, ...columns } = row;
  return client
    .from("races")
    .update({ ...columns, updated_at: volatilityAt })
    .eq("race_id", raceId);
}

/** Vercel Deploy Hook の応答を見て、成否をログに出す（fetchは4xx/5xxでも例外を投げないため） */
export function reportDeployHookResponse(res) {
  if (res.ok) {
    console.log("🚀 Vercel Deploy Hook トリガー済み");
  } else {
    console.warn(`⚠️ Vercel Deploy Hook 失敗: HTTP ${res.status}`);
  }
}

/**
 * Vercel Deploy Hook をトリガーする（await は呼び元）。毎回叩くと約6分ごとに本番が再デプロイされるため、
 * 毎時の先頭数分間かつ更新があった場合に限る（判定の理由は lib/deployHookPolicy.js）。
 * 叩かないときは undefined を返す
 */
export function triggerDeployHook(at, changedRaceCount) {
  const deployHook = process.env.VERCEL_DEPLOY_HOOK;
  const hookDecision = decideDeployHook({
    hookUrl: deployHook,
    now: at,
    changedRaceCount,
  });
  if (hookDecision.trigger) return postDeployHook(deployHook);
  if (deployHook) {
    console.log(`⏭️ Vercel Deploy Hook スキップ（${hookDecision.reason}）`);
  }
  return undefined;
}

/** Deploy Hook へ POST し、応答の成否と例外をログに出す（失敗は握りつぶさずログへ。呼び元は待つだけ） */
export function postDeployHook(deployHook) {
  let pending;
  try {
    pending = Promise.resolve(fetch(deployHook, { method: "POST" }));
  } catch (e) {
    pending = Promise.reject(e);
  }
  return pending
    .then(reportDeployHookResponse)
    .catch((e) => console.warn("⚠️ Vercel Deploy Hook 失敗:", e.message));
}

/** racesData の全会場・全レースから、選手IDの集合を集める（racer_aggregated_stats の一括取得用） */
export function collectRacerIdsFromVenues(venues) {
  const allRacerIds = new Set();
  for (const venue of venues) {
    if (!venue.races) continue;
    for (const race of venue.races) {
      if (!race.racers) continue;
      for (const racer of race.racers) {
        if (racer.racerId) allRacerIds.add(racer.racerId);
      }
    }
  }
  return allRacerIds;
}

/** 会場別の1コース勝率（90日実績）の取得数をログに出す（mainRefresh と generateAndWriteFromRacesData が共有） */
export function logVenueWinRateCount(cache) {
  if (Object.keys(cache).length > 0) {
    console.log(
      `🏟️  ${Object.keys(cache).length}会場の1コース勝率（90日実績）を取得しました`,
    );
  }
}
