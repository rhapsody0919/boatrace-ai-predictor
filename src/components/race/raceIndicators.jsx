/**
 * raceIndicators - レース分析指標の共通定義（BOA-168）
 * データ出走表（DataRaceTable）の行定義（ラベル・値レンダリング・最良艇）を集約する
 *
 * ロード中の未取得セルはソース別pendingに基づきスケルトン表示する
 * （プログレッシブ表示: 取得できた行から順次値が入る）
 *
 * 行の定義は raceIndicatorsRowDefs*.jsx に分け、buildRowDefs が順に並べる
 */
import { bestOf } from "../../utils/bestOf";
import {
  byBoat,
  toNumber,
  translatePartName,
  translateTechnique,
  translateTechniqueShort,
  wakuRateOf,
  TECHNIQUE_KEY_BY_NAME,
} from "./raceIndicatorsHelpers";
import {
  buildBasicRatioRows,
  buildFormRow,
  buildMotorRow,
  buildRowContext,
} from "./raceIndicatorsRowDefs";
import { buildExhibitionRow, buildStRows } from "./raceIndicatorsRowDefsSt";
import {
  EXHIBITION_COURSE_AVAILABLE_FROM,
  ORIGINAL_EXHIBITION_ROW_META,
  buildOriginalExhibitionRowBases,
  expectedCourseWinRateText,
  hasExhibitionCourse,
  isExhibitionCourseOutOfRange,
  originalExhibitionKindLabels,
} from "../../pure/raceIndicatorText.js";
import {
  buildPartsChangedRow,
  buildPrevResultRow,
  buildStatsRows,
  buildWeightRows,
} from "./raceIndicatorsRowDefsBefore";

export {
  EXHIBITION_COURSE_AVAILABLE_FROM,
  ORIGINAL_EXHIBITION_ROW_META,
  TECHNIQUE_KEY_BY_NAME,
  expectedCourseWinRateText,
  hasExhibitionCourse,
  isExhibitionCourseOutOfRange,
  originalExhibitionKindLabels,
  toNumber,
  translatePartName,
  translateTechnique,
  translateTechniqueShort,
  wakuRateOf,
};

// 行の素（key・label・値の字・best の候補）は src/pure/raceIndicatorText.js（表とコピーで共有、RA41d）。
// ここは画面の分だけ（best の印と render）を足す。速いほど良い数字なので best は最小値（dir: "min"）
export function buildOriginalExhibitionRows(t, originalExhibition) {
  const byBoat = originalExhibition?.byBoat ?? {};
  return buildOriginalExhibitionRowBases(t, originalExhibition).map(
    ({ kind, key, label, shortLabel, candidates, formatValue }) => ({
      key,
      label,
      shortLabel,
      // 発走の直前に出る値なので直前情報タブへ（展示タイムと同じ扱い）
      category: "beforeInfo",
      best: bestOf(candidates, "min", { digits: 2 }),
      formatValue,
      render: (p) => {
        const value = toNumber(byBoat[p.number]?.[kind]);
        return value !== null ? (
          <span className="drt-value">{formatValue(p)}</span>
        ) : (
          "—"
        );
      },
    }),
  );
}

/**
 * 指標行の定義を構築する（内部関数、buildIndicatorRows/buildBeforeInfoRowsの共通実装）
 * 各行にcategoryを付与し、DataRaceTable（category: "basic"、デフォルト）と
 * RaceBeforeInfoTab（category: "beforeInfo"）で同じ定義・同じレンダリング
 * ロジックを共有しつつ表示先を分ける（BOA-304）
 * @param {Function} t - i18n
 * @param {Array} players - prediction.allPlayers（枠番順ソート済み）
 * @param {Object} analysis - useRaceAnalysisDataの戻り値
 * @param {Object} pending - ソース別ロード中フラグ（useRaceAnalysisDataのpending）
 */

