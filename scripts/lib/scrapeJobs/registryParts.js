/**
 * registry.js から移した、レジストリの定義を読む小さな純関数（registryValidate.js と registry.js が共有する。循環を避けるため分けた）。
 * 振る舞いは元のまま（稼働時間 activeMinutesOf・実行日 isScheduledDate も移した）。registry.js が同じ名前で再 export する。
 */

/** 関数の maxDuration からこの秒数を引いた時点で、新しいスロットに着手しない */
export const SOFT_DEADLINE_MARGIN_SEC = 30;

/** JST の HH:MM を、0時からの分にする */
export const hhmmToMinutes = (text) => {
  const [h, m] = String(text).split(":").map(Number);
  return h * 60 + m;
};

/**
 * 窓の外の補完のスロット（発走の後の、取得済みなら何もしない再取得。展示 BOA-382）の offset か。
 * ハンドラー（気象・再計算をしない）と監視（窓内取得率の分母に入れない、中止・順延の疑いの期限切れを通知しない）が使う。
 *
 * @param {{catchupOffsets?: number[]}|undefined} def
 * @param {number} offsetMin
 */
export function isCatchupOffset(def, offsetMin) {
  return Array.isArray(def?.catchupOffsets)
    ? def.catchupOffsets.includes(offsetMin)
    : false;
}

/**
 * 体重だけの窓（発走前の、当日体重・調整重量が取れたら完了とするスロット。展示 BOA-500）の offset か。
 * ハンドラー（完了の判定を変える・気象・再計算をしない）と監視（窓内取得率の分母に入れない、期限切れを通知しない）が使う。
 *
 * @param {{weightOnlyOffsets?: number[]}|undefined} def
 * @param {number} offsetMin
 */
export function isWeightOnlyOffset(def, offsetMin) {
  return Array.isArray(def?.weightOnlyOffsets)
    ? def.weightOnlyOffsets.includes(offsetMin)
    : false;
}

/**
 * 通常の窓（体重だけ・補完以外）の offsets。展示は [-33]
 *
 * @param {{offsets?: number[], catchupOffsets?: number[], weightOnlyOffsets?: number[]}|undefined} def
 */
export function mainWindowOffsetsOf(def) {
  return (def?.offsets ?? []).filter(
    (o) => !isCatchupOffset(def, o) && !isWeightOnlyOffset(def, o),
  );
}

/**
 * 窓（offset_min）ごとの許容幅（分）。graceMinByOffset に指定があればその値、なければジョブの graceMin
 * （odds の -60 だけ、未公開の間の延長で30分。ファイル内の odds の説明）
 *
 * @param {{graceMin: number, graceMinByOffset?: Record<number, number>}|undefined} def
 * @param {number} offsetMin
 */
export function graceMinFor(def, offsetMin) {
  const override = def?.graceMinByOffset?.[offsetMin];
  return Number.isInteger(override) ? override : def?.graceMin;
}

/**
 * ジョブの稼働時間（JST、分）。activeHoursJst の無いジョブは null（監視の運用窓に従う）。
 * @param {{activeHoursJst?: {start: string, end: string}}|undefined} def
 */
export function activeMinutesOf(def) {
  if (!def?.activeHoursJst) return null;
  return {
    start: hhmmToMinutes(def.activeHoursJst.start),
    end: hhmmToMinutes(def.activeHoursJst.end),
  };
}

/**
 * 日次ジョブが、その日（JST の YYYY-MM-DD）に起動する予定か。日付指定の無いジョブは毎日。
 * runDaysOfMonth: { default: [日...], [月]: [日...] }（月ごとの指定が default に優先する）。
 * 月次ジョブ（B6）の未処理を、起動しない日に誤報しないため。
 *
 * weeklyWithMonthBoundary: 月曜または月末3日・月初3日に起動する。
 * @param {{runDaysOfMonth?: Record<string, number[]>, weeklyWithMonthBoundary?: boolean}} def
 * @param {string} dateJst YYYY-MM-DD
 */
export function isScheduledDate(def, dateJst) {
  if (def.weeklyWithMonthBoundary) {
    const date = new Date(`${dateJst}T00:00:00Z`);
    const day = date.getUTCDate();
    const last = new Date(
      Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
    ).getUTCDate();
    return date.getUTCDay() === 1 || day <= 3 || day > last - 3;
  }
  const days = def.runDaysOfMonth;
  if (!days) return true;
  const month = Number(dateJst.slice(5, 7));
  const day = Number(dateJst.slice(8, 10));
  return (days[month] ?? days.default ?? []).includes(day);
}
