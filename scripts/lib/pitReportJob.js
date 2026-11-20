/**
 * ピットレポート（選手コメント）の取得ジョブ（BOA-379、docs/design/pit-comments/plan.md）。
 * api/cron/pit-reports.js が、共通ラッパ（scripts/lib/scrapeJobs/cronWrapper.js）経由で使う。
 *
 * 窓型ジョブ（レジストリ pit_reports）。1スロット＝1レース×1窓。対象は、SG（全レース）・G1・G2（7R以降）のレースだけ
 * （createPitReportStore が、予定表のスロットを対象レースにだけ作る。G3・一般戦にスロットは作らない）。
 * 取得・解析・書き込みの本体 processPitReportRace は、定期取得・過去分の一括取得（バックフィルCLI）が共有する。
 *
 * モード（scrape_job_state.mode。DBの更新のみで切り替える）:
 *   off（または行なし）  共通ラッパが何もしない（この関数は呼ばれない）
 *   shadow              取得・解析のみ。DBにもStorageにも書かない。予定表に result_digest（解析内容のハッシュ）を記録する
 *   live                race_pit_comments・race_pit_reports へ書く（変更のあるときだけ）。内容が変わったときだけ、生HTMLをStorageへ保管
 *
 * 書き込みの順序: 艇ごとのコメント → レース単位の行（race_pit_reports。content_hash は「書き込み完了」の目印）。
 * 途中で失敗しても、次の取得が同じ内容を書き直す。マイグレーション085が未適用のDBでは、書かずに error を返す
 * （成功にしない。off のまま085を適用してから shadow → live にする運用）。
 */
import { PIT_REPORT_STATUSES, parsePitReportHtml } from "./pitReportParser.js";
import {
  PIT_REPORT_OUTCOMES,
  computeContentHash,
  isPitReportCandidate,
  outcomeForStatus,
  pendingRetrySec,
} from "./pitReportRows.js";
import {
  failure,
  readParsedPitReport,
  writePitReportLive,
} from "./pitReportWrite.js";
import { archiveRawHtml } from "./rawHtmlArchive.js";
import { createSupabaseStore } from "./scrapeJobs/store.js";
import { SCRAPE_JOBS } from "./scrapeJobs/registry.js";
import { computeRetryAt } from "./scrapeJobs/outcomes.js";
import {
  raceStartInstant,
  slotDeadline,
  slotWindowEnd,
} from "./scrapeJobs/time.js";

export const PIT_REPORT_JOB = "pit_reports";
export const PIT_REPORT_PAGE_TYPE = "pitreport";

const RACE_ID_RE = /^(\d{4})-(\d{2})-(\d{2})-(\d{2})-(\d{2})$/;

/** race_id（YYYY-MM-DD-VV-RR）から、公式のピットレポートのURLを作る。形式が不正なら例外 */
export function buildPitReportUrl(raceId) {
  const m = RACE_ID_RE.exec(String(raceId));
  if (!m) throw new Error(`race_id の形式が不正です: ${String(raceId)}`);
  const [, y, mo, d, venue, race] = m;
  return `https://www.boatrace.jp/owpc/pc/race/pitreport?rno=${Number(race)}&jcd=${venue}&hd=${y}${mo}${d}`;
}

export class PitReportHttpError extends Error {
  constructor(url, status) {
    super(`ピットレポートの取得が HTTP ${status} でした: ${url}`);
    this.name = "PitReportHttpError";
    this.url = url;
    this.status = status;
  }
}

const FETCH_HEADERS = Object.freeze({
  "Accept-Language": "ja,en;q=0.8",
});

/** politeFetch（または fetch）でHTMLを取る。200以外は例外 */
export async function fetchPitReportHtml(url, fetchImpl = fetch) {
  const response = await fetchImpl(url, { headers: FETCH_HEADERS });
  if (!response.ok) throw new PitReportHttpError(url, response.status);
  return response.text();
}

/**
 * 1レースのピットレポートを、取得・解析し、live なら書き込む。
 *
 * @param {Object} params
 * @param {string} params.raceId
 * @param {{race_grade?: string|null, race_number?: number|null}|null} params.race races の行（グレード・レース番号）
 * @param {"shadow"|"live"} params.mode
 * @param {(url: string) => Promise<string>} params.fetchHtml
 * @param {import("@supabase/supabase-js").SupabaseClient} params.client
 * @param {typeof archiveRawHtml} [params.archive]
 * @param {number} [params.minutesToStart] 発走までの分（未公開のときの再試行の間隔 retrySec の計算に使う）
 * @param {boolean} [params.skipCandidateCheck] true なら、グレード・レース番号の規則で取得を省かない
 *   （過去分でグレードが空の日を、ページのメッセージで判定するバックフィル用）
 * @returns {Promise<{outcome: string, rowsWritten?: number, rowsParsed?: number, rowsExpected?: number, resultDigest?: string, error?: string, status?: string, parsed?: Object}>}
 */
