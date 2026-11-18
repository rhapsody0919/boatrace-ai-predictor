/**
 * レース分析指標の字の小さな部品（決まり手・部品名の訳、数値化、オリジナル展示の行の素、展示進入・想定コース1着率の字）。画面の部品
 * （components/race/raceIndicatorsHelpers.jsx が再 export）と、表の字を作るフック（useAiCopyText）が
 * 同じ関数を読むために src/pure に置く（RA41d）
 */
import { TECHNIQUE_NAMES } from "./techniqueNames.js";

export const TECHNIQUE_KEY_BY_NAME = Object.fromEntries(
  Object.entries(TECHNIQUE_NAMES).map(([key, name]) => [name, key]),
);

// 決まり手（DB値・日本語）を表示用に翻訳する。未知の値はそのまま返す
export const translateTechnique = (t, name) => {
  const key = TECHNIQUE_KEY_BY_NAME[name];
  return key ? t(`techniques.${key}`, name) : name;
};

// スマホ幅のデータ出走表の決まり手のマスに出す短い訳語（BOA-821）。英語は英語の部分、繁体字は漢字だけで、
// 括弧の補足（「Nige (Escape)」「外攻（Makuri）」）を外す。補足の単語が折れず列を押し広げ、表が枠からはみ出していた。
// 日本語・韓国語は今の訳語と同じ。未知の値はそのまま返す
export const translateTechniqueShort = (t, name) => {
  const key = TECHNIQUE_KEY_BY_NAME[name];
  return key ? t(`techniquesShort.${key}`, translateTechnique(t, name)) : name;
};

// 部品交換の部品名（公式表記・日本語）→ partsNames.* のキー（BOA-669）
const PART_KEY_BY_NAME = {
  リング: "ring",
  ピストン: "piston",
  キャブ: "carburetor",
  ギヤ: "gear",
  シリンダ: "cylinder",
  電気: "electrical",
  シャフト: "shaft",
  キャリボ: "carrierBody",
};

// 部品名を表示用に翻訳する。「リング×２」の「×２」は個数なのでそのまま付ける。未知の値はそのまま返す
export const translatePartName = (t, name) => {
  const [base, ...rest] = String(name).split(/(?=×)/);
  const key = PART_KEY_BY_NAME[base];
  return key ? `${t(`partsNames.${key}`, base)}${rest.join("")}` : name;
};

export const toNumber = (value) => {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : null;
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

/**
 * オリジナル展示の行の素（表とコピーで共有）。画面の best の印と render は
 * components/race/raceIndicators.jsx の buildOriginalExhibitionRows が足す。
 * candidates は best を決める艇ごとの値（null を含む）
 */
export function buildOriginalExhibitionRowBases(t, originalExhibition) {
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
        kind,
        key: meta.key,
        label: t(meta.labelKey),
        shortLabel: t(meta.labelKey),
        candidates,
        formatValue,
      };
    })
    .filter(Boolean);
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
