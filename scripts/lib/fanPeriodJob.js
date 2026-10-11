/**
 * 期別成績（fan、racer_period_stats）の定期取り込み。共通ラッパ向けハンドラー（api/cron/fan-period.js）。
 *
 * 公式の fan ファイルは、期の終わり（4/30・10/31）から15〜60日遅れて公開される（plan.md §8.2 の実測:
 * fan2510 +15日、fan2404 +29日、fan2604 +60日）。以前は手動CLI（scripts/maintenance/fan-backfill.js）を
 * 年2回実行していたため、取り込みまで人が気づくのを待っていた（2026-10-03 ユーザー承認で自動化）。
 *
 * 毎日1回（JST 06:00、06:30 は 06:00 が完了しなかった日だけの補足）:
 *   1. 対象日より前に終わった期の fan を決める（11〜4月は fanYY10、5〜10月は fanYY04）
 *   2. racer_period_stats にその期の行があれば、何もしない（リクエスト0）
 *   3. 期の終わりから FAN_PUBLISH_DEADLINE_DAYS 日を過ぎても未取り込みなら、取得せずに通知する（last_report.alerts。監視が Slack へ送る）
 *   4. 無ければ1回取得する。404 は「未公開を確認した」として、その日は終える（補足の起動は叩かない）
 *   5. 展開・解析・検査（レコード数・異常0件・ファイル名と期の一致）。満たさなければ書かない（error）
 *   6. 生ファイルを Storage（raw-pages）に保管し、台帳 raw_snapshots に記録する（失敗しても取り込みは失敗にしない）
 *   7. racer_period_stats に、変更のある行だけ upsert する
 *
 * 取得の負荷: 公開を待つあいだは1日1リクエスト。期ごとの上限は FAN_PUBLISH_DEADLINE_DAYS 回。取り込み済みなら0。
 *
 * mode: shadow は取得・解析・既存行との差分の集計のみ（書き込み・保管なし）。off は何もしない（共通ラッパ）。
 * 動作確認: ?fanId=fan2604 を付けた手動リクエストは、取り込み済みでもその fan を取り直し、既存行との差分を返す
 * （shadow では書かない。対象日は処理済みにしない）。
 */
import { createHash } from "node:crypto";
import { decodeLzhBytes } from "./kbFileParser.js";
import {
  buildFanUrl,
  fanIdOf,
  parseFanFile,
  parseFanId,
  summarizeFan,
} from "./fanPeriodParser.js";
import { buildStatsRows, FAN_TABLES, NUMERIC_SCALES } from "./fanPeriodRows.js";
import { diffRows } from "./unchangedRows.js";
import { RAW_HTML_BUCKET } from "./rawHtmlArchive.js";

/** 期の終わりから、未公開を待つ日数の上限。これを過ぎたら取得せずに通知する（plan.md §8.2） */
export const FAN_PUBLISH_DEADLINE_DAYS = 105;
/** 1ファイルのレコード数の下限（実測: 1期 1,598〜1,643人）。下回れば構造の変更・途中切れとみなす */
export const FAN_MIN_RECORDS = 1500;
const BATCH_SIZE = 200;
const FAN_ID_RE = /^fan\d{4}$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 対象日（JST の YYYY-MM-DD）より前に終わった期の fan ファイル名（純関数）。
 *   5〜10月 → その年の4月分（算出 前年11/1〜4/30）
 *   11〜12月 → その年の10月分（算出 5/1〜10/31）
 *   1〜4月 → 前年の10月分
 */
export function fanIdEndedBefore(date) {
  const [y, m] = String(date ?? "")
    .split("-")
    .map(Number);
  if (!y || !m) throw new Error(`対象日の形式が不正です: ${String(date)}`);
  if (m >= 5 && m <= 10) return fanIdOf(y, 4);
  if (m >= 11) return fanIdOf(y, 10);
  return fanIdOf(y - 1, 10);
}

/** fan ファイル名 → racer_period_stats の期と、期の終わりの日（純関数） */
export function periodOfFanId(id) {
  const { year, month } = parseFanId(id);
  return month === 4
    ? { periodYear: year, periodNo: 2, endDate: `${year}-04-30` }
    : { periodYear: year + 1, periodNo: 1, endDate: `${year}-10-31` };
}