function buildRowDefs({
  t,
  players,
  analysis,
  pending = {},
  motorDeepLink = null,
  originalExhibition = null,
  entryWeights = null,
  // 級別の後ろに付けるバッジ（F・L数、BOA-638）。(p) => ReactNode。一覧カードの出走表は渡さない
  gradeBadge = null,
}) {
  const c = buildRowContext({
    t,
    players,
    analysis,
    pending,
    motorDeepLink,
    entryWeights,
    gradeBadge,
  });
  return [
    ...buildBasicRatioRows(c),
    ...buildMotorRow(c),
    ...buildFormRow(c),
    ...buildStRows(c),
    ...buildExhibitionRow(c),
    // オリジナル展示（BOA-452 / FR-4b）。展示タイムの直後・ST/体重の手前に置く
    // （ボートレース日和の「展示情報」も 展示→周回→周り足→直線→ST の順で、
    // 「直線で伸びるが回りが重い」のような読み方をこの並びが支えている）。
    //
    // 出せる項目は会場によって違う（住之江・尼崎・徳山は一周・まわり足のみ）ので、
    // 取れた種別ぶんだけ行を作る。取れていない・096未適用で権限が無い場合は
    // originalExhibition が null / state != "published" になり、行は1つも作られない
    // （「—」を6つ並べない。ADR-0067 の前検タイム追記と同じ扱い）
    ...buildOriginalExhibitionRows(t, originalExhibition),
    ...buildWeightRows(c),
    ...buildPartsChangedRow(c),
    ...buildPrevResultRow(c),
    ...buildStatsRows(c),
  ];
}

/**
 * 展示進入の取得時刻（出典表記用）。値がある行の updated_at の最大。
 * 値が1つも無ければ null（出典ブロックに展示進入の行を出さない）
 */
export function exhibitionCourseCapturedAt(motorMaintenance) {
  const times = (motorMaintenance ?? [])
    .filter((row) => toNumber(row.exhibition_course) !== null)
    .map((row) => row.updated_at)
    .filter(Boolean)
    .sort();
  return times.length > 0 ? times[times.length - 1] : null;
}

/**
 * 直前情報タブの「展示進入」行（BOA-485）。公式の直前情報（スタート展示）の
 * コースをそのまま出す。枠番と違うコースに入った艇は強調し、内へ/外へを添える
 * （前づけの予兆。枠なりかどうかが一目で分かることがこの行の目的）。
 *
 * データは getRaceMotorMaintenanceBreakdown（exhibition_data の1回読み取り）に
 * 列を足して取っている。クエリ本数は増えない（BOA-357）。
 *
 * 状態の出し分け:
 *   - 取得開始前のレースで値が無い → null（行を出さない。注記は呼び出し側）
 *   - 取得中 → スケルトン
 *   - 取得失敗 → 「—」（タブ上部の InlineFetchError が失敗を知らせる）
 *   - 欠場 → 「欠場」
 *   - 展示前・未取得 → 「—」
 *
 * RaceCardDataTable（開催場一覧のカード）には出さないため、buildRowDefs には入れない
 */
export function buildExhibitionCourseRow({
  t,
  raceId,
  motorMaintenance,
  pending = {},
}) {
  if (isExhibitionCourseOutOfRange(raceId, motorMaintenance)) return null;
  const byBoatNumber = byBoat(motorMaintenance);
  return {
    key: "exhibitionCourse",
    label: t("beforeInfo.rowExhibitionCourse"),
    shortLabel: t("beforeInfo.rowExhibitionCourseShort"),
    category: "beforeInfo",
    tab: null,
    // コースに良し悪しは無い（事実の記録）。best は持たせない
    best: null,
    cellClass: (p) => {
      const course = toNumber(byBoatNumber.get(p.number)?.exhibition_course);
      return course !== null && course !== p.number ? "drt-entry-moved" : "";
    },
    render: (p) => {
      const row = byBoatNumber.get(p.number);
      if (!row) {
        return pending.motorMaintenance ? (
          <span className="drt-skeleton" aria-hidden="true" />
        ) : (
          "—"
        );
      }
      if (row.is_absent === true) {
        return (
          <span className="drt-sub">{t("beforeInfo.exhibitionAbsent")}</span>
        );
      }
      const course = toNumber(row.exhibition_course);
      if (course === null) return "—";
      const movedKey =
        course < p.number
          ? "beforeInfo.exhibitionCourseMovedIn"
          : course > p.number
            ? "beforeInfo.exhibitionCourseMovedOut"
            : null;
      return (
        <span
          className="drt-value drt-entry-course"
          data-testid="exhibition-course"
        >
          {t("dataTable.prevResultCourse", { course })}
          {movedKey && (
            <span className="drt-sub drt-entry-moved-label">{t(movedKey)}</span>
          )}
        </span>
      );
    },
  };
}

