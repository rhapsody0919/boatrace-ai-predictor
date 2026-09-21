/**
 * BOATCASTのオリジナル展示（bc_oriten。N25）の取得ジョブ（docs/design/boatcast-original-exhibition/）。
 * api/cron/boatcast-oriten.js が、共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で使う。
 *
 * 窓型ジョブ（レジストリ boatcast_oriten）。1スロット＝1レース。期限は発走の8分前（公開は発走の9.9〜29.0分前に
 * 現れる実測。oritenRows.js の decideNotPublished）。対象は、公開マップ（publicMap.js）で status='public' の会場の
 * 全レースだけ（createOritenStore が、予定表のスロットを対象会場のレースにだけ作る）。
 * 取得・解析・書き込みの本体 processOritenRace は、定期取得と過去分の一括取得（将来のCLI）が共有する。
 *
 * モード（scrape_job_state.mode。DBの更新のみで切り替える）:
 *   off（または行なし）  共通ラッパが何もしない（この関数は呼ばれない）
 *   shadow              取得・解析のみ。DBには書かない。予定表に result_digest（解析内容のハッシュ）を記録する
 *   live                race_original_exhibition・race_original_exhibition_values へ書く（変更のあるときだけ）
 *
 * 403の扱い（boatcastClient.js の冒頭を参照）: 各tickの先頭（スロットを取った後の最初の取得の前）で、既知の存在ファイル
 * （カナリア）を1回取る。カナリアが失敗なら、その回の取得を全て止め、alerts に出す。カナリアが正常なときの403は、
 * 「未公開または公開されないレース」として、最大3回まで再試行し、打ち切る（skipped_not_target）。
 *
 * 書き込みの順序: 艇×項目の行 → レース単位の行（content_hash は「書き込み完了」の目印）。途中で失敗しても、
 * 次の取得が同じ内容を書き直す。マイグレーション091が未適用のDBでは、書かずに error を返す（成功にしない）。
 */
import {
  compareLabelsToMap,
  buildOritenRows,
  computeOritenHash,
  decideNotPublished,
} from "./oritenRows.js";
import { ORITEN_STATUSES, parseOritenText } from "./oritenParser.js";
import {
  ORITEN_PUBLIC_MAP,
  expectedValueRows,
  venueEntry,
  venueOfRaceId,
} from "./publicMap.js";
import {
  buildOritenUrl,
  checkCanary,
  fetchBoatcast,
  sharedPacer,
} from "./boatcastClient.js";
import { ORITEN_TABLES, detectBoatcastSchema } from "./oritenSchema.js";
import { upsertChangedRows } from "../unchangedRows.js";
import { createSupabaseStore } from "../scrapeJobs/store.js";
import { SCRAPE_JOBS } from "../scrapeJobs/registry.js";
import { computeRetryAt } from "../scrapeJobs/outcomes.js";
import {
  addSeconds,
  raceStartInstant,
  slotDeadline,
  slotWindowEnd,
} from "../scrapeJobs/time.js";

export const ORITEN_JOB = "boatcast_oriten";

/** スロットの outcome の語彙は共通ラッパのもの（outcomes.js）。データ無し（打ち切り）は skipped_not_target */
export const ORITEN_OUTCOMES = Object.freeze({
  ok: "ok",
  noData: "skipped_not_target",
  pending: "no_values",
  error: "error",
});

const failure = (message, extra = {}) => ({
  outcome: ORITEN_OUTCOMES.error,
  error: message,
  ...extra,
});

/** 通知の持続時間 */
const CANARY_ALERT_MIN = 60;
const ANOMALY_ALERT_HOURS = 6;
const VENUE_ALERT_HOURS = 12;

/** 会場の当日のデータ無し（打ち切り）が、この件数以上かつ、完了したレースの半分以上になったら通知する（暫定の閾値） */
export const VENUE_NO_DATA_ALERT = Object.freeze({
  minCount: 3,
  minRatio: 0.5,
});

/**
 * 1レースのオリジナル展示を、取得・解析し、live なら書き込む。
 *
 * @param {Object} params
 * @param {string} params.raceId
 * @param {{race_date?: string, start_time?: string}|null} params.race races の行（無ければ失敗）
 * @param {"shadow"|"live"} params.mode
 * @param {(url: string) => Promise<{status: number, text: string|null, lastModified: string|null}>} params.fetchText
 * @param {import("@supabase/supabase-js").SupabaseClient} params.client
 * @param {number} [params.minutesToStart] 発走までの分（403のときの再試行の判断に使う。不明・過去日は、打ち切り）
 * @param {typeof ORITEN_PUBLIC_MAP} [params.map]
 * @returns {Promise<{outcome: string, rowsWritten?: number, rowsParsed?: number, rowsExpected?: number, resultDigest?: string, error?: string, retrySec?: number, noData?: boolean, anomalies?: string[], warnings?: string[]}>}
 */