export async function processPitReportRace({
  raceId,
  race,
  mode,
  fetchHtml,
  client,
  archive = archiveRawHtml,
  skipCandidateCheck = false,
  minutesToStart,
}) {
  if (!race) return failure(`races に ${raceId} の行がありません`);
  if (
    !skipCandidateCheck &&
    !isPitReportCandidate({
      raceGrade: race.race_grade,
      raceNumber: race.race_number,
    })
  ) {
    // 対象グレード・レース番号の規則の外。取得しない（規則はスロットの生成と同じ。ページ側の判定は取得したときのみ）
    return { outcome: PIT_REPORT_OUTCOMES.notTarget, rowsWritten: 0 };
  }

  const url = buildPitReportUrl(raceId);
  const html = await fetchHtml(url);
  const parsed = parsePitReportHtml(html);
  const outcome = outcomeForStatus(parsed.status);
  const digest = computeContentHash(parsed);
  const read = readParsedPitReport(parsed, {
    status: parsed.status,
    resultDigest: digest,
    parsed,
  });
  if (read.fail) return read.fail;
  const { base, commentCount } = read;
  // 書き込まない結果（未公開・データなし）、shadow は、ここまで
  if (
    mode !== "live" ||
    (outcome !== PIT_REPORT_OUTCOMES.ok &&
      outcome !== PIT_REPORT_OUTCOMES.notTarget)
  ) {
    return {
      ...base,
      outcome,
      rowsWritten: 0,
      // 未公開は、発走までの時間に応じた間隔で再試行する（共通ラッパの retrySec を上書きする）
      ...(outcome === PIT_REPORT_OUTCOMES.pending
        ? { retrySec: pendingRetrySec(minutesToStart) }
        : {}),
    };
  }
  return writePitReportLive({
    client,
    raceId,
    parsed,
    html,
    digest,
    base,
    outcome,
    archive,
    pageType: PIT_REPORT_PAGE_TYPE,
    minutesToStart,
    commentCount,
  });
}

/** races の1行を読む（グレード・レース番号）。無ければ null。DBエラーは例外 */
async function loadRace(client, raceId) {
  const { data, error } = await client
    .from("races")
    .select("race_id, race_date, start_time, race_grade, race_number")
    .eq("race_id", raceId)
    .maybeSingle();
  if (error)
    throw new Error(`races の読み取りに失敗しました: ${error.message}`);
  return data ?? null;
}

/**
 * 共通ラッパに渡す、ピットレポートのスロットのハンドラー。
 * ctx.politeFetch（タイムアウト・429/503のバックオフ・ブレーカー込み）で取得する。
 */
export function createPitReportSlotHandler({
  process = processPitReportRace,
  load = loadRace,
} = {}) {
  return async function handleSlot(slot, ctx) {
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
      // 発走時刻を解釈できない（races の不備）。再試行の間隔は既定（近い側）になる。取得は続ける
    }
    const {
      parsed: _parsed,
      status: _status,
      retrySec,
      ...result
    } = await process({
      raceId: slot.race_id,
      race,
      mode: ctx.mode,
      client: ctx.client,
      fetchHtml: (url) => fetchPitReportHtml(url, ctx.politeFetch),
      minutesToStart,
    });
    if (typeof retrySec === "number") {
      // 起点は claim した時刻（共通ラッパの既定と同じ。computeRetryAt）
      result.retryAt = computeRetryAt({
        now,
        claimedAt: slot.last_attempt_at,
        retrySec,
      });
    }
    return result;
  };
}

/**
 * 予定表のスロットを、対象レース（isPitReportCandidate）にだけ作るストア。
 * 共通の ensure_scrape_slots（マイグレーション075）は、その日の全レースにスロットを作るが、ピットレポートの
 * 対象はSG・G1・G2の一部で、全レースに作ると、対象外のスロットが claim の枠を占める（G3・一般戦の約9割）。
 * 対象レースだけを scrape_slots へ直接 upsert する（ON CONFLICT DO NOTHING。期限＋許容幅を過ぎたものは作らない。
 * 共通の ensure_scrape_slots と同じ意味論）。claim・完了・再試行は、共通のストアと同じ。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 */
export function createPitReportStore(
  client,
  { base = createSupabaseStore(client), registry = SCRAPE_JOBS } = {},
) {
  return {
    ...base,
    async ensureSlots({ date, now }) {
      const def = registry[PIT_REPORT_JOB];
      const nowMs = (now ?? new Date()).getTime();
      const { data, error } = await client
        .from("races")
        .select("race_id, race_date, race_number, race_grade, start_time")
        .eq("race_date", date)
        .not("start_time", "is", null)
        .in("race_grade", ["SG", "G1", "G2"]);
      if (error) {
        throw new Error(
          `予定表の対象レースの取得に失敗しました: ${error.message}`,
        );
      }
      const rows = (data ?? [])
        .filter((r) =>
          isPitReportCandidate({
            raceGrade: r.race_grade,
            raceNumber: r.race_number,
          }),
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
              job: PIT_REPORT_JOB,
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
  };
}