// 全指標（従来通りの挙動、後方互換のため名前は維持）。RaceCardDataTable
// （開催場一覧ページのカード内出走表）が引き続き全指標をまとめて表示するために使う
export function buildIndicatorRows(args) {
  return buildRowDefs(args);
}

// データ出走表（基本情報、DataRaceTable）向け: 直前情報系
// （category: "beforeInfo"）を除いた行（BOA-304）
//
// courseStats（useSixBoatCourseStats の戻り値）を渡すと、艇番で数えた「枠番勝率（直近1年）」の行を
// 枠別情報タブの6艇の表と同じ「想定コース1着率」（公式の直近3期・進入コース）に差し替える（BOA-1296）。
// 一覧カード（RaceCardDataTable、buildIndicatorRows）は渡さないので旧い行のまま
export function buildBasicIndicatorRows(args) {
  const rows = buildRowDefs(args).filter(
    (row) => row.category !== "beforeInfo",
  );
  if (!args.courseStats) return rows;
  return rows.map((row) =>
    row.key === "courseRate"
      ? buildExpectedCourseWinRateRow(args.t, args.courseStats)
      : row,
  );
}

/**
 * 想定コース1着率の行（BOA-1296、spec §1.5）。率は整数%、下に 1着数/進入数。
 * reliability: "warn" は灰の字と ⚠、"none"（10走未満）は「—」と N走。金枠は "ok" の艇だけを候補にする。
 * 取得中はほかの行と同じ読み込みの印、失敗は「—」（0% を出さない）
 */
function buildExpectedCourseWinRateRow(t, { status, rows }) {
  const byBoat = new Map(
    (status === "ready" ? rows : []).map((r) => [r.boat, r]),
  );
  return {
    key: "expectedCourseWinRate",
    label: t("dataTable.rowExpectedCourseWinRate"),
    shortLabel: t("review.cols.expectedCourseWinRate"),
    note: t("dataTable.expectedCourseWinRateNote"),
    wrapNote: true,
    // 旧い行の「超展開データ」（枠番で数える会場の集計）へは送らない。値の元は枠別情報タブの6艇の表
    tab: null,
    best: bestOf(
      [...byBoat.values()]
        .filter((r) => r.reliability === "ok")
        .map((r) => ({ boat: r.boat, value: r.winRate })),
      "max",
      { digits: 0 },
    ),
    render: (p) => {
      if (status === "loading")
        return <span className="drt-skeleton" aria-hidden="true" />;
      const cell = expectedCourseWinRateText(t, byBoat.get(p.number));
      if (!cell) return "—";
      return (
        <span className={`drt-value${cell.muted ? " drt-value--muted" : ""}`}>
          {cell.rate}
          {cell.warn && (
            <span title={t("wakuInfo.sixBoat.smallSampleTitle")}> ⚠</span>
          )}
          <span className="drt-sub">{cell.sub}</span>
        </span>
      );
    },
  };
}

// 直前情報タブ（RaceBeforeInfoTab）向け: 展示ST・展示タイム・オリジナル展示
// （当日体重は alsoBeforeInfo で基本情報タブと両方に出す）
// （一周/半周ラップ/まわり足/直線、BOA-452）・当日体重（BOA-484）・チルト・調整重量・部品交換（BOA-304）
export function buildBeforeInfoRows(args) {
  return buildRowDefs(args).filter(
    (row) => row.category === "beforeInfo" || row.alsoBeforeInfo,
  );
}