export async function processOritenRace({
  raceId,
  race,
  mode,
  fetchText,
  client,
  minutesToStart,
  map = ORITEN_PUBLIC_MAP,
}) {
  if (!race) return failure(`races に ${raceId} の行がありません`);
  const jo = venueOfRaceId(raceId);
  const entry = venueEntry(jo, map);
  if (!entry || entry.status !== "public") {
    // 公開マップの対象外の会場（江戸川・未確認の会場）。取得しない（スロットも作らない。この経路は通常は通らない）
    return { outcome: ORITEN_OUTCOMES.noData, rowsWritten: 0, notInMap: true };
  }

  const res = await fetchText(buildOritenUrl(raceId));
  if (res.status === 403) {
    // カナリアが正常（呼び出し側が、取得の前に確認済み）なので、403は「まだ無い、または無い」
    const decision = decideNotPublished(minutesToStart);
    if (decision.final) {
      return {
        outcome: ORITEN_OUTCOMES.noData,
        rowsWritten: 0,
        noData: true,
      };
    }
    return {
      outcome: ORITEN_OUTCOMES.pending,
      rowsWritten: 0,
      retrySec: decision.retrySec,
    };
  }
  if (res.status !== 200) {
    return failure(
      `オリジナル展示の取得が HTTP ${res.status} でした: ${buildOritenUrl(raceId)}`,
    );
  }

  const parsed = parseOritenText(res.text);
  if (parsed.status === ORITEN_STATUSES.unrecognized) {
    return failure(`parse_anomaly: ${parsed.anomalies.join(" / ")}`, {
      anomalies: parsed.anomalies,
    });
  }

  // 公開マップとの照合（位置ではなくラベル）。既知でないラベル・マップと違う項目名は、値を保存した上で通知する
  const cmp = compareLabelsToMap(parsed.labels, entry.items);
  const warnings = [];
  if (parsed.unknownLabels.length > 0) {
    warnings.push(
      `${jo}${entry.name} ${raceId}: 未知の項目名 ${parsed.unknownLabels.join(",")}`,
    );
  }
  if (cmp.unexpected.length > 0 || cmp.missing.length > 0) {
    warnings.push(
      `${jo}${entry.name} ${raceId}: 公開マップと項目名が違います（マップに無い: ${cmp.unexpected.join(",") || "なし"} / ファイルに無い: ${cmp.missing.join(",") || "なし"}）`,
    );
  }

  const measured = parsed.status === ORITEN_STATUSES.measured;
  const base = {
    resultDigest: computeOritenHash(parsed),
    rowsParsed: parsed.rows.length * parsed.labels.length,
    // 計測不可（ファイルの状態2）は、値の行が無いのが正常
    rowsExpected: measured ? expectedValueRows(jo, 6, map) : 0,
    warnings,
  };
  if (mode !== "live") {
    return { ...base, outcome: ORITEN_OUTCOMES.ok, rowsWritten: 0 };
  }

  // --- live の書き込み ---
  if (!(await detectBoatcastSchema(client, ORITEN_TABLES))) {
    return failure(
      "マイグレーション091（race_original_exhibition・race_original_exhibition_values）が未適用のため、書き込みませんでした",
      base,
    );
  }
  const rows = buildOritenRows(parsed, {
    raceId,
    lastModified: res.lastModified,
  });

  // 内容が既存と同じなら、何も書かない（変更の無い行は書かない）
  const { data: existing, error: existingError } = await client
    .from("race_original_exhibition")
    .select("content_hash, parser_version")
    .eq("race_id", raceId)
    .maybeSingle();
  if (existingError) {
    return failure(
      `race_original_exhibition の読み取りに失敗しました: ${existingError.message}`,
      base,
    );
  }
  if (
    existing &&
    existing.content_hash === rows.report.content_hash &&
    existing.parser_version === rows.report.parser_version
  ) {
    return { ...base, outcome: ORITEN_OUTCOMES.ok, rowsWritten: 0 };
  }

  let rowsWritten = 0;
  if (rows.values.length > 0) {
    const valueResult = await upsertChangedRows(
      client,
      "race_original_exhibition_values",
      rows.values,
      {
        onConflict: "race_id,boat_number,kind",
        keyColumns: ["race_id", "boat_number", "kind"],
        chunkSize: 10,
        stampUpdatedAt: true,
        label: "race_original_exhibition_values",
      },
    );
    if (valueResult.error) return failure(valueResult.error.message, base);
    rowsWritten += valueResult.written;
  }
  if (existing) {
    // 内容が変わったとき、新しい内容に無い艇・項目の行を残さない（通常は起きない）
    const staleError = await deleteStaleValues(client, raceId, rows.values);
    if (staleError) return failure(staleError, base);
  }
  const reportResult = await upsertChangedRows(
    client,
    "race_original_exhibition",
    [rows.report],
    {
      onConflict: "race_id",
      keyColumns: ["race_id"],
      stampUpdatedAt: true,
      label: "race_original_exhibition",
    },
  );
  if (reportResult.error) return failure(reportResult.error.message, base);
  rowsWritten += reportResult.written;
  return { ...base, outcome: ORITEN_OUTCOMES.ok, rowsWritten };
}

