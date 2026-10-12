/**
 * レース詳細（/race/:raceId）の見出し・title・description・canonical・パンくずの組み方。
 *
 * 人の画面（RaceDetailPage.jsx）と、ボット向け HTML の関数（ADR 0089 第2段、api/_lib/botRace.js）が
 * 同じ値を出すよう、1箇所で組む。t は i18next の t。Node からも import するため、ブラウザ専用の依存を持ち込まない。
 * 検証: scripts/maintenance/verify-bot-race-function.js
 */
import { localizePath } from "../config/languages.js";
import { GRADE_CONFIG } from "../constants/gradeConfig.js";
import {
  getRaceStageBadge,
  getRaceStageCategory,
} from "../constants/raceStageConfig.js";
import { isRaceCancelled } from "./raceCancellation.js";
import { formatDateLocalized } from "./formatters.js";

const SITE_ORIGIN = "https://www.boat-ai.jp";

// 開催の何日目かの表示ラベル（BOA-488）。値が無ければnull（「—」も出さない）。
// 初日と最終日が同時に立つ1日開催は実在しないため、判定順は仕様の記載順に従う
export function getSeriesDayLabel(seriesDay, isFinalDay, t) {
  if (seriesDay === 1) return t("raceDetailPage.seriesDayFirst");
  if (isFinalDay === true) return t("raceDetailPage.seriesDayFinal");
  if (Number.isInteger(seriesDay) && seriesDay > 1) {
    return t("raceDetailPage.seriesDayNth", { day: seriesDay });
  }
  return null;
}

// 見出しの種別チップ（BOA-509）。分類できたものは分類名、できないもの
// （会場の企画レース名）は公式表記のまま出す。race_stage はレースごとの値なので
// 他レースで補わない（無ければ出さない）
const SPECIAL_STAGE_KEYS = new Set([
  "dream",
  "selection",
  "qualifierSpecial",
  "generalSpecial",
  "special",
]);

export function getStageChip(raceStage, t) {
  if (!raceStage) return null;
  const official = raceStage.normalize("NFKC");
  const category = getRaceStageCategory(raceStage);
  if (!category) {
    // 企画レース名は種別名と見分けがつかないので、何の名前かをツールチップで補う
    return {
      variant: "raw",
      label: official,
      title: t("raceStage.venueOriginal"),
      isOfficial: true,
    };
  }
  const label = t(category.i18nKey);
  const variant =
    category.key === "final" || category.key === "semifinal"
      ? category.key
      : SPECIAL_STAGE_KEYS.has(category.key)
        ? "special"
        : "plain";
  return {
    variant,
    label,
    // 優勝戦・準優勝戦は RaceCard のバッジと同じ絵文字を添える
    emoji: getRaceStageBadge(raceStage)?.emoji,
    // 分類名と公式表記が同じ（「予選」「優勝戦」等）ならツールチップは出さない
    title:
      label === official
        ? undefined
        : t("raceStage.officialName", { name: official }),
    isOfficial: false,
  };
}

/**
 * 見出しの値（グレード・節タイトル・種別チップ・日目）
 *
 * @param {object|null} racePrediction - そのレース（getPredictions の race。null なら全部 null）
 * @param {object[]} venueRaws - 同じ会場・同じ日のレース（getPredictions の race、レース番号順）
 * @param {(key: string, params?: object) => string} t
 * @returns {{gradeConfig: {label: string, color: string}|undefined, seriesTitle: string|null,
 *   stageChip: ReturnType<typeof getStageChip>, seriesDayLabel: string|null}}
 */
