/**
 * ピットレポート（pitReportJob.js の processPitReportRace）の、解析結果の読みと live の書き込み。
 * 解析結果の読み・partial の判定は純関数。書き込みは race_entries の突合 → 既存の行 → 生HTMLの保管 → 艇ごと → レース単位の順。
 */
import { PIT_REPORT_STATUSES } from "./pitReportParser.js";
import {
  PIT_REPORT_OUTCOMES,
  buildPitReportRows,
  findRacerMismatches,
  pendingRetrySec,
} from "./pitReportRows.js";
import { detectPitReportSchema } from "./pitReportSchema.js";
import { upsertChangedRows } from "./unchangedRows.js";

export const failure = (message, extra = {}) => ({
  outcome: PIT_REPORT_OUTCOMES.error,
  error: message,
  ...extra,
});

/**
 * 解析結果の想定外を失敗にし、コメントありならコメントの数を base に足す（純関数）。
 * @returns {{fail: Object}|{base: Object, commentCount: number}}
 */
export function readParsedPitReport(parsed, base) {
  if (parsed.status === PIT_REPORT_STATUSES.unrecognized) {
    return {
      fail: failure(
        `parse_anomaly: ${parsed.anomalies.join(" / ") || "想定外の構造"}`,
        base,
      ),
    };
  }
  if (parsed.status !== PIT_REPORT_STATUSES.comments)
    return { base, commentCount: 0 };
  if (parsed.anomalies.length > 0) {
    // 想定外の表記のまま書かない（構造の変化を、黙って書き込まない）
    return {
      fail: failure(`parse_anomaly: ${parsed.anomalies.join(" / ")}`, base),
    };
  }
  const count = parsed.boats.filter((b) => b.commentText !== null).length;
  return {
    base: { ...base, rowsParsed: count, rowsExpected: 1 },
    commentCount: count,
  };
}

/**
 * 公開済みでもコメントが出走艇の数に満たない間は、発走まで partial で再試行する（BOA-611、純関数）。
 * 公式はレポーターが艇ごとにコメントを順に足していく（2026-10-01 児島7R: 11:54 の検知は1艇、13:22 は6艇）。
 * 発走後・発走時刻が不明なときは、そのまま完了にする（再試行を続けて期限切れの監視を鳴らさない）。
 * 書き込みは content_hash で変わったときだけなので、取り直しても同じ内容なら書かない。
 */
export function settlePartial(
  result,
  { expectedBoats, commentCount, minutesToStart },
) {
  return result.outcome === PIT_REPORT_OUTCOMES.ok &&
    expectedBoats !== null &&
    commentCount < expectedBoats &&
    Number.isFinite(minutesToStart) &&
    minutesToStart > 0
    ? {
        ...result,
        outcome: PIT_REPORT_OUTCOMES.partial,
        retrySec: pendingRetrySec(minutesToStart),
      }
    : result;
}

/** 出走表の登録番号との突合（別のレース・ずれた艇番へ、コメントを付けて書かない） */
async function matchEntries(client, raceId, parsed, base) {
  const { data: entries, error: entriesError } = await client
    .from("race_entries")
    .select("boat_number, racer_id")
    .eq("race_id", raceId);
  if (entriesError) {
    return {
      fail: failure(
        `出走表の読み取りに失敗しました: ${entriesError.message}`,
        base,
      ),
    };
  }
  // 出走表が読めない（0件）ときは、全艇そろうまで待つ判定をしない（従来どおり完了にする）
  const expectedBoats = (entries ?? []).length > 0 ? entries.length : null;
  const mismatches = findRacerMismatches(parsed.boats, entries ?? []);
  if (mismatches.length > 0) {
    return { fail: failure(`parse_anomaly: ${mismatches.join(" / ")}`, base) };
  }
  return { expectedBoats };
}

/** 内容が変わった（または初めて）: 生HTMLの保管（コメントありのみ。失敗しても続ける）→ 艇ごと → レース単位の行 */
async function writePitReportRows(
  client,
  { raceId, parsed, html, digest, existing, archive, pageType, base },
) {
  const rawPath =
    parsed.status === PIT_REPORT_STATUSES.comments
      ? await archive(client, { pageType, raceId, contentHash: digest, html })
      : null;
  const rows = buildPitReportRows(parsed, { raceId, rawStoragePath: rawPath });

  let rowsWritten = 0;
  if (rows.comments.length > 0) {
    const commentResult = await upsertChangedRows(
      client,
      "race_pit_comments",
      rows.comments,
      {
        onConflict: "race_id,boat_number",
        keyColumns: ["race_id", "boat_number"],
        stampUpdatedAt: true,
        label: "race_pit_comments",
      },
    );
    if (commentResult.error)
      return { fail: failure(commentResult.error.message, base) };
    rowsWritten += commentResult.written;
  }
  if (existing) {
    // 更新で艇のコメントが減った場合（通常は起きない）、残らないようにする
    const keep = rows.comments.map((c) => c.boat_number);
    let del = client.from("race_pit_comments").delete().eq("race_id", raceId);
    if (keep.length > 0)
      del = del.not("boat_number", "in", `(${keep.join(",")})`);
    const { error: deleteError } = await del;
    if (deleteError) {
      return {
        fail: failure(
          `古いコメントの削除に失敗しました: ${deleteError.message}`,
          base,
        ),
      };
    }
  }
  const reportResult = await upsertChangedRows(
    client,
    "race_pit_reports",
    [rows.report],
    {
      onConflict: "race_id",
      keyColumns: ["race_id"],
      ignoreColumns: ["raw_storage_path"],
      stampUpdatedAt: true,
      label: "race_pit_reports",
    },
  );
  if (reportResult.error)
    return { fail: failure(reportResult.error.message, base) };
  return { rowsWritten: rowsWritten + reportResult.written };
}

/** live の書き込み。内容が既存と同じなら、何も書かない（変更の無い行は書かない） */
export async function writePitReportLive({
  client,
  raceId,
  parsed,
  html,
  digest,
  base,
  outcome,
  archive,
  pageType,
  minutesToStart,
  commentCount,
}) {
  if (!(await detectPitReportSchema(client))) {
    return failure(
      "マイグレーション085（race_pit_reports・race_pit_comments）が未適用のため、書き込みませんでした",
      base,
    );
  }
  let expectedBoats = null;
  if (parsed.status === PIT_REPORT_STATUSES.comments) {
    const matched = await matchEntries(client, raceId, parsed, base);
    if (matched.fail) return matched.fail;
    expectedBoats = matched.expectedBoats;
  }
  const settle = (result) =>
    settlePartial(result, { expectedBoats, commentCount, minutesToStart });

  const { data: existing, error: existingError } = await client
    .from("race_pit_reports")
    .select("content_hash, parser_version, raw_storage_path")
    .eq("race_id", raceId)
    .maybeSingle();
  if (existingError) {
    return failure(
      `race_pit_reports の読み取りに失敗しました: ${existingError.message}`,
      base,
    );
  }
  if (
    existing &&
    existing.content_hash === digest &&
    existing.parser_version === parsed.parserVersion
  ) {
    return settle({ ...base, outcome, rowsWritten: 0 });
  }
  const written = await writePitReportRows(client, {
    raceId,
    parsed,
    html,
    digest,
    existing,
    archive,
    pageType,
    base,
  });
  if (written.fail) return written.fail;
  return settle({ ...base, outcome, rowsWritten: written.rowsWritten });
}