/** 新しい内容に無い（艇, 項目）の既存行を消す。失敗なら、エラーメッセージ */
async function deleteStaleValues(client, raceId, newValues) {
  const { data, error } = await client
    .from("race_original_exhibition_values")
    .select("boat_number, kind")
    .eq("race_id", raceId);
  if (error) return `既存の値の読み取りに失敗しました: ${error.message}`;
  const keep = new Set(newValues.map((v) => `${v.boat_number}|${v.kind}`));
  for (const row of data ?? []) {
    if (keep.has(`${row.boat_number}|${row.kind}`)) continue;
    const { error: deleteError } = await client
      .from("race_original_exhibition_values")
      .delete()
      .eq("race_id", raceId)
      .eq("boat_number", row.boat_number)
      .eq("kind", row.kind);
    if (deleteError) {
      return `古い値の削除に失敗しました: ${deleteError.message}`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// tick（1回の起動）ごとの通知の材料。ハンドラー（スロットごと）と、ストア（起動の終わりの記録）が共有する。
// 起動ごとに一意な ctx.worker（cronWrapper の defaultWorker）を鍵にする（関数インスタンスが複数の起動を並行して
// 処理しても、混ざらない）。
// ---------------------------------------------------------------------------
/** @type {Map<string, ReturnType<typeof newTick>>} */
const ticks = new Map();
const TICK_RETENTION_MS = 10 * 60 * 1000;

function newTick(worker, nowMs) {
  return {
    worker,
    startedMs: nowMs,
    canary: null,
    canaryPromise: null,
    anomalies: [],
    warnings: [],
    venueAlerts: [],
  };
}

/** 起動の通知の材料を、無ければ作る。古いものは捨てる */
export function tickOf(worker, nowMs = Date.now()) {
  for (const [key, t] of ticks) {
    if (nowMs - t.startedMs > TICK_RETENTION_MS) ticks.delete(key);
  }
  let t = ticks.get(worker);
  if (!t) {
    t = newTick(worker, nowMs);
    ticks.set(worker, t);
  }
  return t;
}

/** 起動の通知の材料を取り出して、消す */
export function takeTick(worker) {
  const t = ticks.get(worker);
  ticks.delete(worker);
  return t ?? null;
}

/** テスト用 */
export function clearTicks() {
  ticks.clear();
}

const iso = (date) => date.toISOString();

/**
 * scrape_job_state.last_report（monitor が alerts を Slack に通知する）の更新内容を作る（純関数）。
 * 前回の通知のうち有効期限（until）内のものは残し、canary が正常なら canary_failed を外す。変化が無ければ undefined
 * （書かない）。
 *
 * @param {{alerts?: Array<{key: string, text: string, until?: string}>}|null|undefined} previous
 * @param {ReturnType<typeof newTick>} tick
 * @param {Date} now
 */
export function mergeReport(previous, tick, now) {
  const prevAlerts = Array.isArray(previous?.alerts) ? previous.alerts : [];
  let alerts = prevAlerts.filter(
    (a) => a?.until && new Date(a.until).getTime() > now.getTime(),
  );
  const drop = (key) => {
    alerts = alerts.filter((a) => a.key !== key);
  };
  const put = (alert) => {
    drop(alert.key);
    alerts.push(alert);
  };

  if (tick.canary) {
    if (tick.canary.ok) {
      drop("canary_failed");
    } else {
      put({
        key: "canary_failed",
        text: `BOATCASTのカナリアが失敗しました（アクセス拒否・接続の異常の疑い。取得を止めています）: ${tick.canary.detail}`,
        until: iso(addSeconds(now, CANARY_ALERT_MIN * 60)),
      });
    }
  }
  const anomalyCount = tick.anomalies.length + tick.warnings.length;
  if (anomalyCount > 0) {
    const example = tick.anomalies[0] ?? tick.warnings[0];
    put({
      key: "parse_anomaly",
      text: `解析の異常 ${anomalyCount}件（構造の異常${tick.anomalies.length}件・項目名の不一致${tick.warnings.length}件。BOATCAST側の形式変更・公開マップの古さの疑い）: ${example}`,
      until: iso(addSeconds(now, ANOMALY_ALERT_HOURS * 3600)),
    });
  }
  for (const alert of tick.venueAlerts) {
    put({ ...alert, until: iso(addSeconds(now, VENUE_ALERT_HOURS * 3600)) });
  }

  const next = { alerts };
  const before = { alerts: prevAlerts };
  if (JSON.stringify(next) === JSON.stringify(before)) return undefined;
  return next;
}

/**
 * 会場の当日のデータ無し（打ち切り）が多いときの通知（公開マップが古い・会場が非公開にした、の検知）。
 * いま打ち切る1件を含めて数える。
 *
 * @returns {Promise<{key: string, text: string}|null>}
 */
export async function evaluateVenueNoData(
  client,
  raceId,
  map = ORITEN_PUBLIC_MAP,
) {
  const jo = venueOfRaceId(raceId);
  const date = String(raceId).slice(0, 10);
  const { data, error } = await client
    .from("scrape_slots")
    .select("outcome, status")
    .eq("job", ORITEN_JOB)
    .eq("race_date", date)
    .like("race_id", `${date}-${jo}-%`)
    .eq("status", "done");
  if (error) return null; // 通知の材料が取れないだけ。取得は続ける
  const finished = data ?? [];
  const noData =
    finished.filter((r) => r.outcome === ORITEN_OUTCOMES.noData).length + 1;
  const total = finished.length + 1;
  if (
    noData < VENUE_NO_DATA_ALERT.minCount ||
    noData / total < VENUE_NO_DATA_ALERT.minRatio
  ) {
    return null;
  }
  const name = venueEntry(jo, map)?.name ?? jo;
  return {
    key: `no_data:${jo}`,
    text: `${name}(${jo})の${date}のオリジナル展示が、完了${total}レース中${noData}レースでデータ無し（403）です。会場が非公開にした・公開マップが古い可能性`,
  };
}

/** races の1行を読む。無ければ null。DBエラーは例外 */
async function loadRace(client, raceId) {
  const { data, error } = await client
    .from("races")
    .select("race_id, race_date, start_time")
    .eq("race_id", raceId)
    .maybeSingle();
  if (error)
    throw new Error(`races の読み取りに失敗しました: ${error.message}`);
  return data ?? null;
}

/**
 * 共通ラッパに渡す、オリジナル展示のスロットのハンドラー。
 * ctx.politeFetch（タイムアウト・429/503のバックオフ・ブレーカー込み。別ホストのブレーカー）で取得し、
 * リクエストは pacer で2.2秒以上空ける。
 */
export function createOritenSlotHandler({
  process = processOritenRace,
  load = loadRace,
  pacer = sharedPacer,
  canary = checkCanary,
  venueNoData = evaluateVenueNoData,
} = {}) {
  return async function handleSlot(slot, ctx) {
    const tick = tickOf(ctx.worker, ctx.now().getTime());
    const deps = { fetchImpl: ctx.politeFetch, pacer };

    // 各tickの先頭で、カナリアを1回だけ取る（同じ起動の他のスロットは、同じ結果を使う）。半開のブレーカーの試行も、
    // 最初のリクエストであるカナリア（必ず存在するファイル）になり、データの403で誤って閉じない
    tick.canaryPromise ??= canary(deps).then((result) => {
      tick.canary = { ...result, checkedAt: ctx.now().toISOString() };
      return result;
    });
    const canaryResult = await tick.canaryPromise;
    if (!canaryResult.ok) {
      return failure(`canary_failed: ${canaryResult.detail}`);
    }

    const race = await load(ctx.client, slot.race_id);
    const now = ctx.now();
    let minutesToStart;
    try {
      if (race?.race_date && race?.start_time) {
        minutesToStart =
          (raceStartInstant(race.race_date, race.start_time).getTime() -
            now.getTime()) /
          60000;
      }
    } catch {
      // 発走時刻を解釈できない（races の不備）。minutesToStart が不明のため、403は打ち切りになる。取得は続ける
    }
    const { retrySec, noData, warnings, anomalies, ...result } = await process({
      raceId: slot.race_id,
      race,
      mode: ctx.mode,
      client: ctx.client,
      fetchText: (url) => fetchBoatcast(url, deps),
      minutesToStart,
    });
    if (warnings?.length) tick.warnings.push(...warnings);
    if (anomalies?.length) tick.anomalies.push(...anomalies);
    if (typeof retrySec === "number") {
      // 起点は claim した時刻（共通ラッパの既定と同じ。computeRetryAt）
      result.retryAt = computeRetryAt({
        now,
        claimedAt: slot.last_attempt_at,
        retrySec,
      });
    }
    if (noData) {
      const alert = await venueNoData(ctx.client, slot.race_id);
      if (alert) tick.venueAlerts.push(alert);
    }
    return result;
  };
}

/**
 * 予定表のスロットを、対象会場（公開マップで public）のレースにだけ作るストア。ジョブの起動の終わり
 * （recordSuccess・recordFailure）に、通知の材料（tick）から last_report.alerts を更新する。
 *
 * 共通の ensure_scrape_slots（マイグレーション075）は、その日の全レースにスロットを作るが、江戸川（403）・
 * 未確認の会場のスロットは、取得しない・分母に入れないため作らない（観測ではなく、事前に凍結したマップで決める）。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 */
export function createOritenStore(
  client,
  {
    base = createSupabaseStore(client),
    registry = SCRAPE_JOBS,
    map = ORITEN_PUBLIC_MAP,
    // last_report だけを書き込む（全て失敗した起動では、共通ラッパが report を渡さないため、ここで直接書く）。テストで差し替える
    saveReport = async (job, report) => {
      const { error } = await client
        .from("scrape_job_state")
        .update({ last_report: report })
        .eq("job", job);
      if (error) {
        console.warn(`⚠️ ${job}: 通知の記録に失敗: ${error.message}`);
      }
    },
  } = {},
) {
  let myWorker = null;

  /** 起動の通知の材料から、last_report の新しい内容を作る。変化が無ければ undefined */
  async function buildReport(job, now, tickInfo) {
    const state = await base.readState(job);
    return mergeReport(state.row?.last_report ?? null, tickInfo, now);
  }

  return {
    ...base,

    async ensureSlots({ date, now }) {
      const def = registry[ORITEN_JOB];
      const nowMs = (now ?? new Date()).getTime();
      const { data, error } = await client
        .from("races")
        .select("race_id, race_date, start_time")
        .eq("race_date", date)
        .not("start_time", "is", null);
      if (error) {
        throw new Error(
          `予定表の対象レースの取得に失敗しました: ${error.message}`,
        );
      }
      const rows = (data ?? [])
        .filter(
          (r) => venueEntry(venueOfRaceId(r.race_id), map)?.status === "public",
        )
        .flatMap((r) =>
          def.offsets
            .filter(
              (offset) =>
                slotWindowEnd(
                  slotDeadline(r.race_date, r.start_time, offset),
                  def.graceMin,
                ).getTime() >= nowMs,
            )
            .map((offset) => ({
              job: ORITEN_JOB,
              race_id: r.race_id,
              offset_min: offset,
              race_date: r.race_date,
            })),
        );
      if (rows.length === 0) return 0;
      const { data: inserted, error: insertError } = await client
        .from("scrape_slots")
        .upsert(rows, {
          onConflict: "job,race_id,offset_min",
          ignoreDuplicates: true,
        })
        .select("race_id");
      if (insertError) {
        throw new Error(`予定表の生成に失敗しました: ${insertError.message}`);
      }
      return inserted?.length ?? 0;
    },

    async claimSlots(args) {
      myWorker = args.worker;
      return base.claimSlots(args);
    },

    async recordSuccess(job, args) {
      const tick = myWorker ? takeTick(myWorker) : null;
      const report = tick ? await buildReport(job, args.now, tick) : undefined;
      return base.recordSuccess(job, { ...args, report });
    },

    async recordFailure(job, args) {
      const tick = myWorker ? takeTick(myWorker) : null;
      await base.recordFailure(job, args);
      if (!tick) return;
      const report = await buildReport(job, args.now, tick);
      if (report !== undefined) await saveReport(job, report);
    },
  };
}
