// push-research-image.js から移した、型（RESEARCH_TYPE・SETSU_TYPE）と bundle.json の検査 checkResearchBundle（検査の列ごとに関数へ割った）
import {
  DAILY_IMAGE_TYPES,
  researchTextReasons,
  setsuRacerReasons,
} from "../../api/_lib/snsResearchImage.js";
import { matchRiskRules, draftRiskFields } from "../lib/riskRuleMatcher.js";
import { PUSH_RULES } from "../lib/sns/researchPushRules.js";
import { AS_OF, isIso } from "../lib/sns/researchSchedule.js";

export const RESEARCH_TYPE = DAILY_IMAGE_TYPES.research_image;
export const SETSU_TYPE = DAILY_IMAGE_TYPES.setsu_kiryoku;

/** format・kind・date・slug の検査 */
function identityReasons(bundle, type) {
  const reasons = [];
  if (bundle?.format !== type.bundleFormat)
    reasons.push(`format が ${type.bundleFormat} でない`);
  if (bundle?.kind !== undefined && bundle.kind !== type.kind)
    reasons.push(`kind が ${type.kind} でない（${bundle.kind}）`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(bundle?.date ?? ""))
    reasons.push("date が YYYY-MM-DD でない");
  if (!type.slug.test(bundle?.slug ?? ""))
    reasons.push(
      `slug が ${type.slug.source} の形（英小文字・数字・ハイフンの40字まで）でない`,
    );
  return reasons;
}

/** send_time・images の検査 */
function sendAndImageReasons(bundle, rules) {
  const reasons = [];
  const sendTime = bundle?.send_time ?? "";
  if (
    !/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(sendTime) ||
    sendTime < rules.earliest ||
    sendTime > rules.latest
  )
    reasons.push(
      rules.earliest === rules.latest
        ? `send_time が ${rules.earliest} でない`
        : `send_time が ${rules.earliest}〜${rules.latest} の HH:MM でない`,
    );
  if (
    !Array.isArray(bundle?.images) ||
    bundle.images.length !== 1 ||
    bundle.images[0] !== `${bundle?.slug}.png`
  )
    reasons.push(`images が ["${bundle?.slug}.png"] の1枚でない`);
  return reasons;
}

/** source_observed_at（集計の時刻、型によっては as_of）の検査 */
function observedAtReasons(bundle, rules) {
  const reasons = [];
  const asOf = rules.allowAsOf
    ? AS_OF.exec(bundle?.source_observed_at ?? "")
    : null;
  if (asOf && asOf[1] !== bundle?.date)
    reasons.push(
      `source_observed_at（集計の as_of）の日 ${asOf[1]} が date ${bundle?.date} と違う`,
    );
  else if (!asOf && !isIso(bundle?.source_observed_at))
    reasons.push(
      rules.allowAsOf
        ? "source_observed_at が時差（Z か ±HH:MM）つきの ISO の時刻でも「YYYY-MM-DD NR まで」でもない"
        : "source_observed_at が時差（Z か ±HH:MM）つきの ISO の時刻でない",
    );
  return reasons;
}

/** 禁止表現（risk-rules）の検査 */
function riskReasons(bundle, riskRules) {
  const hits = matchRiskRules(
    draftRiskFields({
      platform: "x",
      caption_text: bundle?.x_text ?? "",
      hashtags: Array.isArray(bundle?.hashtags) ? bundle.hashtags : [],
    }),
    "x",
    riskRules,
  );
  return hits.length
    ? [`禁止表現（risk-rules）: ${hits.map((h) => h.id).join(",")}`]
    : [];
}

/** bundle.json の検査（純粋関数）。時刻の窓は checkTiming が見る。type は DAILY_IMAGE_TYPES の1つ（既定は数字で見たら） */
export function checkResearchBundle(
  bundle,
  riskRules = [],
  type = RESEARCH_TYPE,
) {
  const rules = PUSH_RULES[type.kind];
  const reasons = [
    ...identityReasons(bundle, type),
    ...sendAndImageReasons(bundle, rules),
    ...observedAtReasons(bundle, rules),
  ];
  if (
    (rules.requireReview || bundle?.review !== undefined) &&
    bundle?.review?.p0_count !== 0
  )
    reasons.push(`機械の検査の P0 が0件でない（${bundle?.review?.p0_count}）`);
  if (type.hasRacers) reasons.push(...setsuRacerReasons(bundle?.racers));
  const fields = { caption: bundle?.x_text, hashtags: bundle?.hashtags };
  reasons.push(...researchTextReasons(fields));
  reasons.push(...riskReasons(bundle, riskRules));
  return reasons;
}
