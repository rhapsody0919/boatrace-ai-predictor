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
  buildPartsChangedRow,
  buildPrevResultRow,
  buildStatsRows,
  buildWeightRows,
} from "./raceIndicatorsRowDefsBefore";

export {
  TECHNIQUE_KEY_BY_NAME,
  toNumber,
  translatePartName,
  translateTechnique,
  translateTechniqueShort,
  wakuRateOf,
};

/**
 * オリジナル展示（一周・半周ラップ・まわり足・直線）の行を作る（BOA-452 / FR-4b）。
 *
 * `supabaseDataService.getRaceOriginalExhibition` の戻り値をそのまま受け取り、
 * **値が取れている種別のぶんだけ**行を返す。次のいずれかなら空配列を返す
 * （行ごと出さない。空の「—」を並べない）:
 *   - null（まだ取得していない / 取得に失敗した）
 *   - state === "forbidden"（マイグレーション096が未適用で匿名に権限が無い）
 *   - state === "empty"（計測前・未公開）
 *
 * 速いほど良い数字なので best は最小値（`dir: "min"`）。1艇でも値が欠けている
 * 種別でも、値がある艇の中の最小に印を付ける（`bestOf` が null を除く）
 */
export const ORIGINAL_EXHIBITION_ROW_META = {
  一周: { key: "oriLap", labelKey: "dataTable.rowOriLap" },
  半周ラップ: { key: "oriHalfLap", labelKey: "dataTable.rowOriHalfLap" },
  まわり足: { key: "oriTurn", labelKey: "dataTable.rowOriTurn" },
  直線: { key: "oriStraight", labelKey: "dataTable.rowOriStraight" },
};

/**
 * 出典表記に並べる項目名（その会場・そのレースで実際に出した種別だけ）を訳して返す。
 * 住之江・尼崎・徳山のように「一周・まわり足」しか計測しない会場で「直線」まで書くと、
 * 出していない値の出典を名乗ることになるため、行と同じ集合から作る
 */
export function originalExhibitionKindLabels(t, kinds) {
  return (kinds ?? [])
    .map((kind) => ORIGINAL_EXHIBITION_ROW_META[kind])
    .filter(Boolean)
    .map((meta) => t(meta.labelKey));
}

export function buildOriginalExhibitionRows(t, originalExhibition) {
  if (!originalExhibition || originalExhibition.state !== "published")
    return [];
  const byBoat = originalExhibition.byBoat ?? {};
  return (originalExhibition.kinds ?? [])
    .map((kind) => {
      const meta = ORIGINAL_EXHIBITION_ROW_META[kind];
      // 取得側が新しい種別を拾い始めた場合、訳の無いラベルを出すより
      // 行を出さないほうが安全（次の改修で meta に足す）
      if (!meta) return null;
      const candidates = Object.entries(byBoat).map(([boat, values]) => ({
        boat: Number(boat),
        value: toNumber(values?.[kind]),
      }));
      if (candidates.every((c) => c.value === null)) return null;
      // JSX とコピーで同じ文字列を使う。描画の構造には依存しない。
      const formatValue = (p) => {
        const value = toNumber(byBoat[p.number]?.[kind]);
        return value !== null ? value.toFixed(2) : "—";
      };
      return {
        key: meta.key,
        label: t(meta.labelKey),
        shortLabel: t(meta.labelKey),
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
      };
    })
    .filter(Boolean);
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
 * 展示進入（スタート展示のコース）を取り始めた日（BOA-479、マイグレーション082）。
 * これより前のレースは遡って取れない（2026-09-28実測: 09-20以前はほぼ全行NULL）
 */
export const EXHIBITION_COURSE_AVAILABLE_FROM = "2026-09-21";

export const hasExhibitionCourse = (motorMaintenance) =>
  (motorMaintenance ?? []).some(
    (row) => toNumber(row.exhibition_course) !== null,
  );

/**
 * 展示進入が「取得の対象外」のレースか（取得開始前のレースで、値も1つも無い）。
 * 対象外なら行を出さず、表の下に控えめな注記だけを出す。
 * 取得開始前でも値があれば（09-19に一部だけ入っている）そのまま出す
 */
export function isExhibitionCourseOutOfRange(raceId, motorMaintenance) {
  const raceDate = (raceId ?? "").slice(0, 10);
  if (!raceDate || raceDate >= EXHIBITION_COURSE_AVAILABLE_FROM) return false;
  return !hasExhibitionCourse(motorMaintenance);
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
/**
 * 想定コース1着率の1艇の字（表とAI用のコピーで共有、BOA-1296）。
 * 選手が取れない艇（racerId なし）は null（呼び出し側で「—」）。
 * @returns {{rate: string, sub: string, warn: boolean, muted: boolean} | null}
 */
export function expectedCourseWinRateText(t, row) {
  if (!row || row.racerId == null) return null;
  const none = row.reliability === "none" || row.winRate == null;
  return {
    rate: none ? "—" : `${row.winRate.toFixed(0)}%`,
    sub: none
      ? t("beforeInfo.meetFormRunN", { n: row.entries })
      : `${row.wins}/${row.entries}`,
    warn: row.reliability === "warn",
    muted: row.reliability !== "ok",
  };
}

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
