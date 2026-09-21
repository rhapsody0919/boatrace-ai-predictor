/**
 * オリジナル展示の解析結果（oritenParser.js）から、DBへ書く行・未公開（403）時の再試行の判断・
 * 公開マップとの照合を行う純関数（DB・取得先に接続しない）。
 */
import { createHash } from "node:crypto";
import { MEASURE_STATUS, ORITEN_STATUSES } from "./oritenParser.js";

/**
 * 内容のハッシュ（race_original_exhibition.content_hash、scrape_slots.result_digest）。計測状態・項目名・
 * 艇ごとの値を、選手名（保存しない・表記が揺れうる）を含めずに sha256 にする。
 */
export function computeOritenHash(parsed) {
  const canonical = {
    flag: parsed.measureFlag,
    labels: parsed.labels,
    rows: [...parsed.rows]
      .sort((a, b) => a.boatNumber - b.boatNumber)
      .map((r) => [r.boatNumber, r.values]),
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex");
}

/** HTTPの Last-Modified（RFC 7231の日付）を ISO 文字列にする。無い・不正なら null */
export function parseLastModified(value) {
  if (!value) return null;
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * 解析結果からDBへ書く行を作る。計測あり・計測不可のみ（想定外の構造は行を作らない）。
 *
 * race_original_exhibition        レース単位（計測状態・項目名・公開時刻（Last-Modified）・内容のハッシュ）
 * race_original_exhibition_values 艇×項目（縦持ち。value は秒。欠測 `--.--` は NULL）
 *
 * @param {ReturnType<import("./oritenParser.js").parseOritenText>} parsed
 * @param {{raceId: string, lastModified?: string|null}} options
 * @returns {{report: Object, values: Object[]}|null}
 */
export function buildOritenRows(parsed, { raceId, lastModified = null } = {}) {
  if (!raceId) throw new Error("raceId が必要です");
  if (
    parsed.status !== ORITEN_STATUSES.measured &&
    parsed.status !== ORITEN_STATUSES.unmeasurable
  ) {
    return null;
  }
  const report = {
    race_id: raceId,
    measure_status:
      parsed.status === ORITEN_STATUSES.measured
        ? MEASURE_STATUS.measured
        : MEASURE_STATUS.unmeasurable,
    item_count: parsed.labels.length,
    item_labels: parsed.labels.join("|"),
    content_hash: computeOritenHash(parsed),
    parser_version: parsed.parserVersion,
    source_last_modified: parseLastModified(lastModified),
  };
  const values = parsed.rows.flatMap((row) =>
    parsed.labels.map((label, i) => ({
      race_id: raceId,
      boat_number: row.boatNumber,
      kind: label,
      value: row.values[i],
    })),
  );
  return { report, values };
}

/**
 * 項目名の、公開マップとの照合。位置ではなくラベルの集合で比べる。
 * @param {string[]} labels ファイルの項目名（正規化済み）
 * @param {string[]} expected 公開マップの項目名
 * @returns {{unexpected: string[], missing: string[]}} マップに無い項目名 / マップにあるのにファイルに無い項目名
 */
export function compareLabelsToMap(labels, expected) {
  return {
    unexpected: labels.filter((l) => !expected.includes(l)),
    missing: expected.filter((l) => !labels.includes(l)),
  };
}

/** 403の再試行の判断の閾値（decideNotPublished）。秒・分 */
export const NOT_PUBLISHED_POLICY = Object.freeze({
  firstRetrySec: 300,
  secondRetrySec: 480,
  earlyBandAboveMin: 4,
  finalAtOrBelowMin: -4,
});

/**
 * 未公開（403で、カナリアは正常）のときの再試行の判断。発走までの分（minutesToStart。発走後は負）で、
 * 再試行の間隔を延ばし、最大3回で打ち切る（403は「存在しない」もありうる。取得先への負荷を抑える）。
 *
 * 実測（2026-09-21）: ファイルは発走の9.9〜29.0分前（n=21）に現れる。最初の取得は発走8分前。
 *   発走の4分より前  5分後に再試行（2回目は発走の約3分前）
 *   発走の4分前〜−4分  8分後に再試行（3回目は発走の約5分後）
 *   発走の−4分より後   打ち切り（データ無しとして完了。scrape_slots.outcome=skipped_not_target）
 * minutesToStart が不明・無限小（過去日のバックフィル）は、打ち切り。
 *
 * @param {number|undefined} minutesToStart
 * @returns {{final: boolean, retrySec?: number}}
 */
export function decideNotPublished(
  minutesToStart,
  policy = NOT_PUBLISHED_POLICY,
) {
  if (!Number.isFinite(minutesToStart)) return { final: true };
  if (minutesToStart <= policy.finalAtOrBelowMin) return { final: true };
  if (minutesToStart > policy.earlyBandAboveMin) {
    return { final: false, retrySec: policy.firstRetrySec };
  }
  return { final: false, retrySec: policy.secondRetrySec };
}
