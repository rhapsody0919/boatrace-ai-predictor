/**
 * ピットレポートの解析結果（pitReportParser.js）から、DBへ書く行・スロットの結果（outcome）・
 * 取得対象のレースを決める純関数（DB・取得先に接続しない）。
 *
 * 対象レースの規則は、2026-09-21の実測（docs/design/pit-comments/spec.md）:
 *   SG          全レース（1R〜12R）
 *   G1・G2      多くの日は7R〜12R、最終日は12Rのみ（ページが「12Rが表示対象レースになります」と表示する）
 *   G3・一般戦  対象外（ページが「表示対象レースではありません」と表示する）
 * この規則は「取得する候補」を絞るためだけに使い（isPitReportCandidate）、最終的な判定は、ページ自身の
 * メッセージ（解析結果の status）を正とする。
 */
import { createHash } from "node:crypto";
import { PIT_REPORT_STATUSES } from "./pitReportParser.js";

/** 取得の候補にするグレード（races.race_grade の値） */
export const PIT_REPORT_GRADES = Object.freeze(["SG", "G1", "G2"]);

/** G1・G2で、対象になりうる最初のレース番号（多くの日の「7Rから12Rまで」。最終日は12Rのみだが、ページの表示で判定する） */
export const PIT_REPORT_MIN_RACE_NUMBER_NON_SG = 7;

/**
 * 取得する候補のレースか（races の行から）。SGは全レース、G1・G2は7R以降。
 * 未知のグレード・NULLは、取得しない（過去分でグレードが空の日は、バックフィルの別の経路で扱う）。
 */
export function isPitReportCandidate({ raceGrade, raceNumber }) {
  if (!PIT_REPORT_GRADES.includes(raceGrade)) return false;
  if (!Number.isInteger(raceNumber) || raceNumber < 1 || raceNumber > 12)
    return false;
  if (raceGrade === "SG") return true;
  return raceNumber >= PIT_REPORT_MIN_RACE_NUMBER_NON_SG;
}

/**
 * 未公開（no_values）のときの、次の取得までの秒数。公開が見込めない時間帯の無駄なアクセスを減らす。
 * 値は暫定（公開時刻の実測後に確定する。docs/design/pit-comments/plan.md §4.2）:
 *   発走の30分より前      10分（farSec）
 *   発走の30分前〜発走後10分  5分（nearSec。公開の検知の遅れを最大5分に）
 *   それ以降              20分（lateSec。発走後に公開される場合の拾い漏れを防ぐ）
 */
export const PIT_REPORT_RETRY = Object.freeze({
  farSec: 600,
  nearSec: 300,
  lateSec: 1200,
  nearFromMin: 30,
  lateAfterMin: 10,
});

/** @param {number} minutesToStart 発走までの分（発走後は負） */
export function pendingRetrySec(minutesToStart, config = PIT_REPORT_RETRY) {
  if (!Number.isFinite(minutesToStart)) return config.nearSec;
  if (minutesToStart > config.nearFromMin) return config.farSec;
  if (minutesToStart >= -config.lateAfterMin) return config.nearSec;
  return config.lateSec;
}

/** スロットの outcome（scrape_slots.outcome）。共通ラッパの語彙（outcomes.js）に、`skipped_not_target` を足したもの */
export const PIT_REPORT_OUTCOMES = Object.freeze({
  ok: "ok",
  notTarget: "skipped_not_target",
  pending: "no_values",
  error: "error",
});

/**
 * 解析結果の status を、スロットの outcome にする。
 *   comments         ok（書き込む）
 *   not_target(_race) skipped_not_target（終端。取得を続けても公開されない）
 *   target_pending   no_values（未公開。再試行）
 *   no_data          no_values（ページ側にレースが無い。中止・順延のレースの可能性。再試行し、許容幅を超えたら expired）
 *   unrecognized     error（構造の変化。anomalies を理由に出す）
 */