export function getRaceDetailHeading(racePrediction, venueRaws, t) {
  // series_day はレース単位で出走表の取得時に書き込まれるため、当日はまだ
  // 埋まっていないレースが残る（2026-09-28昼の実測で144R中52Rがnull。
  // 丸亀は1Rだけ3日目で2〜12Rがnull）。日目は会場・日付単位で
  // 同じ値なので、自レースに無ければ同じ会場の他レースの値を使う（追加クエリなし）。
  // series_day・is_final_day・race_title はそれぞれ単独で欠けることがあるため
  // 項目ごとに補う。2026-09-04 浜名湖9R・11R は series_day=6 だけ入り
  // is_final_day・race_title・race_stage が null で、レースごとにまとめて補うと
  // 同じ日の12Rが「最終日」なのに「6日目」と出た（BOA-509 ファン評価 P1）
  const venueValue = (key) =>
    racePrediction?.[key] ??
    venueRaws.find((r) => r[key] != null)?.[key] ??
    null;
  // 丸一日レースが無かった日（その会場のその日のレースが全部中止確定）は日目を出さない
  // （BOA-658）。公式は翌日に同じ日目を振り直すので、series_day の値（津 9/22 は2）を
  // そのまま出すと「2日目」が2日続く。今節タブも「日目に数えていません」と断っている
  const wholeDayCancelled =
    venueRaws.length > 0 && venueRaws.every((r) => isRaceCancelled(r));
  const seriesDayLabel =
    racePrediction && !wholeDayCancelled
      ? getSeriesDayLabel(venueValue("seriesDay"), venueValue("isFinalDay"), t)
      : null;
  // 節タイトル（BOA-509）
  const rawSeriesTitle = racePrediction ? venueValue("raceTitle") : null;
  return {
    // 一般（ippan）は GRADE_CONFIG に無いのでバッジを出さない（BOA-96 と同じ）
    gradeConfig: GRADE_CONFIG[racePrediction?.raceGrade],
    seriesTitle: rawSeriesTitle ? rawSeriesTitle.normalize("NFKC") : null,
    stageChip: racePrediction
      ? getStageChip(racePrediction.raceStage, t)
      : null,
    seriesDayLabel,
  };
}

/**
 * title・description・canonical。開催日を入れる（無いと同じ会場・同じR番号の全日付で同じになり、
 * 検索結果で重複扱いになる）。4言語で出すページなので、canonical は表示中の言語の URL
 *
 * @param {(key: string, params?: object) => string} t
 * @param {{raceId: string, venueCode: number, raceNo: number, date: string}} race
 * @param {string} lang
 */
export function getRaceDetailMeta(
  t,
  { raceId, venueCode, raceNo, date },
  lang,
) {
  const params = {
    venue: t(`venues.${venueCode}`),
    race: raceNo,
    date: formatDateLocalized(date, lang),
  };
  return {
    title: t("raceDetailPage.metaTitle", params),
    description: t("raceDetailPage.metaDescription", params),
    canonical: `${SITE_ORIGIN}${localizePath(`/race/${raceId}`, lang)}`,
  };
}

/**
 * レース一覧（会場ページ）へのリンク先。本日は /venue/:code（言語の接頭辞つき）、過去日は /races/:date/:code
 */
export function getRaceListLink({ venueCode, date }, isToday, lang) {
  return isToday
    ? localizePath(`/venue/${venueCode}`, lang)
    : `/races/${date}/${venueCode}`;
}

/**
 * パンくず。本日: ホーム › 会場 › NR。過去日: ホーム › 過去の予想 › 日付 › 会場 › NR
 *
 * @param {(key: string, params?: object) => string} t
 * @param {{raceId: string, venueCode: number, raceNo: number, date: string}} race
 * @param {boolean} isToday
 * @param {string} lang
 */
export function getRaceDetailBreadcrumbItems(t, race, isToday, lang) {
  return [
    { name: t("analysisPage.breadcrumbHome"), url: localizePath("/", lang) },
    ...(isToday
      ? []
      : [
          {
            name: t("raceDetailPage.pastPredictionsBreadcrumb"),
            url: "/races",
          },
          {
            name: formatDateLocalized(race.date, lang),
            url: `/races/${race.date}`,
          },
        ]),
    {
      name: t(`venues.${race.venueCode}`),
      url: getRaceListLink(race, isToday, lang),
    },
    {
      name: `${race.raceNo}R`,
      url: localizePath(`/race/${race.raceId}`, lang),
    },
  ];
}
