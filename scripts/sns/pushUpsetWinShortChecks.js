/**
 * 人気薄の1着の Shorts の bundle・説明欄・DB の照合の検査（純粋関数）と、送る時刻・動画の名前の定数。push-upset-win-short.js から移した（字は同じ。
 * dryRunClock は節の機力の Shorts と同じ関数（lib/sns/shortSchedule.js）に、この口の既定の送る時刻を渡す）
 */
import twitterText from "twitter-text";
import { checkBundle } from "../../sns-video-studio/remotion/src/upsetWin/model.js";
import { matchRiskRules } from "../lib/riskRuleMatcher.js";
import { dryRunClock as clockOf, isHhmm } from "../lib/sns/shortSchedule.js";

export const VIDEO_NAME = "upset_win.mp4";
/** 送る時刻（JST）。仕様「毎朝 7:00〜7:59 に1本」。期限は送る時刻＋60分 */
export const SEND_TIME_EARLIEST = "07:00";
export const SEND_TIME_LATEST = "07:50";
export const DEFAULT_SEND_TIME = "07:15";
const SITE = "https://www.boat-ai.jp";
/** DB と照らす艇の欄（shapeRace の形） */
export const BOAT_FIELDS = [
  "boat",
  "racer",
  "class",
  "win_rate",
  "motor_2rate",
  "exhibition_time",
  "start_timing",
  "st_flag",
  "odds",
];

/** 説明欄のリンク（純粋関数）。ちょうど1つで、そのレースの龍神ソナーの頁。返り値 { url（表示の確認に使う。tab だけ残す）, reasons } */
export function descriptionLink(description, raceId) {
  const urls = twitterText.extractUrls(description ?? "");
  if (urls.length !== 1)
    return {
      url: null,
      reasons: [`説明欄のリンクがちょうど1つでない（${urls.length}）`],
    };
  let u;
  try {
    u = new URL(urls[0]);
  } catch {
    return { url: null, reasons: [`説明欄のリンクが URL でない: ${urls[0]}`] };
  }
  const extra = [...u.searchParams.keys()].filter(
    (k) => k !== "tab" && !k.startsWith("utm_"),
  );
  if (
    u.origin !== SITE ||
    u.username ||
    u.password ||
    u.hash ||
    u.pathname !== `/race/${raceId}` ||
    u.searchParams.get("tab") !== "sonar" ||
    extra.length
  )
    return {
      url: null,
      reasons: [
        `説明欄のリンクがこのレースの龍神ソナーの頁（${SITE}/race/${raceId}?tab=sonar、ほかのクエリは utm_* だけ）でない: ${urls[0]}`,
      ],
    };
  return { url: `${SITE}/race/${raceId}?tab=sonar`, reasons: [] };
}

/** bundle.json の検査（純粋関数）。型の検査とこの口の検査。時刻の窓は checkTiming、DB の照合は raceReasons が見る */
export function checkUpsetBundle(bundle, riskRules = []) {
  const reasons = checkBundle(bundle, { rules: riskRules, matchRiskRules });
  if (reasons.length || !bundle || typeof bundle !== "object") return reasons;
  const { title, description } = bundle.youtube;
  if ([...title].length > 100) reasons.push("youtube.title が100字を超える");
  if (/[\r\n<>]/.test(title))
    reasons.push("youtube.title に改行か < > がある（YouTube が受けない）");
  if (Buffer.byteLength(description, "utf8") > 5000)
    reasons.push("youtube.description が5000バイトを超える");
  if (/[<>]/.test(description))
    reasons.push("youtube.description に < > がある（YouTube が受けない）");
  reasons.push(...descriptionLink(description, bundle.race_id).reasons);
  if (
    !isHhmm(bundle.send_time) ||
    bundle.send_time < SEND_TIME_EARLIEST ||
    bundle.send_time > SEND_TIME_LATEST
  )
    reasons.push(
      `send_time が ${SEND_TIME_EARLIEST}〜${SEND_TIME_LATEST} の HH:MM でない`,
    );
  if (bundle.video !== undefined && bundle.video !== VIDEO_NAME)
    reasons.push(`video が ${VIDEO_NAME} でない`);
  return reasons;
}

/** DB の読み直し（そのレースの行を shapeRace にした形）と bundle の照合（純粋関数）。理由の配列 */
export function raceReasons(bundle, race) {
  if (!race) return [`${bundle.race_id} が DB に無い`];
  const why = [];
  if (race.cancelled) why.push("DB でそのレースが中止");
  if (race.no_race) why.push("DB でそのレースが不成立");
  if (race.absent) why.push("DB でそのレースに欠場がある");
  if (race.rank1 !== bundle.rank1)
    why.push(`1着が DB と違う（bundle ${bundle.rank1}・DB ${race.rank1}）`);
  if (race.technique !== bundle.technique)
    why.push(
      `決まり手が DB と違う（bundle ${bundle.technique}・DB ${race.technique}）`,
    );
  for (const k of ["venue", "venue_code", "race_number", "grade", "race_date"])
    if (race[k] !== bundle[k])
      why.push(`${k} が DB と違う（bundle ${bundle[k]}・DB ${race[k]}）`);
  if (race.boats.length !== 6)
    why.push(`DB の出走表が6艇でない（${race.boats.length}）`);
  race.boats.forEach((b, i) => {
    for (const f of BOAT_FIELDS)
      if (b[f] !== bundle.boats[i]?.[f])
        why.push(
          `${i + 1}号艇の ${f} が DB と違う（bundle ${bundle.boats[i]?.[f]}・DB ${b[f]}）`,
        );
  });
  return why;
}

/** dry-run の時計。date が今日なら今、違えば（見本の束）その日の送る時刻の2分前（純粋関数） */
export const dryRunClock = (bundle, now) =>
  clockOf(bundle, now, DEFAULT_SEND_TIME);