export function outcomeForStatus(status) {
  switch (status) {
    case PIT_REPORT_STATUSES.comments:
      return PIT_REPORT_OUTCOMES.ok;
    case PIT_REPORT_STATUSES.notTarget:
    case PIT_REPORT_STATUSES.notTargetRace:
      return PIT_REPORT_OUTCOMES.notTarget;
    case PIT_REPORT_STATUSES.targetPending:
    case PIT_REPORT_STATUSES.noData:
      return PIT_REPORT_OUTCOMES.pending;
    default:
      return PIT_REPORT_OUTCOMES.error;
  }
}

/**
 * 内容のハッシュ（race_pit_reports.content_hash、scrape_slots.result_digest）。状態・レポーター・艇ごとの
 * 本文・自信度・前走・登録番号を、キー順に依存しない形にして sha256。取得時刻・HTMLの体裁（広告・アクセス解析の
 * スクリプト等、毎回変わるもの）は含めない。
 */
export function computeContentHash(parsed) {
  const canonical = {
    status: parsed.status,
    targetRange: parsed.targetRange ?? null,
    reporter: parsed.reporterName ?? null,
    boats: [...(parsed.boats ?? [])]
      .sort((a, b) => a.boatNumber - b.boatNumber)
      .map((b) => [
        b.boatNumber,
        b.racerNumber,
        b.commentText,
        b.confidenceStars,
        b.previousRaceNumber,
      ]),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/**
 * 解析結果からDBへ書く行を作る。書くのは、コメントあり（published）と対象外（not_target）だけ。
 * 未公開（target_pending）・データなし・想定外は、行を作らない（null）。
 *
 * @returns {{report: Object, comments: Object[]}|null}
 */
export function buildPitReportRows(
  parsed,
  { raceId, rawStoragePath = null } = {},
) {
  if (!raceId) throw new Error("raceId が必要です");
  const base = {
    race_id: raceId,
    reporter_name: parsed.reporterName ?? null,
    content_hash: computeContentHash(parsed),
    parser_version: parsed.parserVersion,
    raw_storage_path: rawStoragePath,
  };
  if (parsed.status === PIT_REPORT_STATUSES.comments) {
    const withText = parsed.boats.filter((b) => b.commentText !== null);
    return {
      report: {
        ...base,
        status: "published",
        target_from: null,
        target_to: null,
        comment_count: withText.length,
      },
      comments: withText.map((b) => ({
        race_id: raceId,
        boat_number: b.boatNumber,
        racer_id: b.racerNumber,
        comment_text: b.commentText,
        confidence_stars: b.confidenceStars,
        previous_race_number: b.previousRaceNumber,
      })),
    };
  }
  if (
    parsed.status === PIT_REPORT_STATUSES.notTarget ||
    parsed.status === PIT_REPORT_STATUSES.notTargetRace
  ) {
    return {
      report: {
        ...base,
        status: "not_target",
        target_from: parsed.targetRange?.from ?? null,
        target_to: parsed.targetRange?.to ?? null,
        comment_count: 0,
      },
      comments: [],
    };
  }
  return null;
}

/**
 * 「解析した登録番号」と「出走表（race_entries）の登録番号」の突合。別のレースのページを取ってしまった・
 * 艇番がずれている場合に、コメントを別の選手に付けて書かない。出走表が無い（取得前）艇は、突合しない。
 *
 * @param {Array<{boatNumber: number, racerNumber: number|null}>} boats 解析結果の艇
 * @param {Array<{boat_number: number, racer_id: number|null}>} entries race_entries の行
 * @returns {string[]} 不一致の説明（空なら一致）
 */
export function findRacerMismatches(boats, entries) {
  const byBoat = new Map(entries.map((e) => [e.boat_number, e.racer_id]));
  const problems = [];
  for (const b of boats) {
    const expected = byBoat.get(b.boatNumber);
    if (expected === undefined || expected === null) continue;
    if (b.racerNumber !== null && b.racerNumber !== expected) {
      problems.push(
        `${b.boatNumber}号艇の登録番号が出走表と一致しません（ページ ${b.racerNumber} / 出走表 ${expected}）`,
      );
    }
  }
  return problems;
}