/** 期の終わりの翌日から対象日までの日数（純関数）。終わった当日の翌日が1 */
export function daysSincePeriodEnd(id, date) {
  const { endDate } = periodOfFanId(id);
  return Math.round(
    (Date.parse(`${date}T00:00:00Z`) - Date.parse(`${endDate}T00:00:00Z`)) /
      DAY_MS,
  );
}

/** 生ファイルの Storage 上のパス（純関数）。内容ハッシュをファイル名にし、同じ内容を二重に置かない */
export function fanRawPath(id, sha256) {
  return `raw/fan/${id}/${sha256.slice(0, 16)}.lzh`;
}

async function readExistingRows(client, period, columns) {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await client
      .from(FAN_TABLES.stats.table)
      .select(columns.join(","))
      .eq("period_year", period.year)
      .eq("period_no", period.no)
      .order("racer_id", { ascending: true })
      .range(from, from + 999);
    if (error)
      throw new Error(
        `${FAN_TABLES.stats.table} の取得に失敗: ${error.message}`,
      );
    rows.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/**
 * 生ファイルを保管し、台帳に記録する。失敗しても例外にせず、警告を返す（取り込みは続ける）
 * @returns {Promise<{path: string|null, warning: string|null}>}
 */
async function archiveFanRaw(client, { id, raw, sha256, run }) {
  const path = fanRawPath(id, sha256);
  try {
    const { error } = await client.storage
      .from(RAW_HTML_BUCKET)
      .upload(path, raw, {
        upsert: true,
        contentType: "application/octet-stream",
      });
    if (error) throw new Error(`Storage: ${error.message}`);
    const { error: ledgerError } = await client.from("raw_snapshots").upsert(
      [
        {
          page_type: "fan",
          key: id,
          storage_path: path,
          bytes: raw.length,
          sha256,
          parser_version: "fan-period/v1",
          run,
        },
      ],
      { onConflict: "page_type,key,sha256", ignoreDuplicates: true },
    );
    if (ledgerError) throw new Error(`raw_snapshots: ${ledgerError.message}`);
    return { path, warning: null };
  } catch (error) {
    return {
      path: null,
      warning: `生ファイルを保管できません: ${error.message}`,
    };
  }
}

/**
 * @param {Object} ctx 共通ラッパの文脈（targetDate・mode・politeFetch・client・query・worker）
 * @param {{sleepMs?: number, decode?: Function, minRecords?: number}} [options] テスト用の差し替え
 */
export async function runFanPeriodJob(
  ctx,
  { sleepMs = 200, decode = decodeLzhBytes, minRecords = FAN_MIN_RECORDS } = {},
) {
  const date = ctx.targetDate;
  if (!date)
    throw new Error("対象日を解決できません（ctx.targetDate がありません）");

  const probeId = ctx.query?.fanId;
  if (probeId !== undefined && !FAN_ID_RE.test(String(probeId)))
    throw new Error(`fanId の形式が不正です（fanYYMM）: ${String(probeId)}`);
  const probe = probeId !== undefined;
  const id = probe ? String(probeId) : fanIdEndedBefore(date);
  const { periodYear, periodNo } = periodOfFanId(id);
  const report = { date, mode: ctx.mode, fanId: id, probe };

  if (!probe) {
    const { data, error } = await ctx.client
      .from(FAN_TABLES.stats.table)
      .select("racer_id")
      .eq("period_year", periodYear)
      .eq("period_no", periodNo)
      .limit(1);
    if (error)
      throw new Error(
        `${FAN_TABLES.stats.table} の取得に失敗: ${error.message}`,
      );
    if ((data ?? []).length > 0)
      return {
        rowsWritten: 0,
        report: { ...report, status: "already_imported" },
        body: { fanId: id, status: "already_imported" },
      };
    const days = daysSincePeriodEnd(id, date);
    if (days > FAN_PUBLISH_DEADLINE_DAYS)
      return {
        rowsWritten: 0,
        report: {
          ...report,
          status: "overdue",
          daysSinceEnd: days,
          alerts: [
            {
              key: `fan_overdue:${id}`,
              text: `期別成績 ${id} が、期の終わりから${days}日たっても取り込めていません（${FAN_PUBLISH_DEADLINE_DAYS}日で取得を止めています）。公式の公開状況を確認し、公開済みなら ?fanId=${id} で取り込んでください`,
            },
          ],
        },
        body: { fanId: id, status: "overdue", daysSinceEnd: days },
      };
  }

  const res = await ctx.politeFetch(buildFanUrl(id));
  if (res.status === 404) {
    // 未公開を確認した。live ならその日は済み（補足の起動は叩かない）。probe は済みにしない
    return {
      rowsWritten: 0,
      ...(probe ? { incomplete: true } : {}),
      report: { ...report, status: "unpublished" },
      body: { fanId: id, status: "unpublished" },
    };
  }
  if (!res.ok)
    return {
      outcome: "error",
      error: `${id} を取得できません: HTTP ${res.status}`,
      rowsParsed: 0,
      report: { ...report, status: "http_error", httpStatus: res.status },
    };

  const raw = new Uint8Array(await res.arrayBuffer());
  const sha256 = createHash("sha256").update(raw).digest("hex");
  const fan = parseFanFile(await decode(raw), {
    id,
    source: { url: buildFanUrl(id), sha256, bytes: raw.length },
  });
  const summary = summarizeFan(fan);
  const problems = [];
  if (fan.record_count < minRecords)
    problems.push(
      `レコードが${fan.record_count}件（${minRecords}件以上のはず）`,
    );
  if (fan.anomalies.length > 0)
    problems.push(
      `異常${fan.anomalies.length}件: ${fan.anomalies
        .slice(0, 3)
        .map((a) => a.problem)
        .join(" / ")}`,
    );
  if (
    fan.period &&
    (fan.period.year !== periodYear || fan.period.no !== periodNo)
  )
    problems.push(
      `期が想定と違います（想定 ${periodYear}年${periodNo}期、実際 ${fan.period.year}年${fan.period.no}期）`,
    );
  if (problems.length > 0)
    return {
      outcome: "error",
      error: `${id} を取り込めません: ${problems.join(" / ")}`,
      rowsExpected: minRecords,
      rowsParsed: 0,
      report: { ...report, status: "invalid", summary },
    };

  const { rows, warnings } = buildStatsRows(fan);
  const existing = await readExistingRows(
    ctx.client,
    fan.period,
    Object.keys(rows[0]),
  );
  const { toWrite, stats } = diffRows(existing, rows, {
    keyColumns: FAN_TABLES.stats.keyColumns,
    scales: NUMERIC_SCALES[FAN_TABLES.stats.table],
  });
  const diff = {
    rows: rows.length,
    toWrite: toWrite.length,
    unchanged: stats.unchanged,
    existing: existing.length,
  };

  if (ctx.mode !== "live") {
    return {
      rowsWritten: 0,
      rowsParsed: rows.length,
      ...(probe ? { incomplete: true } : {}),
      report: { ...report, status: "parsed", summary, diff, warnings },
      body: { fanId: id, status: "parsed", diff },
    };
  }

  const archived = await archiveFanRaw(ctx.client, {
    id,
    raw,
    sha256,
    run: ctx.worker ?? null,
  });
  let written = 0;
  for (let i = 0; i < toWrite.length; i += BATCH_SIZE) {
    const part = toWrite.slice(i, i + BATCH_SIZE);
    const { error } = await ctx.client
      .from(FAN_TABLES.stats.table)
      .upsert(part, { onConflict: FAN_TABLES.stats.onConflict });
    if (error)
      return {
        outcome: "error",
        error: `${FAN_TABLES.stats.table} への書き込みに失敗（${written}/${toWrite.length}行で停止）: ${error.message}`,
        rowsWritten: written,
        rowsParsed: rows.length,
        report: { ...report, status: "write_failed", diff },
      };
    written += part.length;
    if (sleepMs > 0) await new Promise((r) => setTimeout(r, sleepMs));
  }
  const fullReport = {
    ...report,
    status: "imported",
    summary,
    diff: { ...diff, written },
    rawPath: archived.path,
    warnings: [...warnings, ...(archived.warning ? [archived.warning] : [])],
  };
  return {
    rowsWritten: written,
    rowsParsed: rows.length,
    ...(probe ? { incomplete: true } : {}),
    report: fullReport,
    body: {
      fanId: id,
      status: "imported",
      written,
      unchanged: stats.unchanged,
      rawPath: archived.path,
    },
  };
}
