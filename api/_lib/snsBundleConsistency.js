// 素材バンドルの追加照合（snsBundleValidation.js の bundleConsistencyWarnings を、識別子・会場名・動画の照合に分けて移した）。
import { VENUE_NAMES } from "../../scripts/lib/venueNames.js";
import { matchRiskRules, bundleRiskFields } from "../../scripts/lib/riskRuleMatcher.js";
import { SHA, SOURCES, record } from "./snsBundleValidationParts.js";

const warning = (id, description, matchedPattern) => ({
  id, category: "bundle-consistency", description, matchedPattern,
});

/** value の keys のうち、あって mismatch の物を警告にする */
const mismatches = (value, keys, mismatch, id, description, location) =>
  keys
    .filter((key) => value[key] !== undefined && mismatch(value[key]))
    .map((key) => warning(id, description, `${location}.${key}`));

/** レース識別子・会場コード・レース番号・会場表示名の照合（value が object でなければ無し） */
function identityWarnings(value, location, bundle, venue, raceNumber) {
  if (!record(value)) return [];
  return [
    ...mismatches(value, ["race_id", "raceId", "race_code", "raceCode"],
      (v) => v !== bundle.race_id, "bundle-race-mismatch", "レース識別子が一致しません（QA保留）", location),
    ...mismatches(value, ["venue_code", "venueCode"],
      (v) => Number(v) !== venue, "bundle-venue-mismatch", "会場コードが一致しません（QA保留）", location),
    ...mismatches(value, ["race_number", "raceNumber"],
      (v) => Number(v) !== raceNumber, "bundle-race-mismatch", "レース番号が一致しません（QA保留）", location),
    ...mismatches(value, ["venue_name", "venueName"],
      (v) => v !== VENUE_NAMES[venue], "bundle-venue-mismatch", "会場表示名が正準表と一致しません（QA保留）", location),
  ];
}

/** 出典範囲（source_data.scope_key）の会場コードの照合 */
function scopeWarnings(bundle, venue) {
  const scope = bundle.source_data.scope_key;
  if (typeof scope === "string" && /^(VC|VA):/.test(scope) && Number(scope.split(":")[1]) !== venue)
    return [warning("bundle-venue-mismatch", "出典範囲の会場コードが一致しません（QA保留）", "source_data.scope_key")];
  return [];
}

/** 原文（facts・similar・scenario・layer）の識別子の照合 */
function sourceWarnings(parsed, bundle, venue, raceNumber) {
  const warnings = [];
  for (const source of SOURCES) {
    const raw = parsed.get(`${source}.json`);
    warnings.push(...identityWarnings(raw, source, bundle, venue, raceNumber));
    for (const key of ["today", "target", "race"])
      warnings.push(...identityWarnings(raw?.[key], `${source}.${key}`, bundle, venue, raceNumber));
  }
  return warnings;
}

/** 共通matcherの正規化と欄分離を使う。比較・引用も警告とし、人が判断する。 */
function bodyVenueWarnings(bundle, venue) {
  const venueRules = Object.entries(VENUE_NAMES).filter(([code]) => Number(code) !== venue)
    .map(([code, name]) => ({ id: `bundle-body-venue-${code}`, category: "bundle-consistency",
      description: "本文に対象外の会場名があります（比較・引用を含めQA確認）",
      platforms: "all", patterns: [name] }));
  const fields = [...bundleRiskFields(bundle, "x"), ...bundleRiskFields(bundle, "youtube")]
    .filter(field => field.field !== "hashtags")
    .map(field => ({...field, text: VENUE_NAMES[venue].length > 1
      ? (field.text || "").replace(/[ \u3000]/gu, "").replaceAll(VENUE_NAMES[venue], "") : field.text}));
  return matchRiskRules(fields, undefined, venueRules);
}

const validVideo = value => record(value) &&
  ["width", "height"].every(key => Number.isInteger(value[key]) && value[key] > 0) &&
  ["duration_seconds", "fps"].every(key => Number.isFinite(value[key]) && value[key] > 0) &&
  typeof value.has_audio === "boolean";

/** 動画の宣言値と計測値の1項目が一致するか（尺・fps は許容差つき） */
function videoKeyMatches(key, measured, declared) {
  const tolerance = key === "duration_seconds" ? Math.max(0.05, 1 / measured.fps) : key === "fps" ? 0.01 : 0;
  return typeof measured[key] === "number"
    ? Math.abs(measured[key] - declared[key]) <= tolerance
    : measured[key] === declared[key];
}

/** 宣言値（video）と計測値（video_probe）の突き合わせ */
function declaredVideoWarnings(measured, declared) {
  if (!validVideo(declared))
    return [warning("bundle-video-declaration-missing", "動画の宣言値が不足または不正です（QA保留）", "video")];
  return ["width", "height", "duration_seconds", "fps", "has_audio"]
    .filter((key) => !videoKeyMatches(key, measured, declared))
    .map((key) => warning("bundle-video-mismatch", "動画の宣言値と計測値が一致しません（QA保留）", `video.${key}`));
}

/** 動画の計測値（ffprobe）・宣言値・場面の合計秒数・添付動画のハッシュの照合 */
function videoWarnings(bundle, files) {
  const measured = bundle.video_probe;
  if (!validVideo(measured) || !SHA.test(measured?.sha256) || measured?.tool !== "ffprobe")
    return [warning("bundle-video-probe-missing", "動画のffprobe計測値が不足または不正です（QA保留）", "video_probe")];
  const warnings = declaredVideoWarnings(measured, bundle.video);
  if (Math.abs(bundle.scenes.reduce((sum, scene) => sum + scene.seconds, 0) - measured.duration_seconds) > Math.max(0.05, 1 / measured.fps))
    warnings.push(warning("bundle-video-scenes-mismatch", "sceneの合計秒数と動画尺が一致しません（QA保留）", "scenes.seconds"));
  if (!files.has("draft.mp4") || files.get("draft.mp4").hash !== measured.sha256)
    warnings.push(warning("bundle-video-hash-mismatch", "計測対象と添付動画のハッシュが一致しません（QA保留）", "video_probe.sha256"));
  return warnings;
}

/** 追加照合は警告のみ。類似レース配列の別会場・別race_idは対象にしない。 */
export function bundleConsistencyWarnings(bundle, parsed, files) {
  const venue = Number(bundle.race_id.slice(11, 13));
  const raceNumber = Number(bundle.race_id.slice(14, 16));
  return [
    ...identityWarnings(bundle, "bundle", bundle, venue, raceNumber),
    ...identityWarnings(bundle.source_data, "source_data", bundle, venue, raceNumber),
    ...scopeWarnings(bundle, venue),
    ...sourceWarnings(parsed, bundle, venue, raceNumber),
    ...bodyVenueWarnings(bundle, venue),
    ...videoWarnings(bundle, files),
  ];
}
