import {
  SCORE_POINTS,
  SPECIAL_SCORE_POINTS,
  TOKUSEN_SCORE_POINTS,
  countsForSeriesScore,
} from "../../src/pure/seriesPoints.js";

/** PR #871 時点の「レース単位」の締め判定（候補比較のために残す） */
function pastPrelimRace(raceId, prelimEndRaceId) {
  if (!prelimEndRaceId) return false;
  return String(raceId) > String(prelimEndRaceId);
}

/**
 * 配点ルールの候補。`table(normalizedStage)` が着順→点数の表を返す。
 * 算入範囲（準優・優勝戦の除外、予選の締め）は全候補で共通
 * ＝PR #871 で公式と一致させた部分は動かさず、配点だけを比べる。
 */
const HYPOTHESES = [
  {
    key: "H0-legacy",
    label: "旧実装: ドリーム|選抜 → 12/10/9/7/6/5",
    table: (s) =>
      s.includes("ドリーム") || s.includes("選抜")
        ? SPECIAL_SCORE_POINTS
        : SCORE_POINTS,
  },
  {
    key: "H1-flat",
    label: "特別配点なし（全部 10/8/6/4/2/1）",
    table: () => SCORE_POINTS,
  },
  {
    key: "H2-dream",
    label: "ドリーム|DR のみ特別配点",
    table: (s) =>
      s.includes("ドリーム") || s.includes("DR")
        ? SPECIAL_SCORE_POINTS
        : SCORE_POINTS,
  },
  {
    key: "H3-dream+tokusen",
    label: "ドリーム|DR → 12/10/9/7/6/5、特選|特賞 → 11/9/7/5/3/2",
    table: (s) => {
      if (s.includes("ドリーム") || s.includes("DR"))
        return SPECIAL_SCORE_POINTS;
      if (s.includes("特選") || s.includes("特賞")) return TOKUSEN_SCORE_POINTS;
      return SCORE_POINTS;
    },
  },
  {
    key: "H4-+senbatsu",
    label: "H3 に加えて 選抜 も 11/9/7/5/3/2",
    table: (s) => {
      if (s.includes("ドリーム") || s.includes("DR"))
        return SPECIAL_SCORE_POINTS;
      if (s.includes("特選") || s.includes("特賞") || s.includes("選抜"))
        return TOKUSEN_SCORE_POINTS;
      return SCORE_POINTS;
    },
  },
  {
    key: "H6-+tokubetsu",
    label: "H4 に加えて 特別（予選特別Ａ戦 等）も 11/9/7/5/3/2",
    table: (s) => {
      if (s.includes("ドリーム") || s.includes("DR"))
        return SPECIAL_SCORE_POINTS;
      if (
        s.includes("特選") ||
        s.includes("特賞") ||
        s.includes("選抜") ||
        s.includes("特別")
      )
        return TOKUSEN_SCORE_POINTS;
      return SCORE_POINTS;
    },
  },
  {
    key: "H7-+medama",
    label: "H4 に加えて 目玉（ドラドキ目玉 等）も 11/9/7/5/3/2",
    table: (s) => {
      if (s.includes("ドリーム") || s.includes("DR"))
        return SPECIAL_SCORE_POINTS;
      if (
        s.includes("特選") ||
        s.includes("特賞") ||
        s.includes("選抜") ||
        s.includes("目玉")
      )
        return TOKUSEN_SCORE_POINTS;
      return SCORE_POINTS;
    },
  },
  {
    key: "H5-senbatsu=dream",
    label: "H3 に加えて 選抜 は 12/10/9/7/6/5（旧実装の扱い）",
    table: (s) => {
      if (s.includes("ドリーム") || s.includes("DR") || s.includes("選抜"))
        return SPECIAL_SCORE_POINTS;
      if (s.includes("特選") || s.includes("特賞")) return TOKUSEN_SCORE_POINTS;
      return SCORE_POINTS;
    },
  },
];

/**
 * 候補の差が出る節だけを取り出すための分類。
 * 全節で平均すると、その表記が出ない節（大多数）に薄められて差が見えない。
 */
const SUBSETS = [
  { key: "all", label: "全節", has: () => true },
  {
    key: "has-dream",
    label: "予選期間内にドリーム/DRがある節",
    has: (s) => s.includes("ドリーム") || s.includes("DR"),
  },
  {
    key: "has-tokusen",
    label: "予選期間内に特選/特賞がある節",
    has: (s) => s.includes("特選") || s.includes("特賞"),
  },
  {
    key: "has-senbatsu",
    label: "予選期間内に選抜がある節",
    has: (s) => s.includes("選抜"),
  },
  {
    key: "has-tokubetsu",
    label: "予選期間内に特別（特選・特賞・特別選抜戦を除く）がある節",
    has: (s) =>
      s.includes("特別") && !s.includes("特選") && !s.includes("特賞") && !s.includes("選抜"),
  },
  {
    key: "has-medama",
    label: "予選期間内に目玉がある節",
    has: (s) => s.includes("目玉"),
  },
];

/** その結果行で、その艇番が何着だったか（`finishPositionOf` と同じ規則） */
function rankOf(result, boatNumber) {
  for (const p of [1, 2, 3, 4, 5, 6]) {
    if (result[`rank${p}`] === boatNumber) return p;
  }
  return null;
}

/**
 * 算入範囲（予選の締め）の候補。
 *
 * PR #871 は「種別が『予選』の最後のレース」で切ったが、**すべての予選レースに
 * 「予選」と付ける会場だけ**でしか正しくない。丸亀の一般戦は 1R〜5R が「予選」で
 * 6R以降が「かけうどん６」「蒼月まるる特賞」のような会場固有名なので、最後の
 * 「予選」より後ろが丸ごと落ちる。逆に蒲郡は最終予選日の 10R〜12R が
 * 「一般特賞」「一般特選」＝予選終了後なので、日単位で切ると入れてはいけない。
 * どちらが実データに合うかを準優進出者との一致で比べる。
 */
/** 現行の実装（`countsForSeriesScore`）。配点候補の比較はこれを使う */
const SHIPPED_CUT = {
  key: "現行",
  label: "現行の `countsForSeriesScore`",
  keep: (meet, row) =>
    countsForSeriesScore(row.race_stage ?? "", row.race_id, meet.prelimEndRaceId),
};

const CUTS = [
  SHIPPED_CUT,
  {
    key: "C0-last-prelim-race",
    label: "PR #871: 種別に「予選」を含む最後のレースまで",
    keep: (meet, row) => !pastPrelimRace(row.race_id, meet.prelimEndRaceId),
  },
  {
    key: "C1-end-of-day",
    label: "「予選」を含む最後のレースが**ある日の最終レース**まで",
    keep: (meet, row) =>
      meet.prelimEndRaceId === null ||
      row.race_id.slice(0, 10) <= meet.prelimEndRaceId.slice(0, 10),
  },
  {
    key: "C2-end-of-day-minus-ippan",
    label: "C1 だが、その日の「一般」と付くレースは除く",
    keep: (meet, row) => {
      if (meet.prelimEndRaceId === null) return true;
      const sameDayOrBefore =
        row.race_id.slice(0, 10) <= meet.prelimEndRaceId.slice(0, 10);
      if (!sameDayOrBefore) return false;
      if (!pastPrelimRace(row.race_id, meet.prelimEndRaceId)) return true;
      return !(row.race_stage ?? "").includes("一般");
    },
  },
  {
    key: "C4-day-range-minus-ippan",
    label: "予選最終日までの全日で「一般」と付くレースを除く（C2の単純化）",
    keep: (meet, row) => {
      if (meet.prelimEndRaceId === null) return true;
      if (row.race_id.slice(0, 10) > meet.prelimEndRaceId.slice(0, 10))
        return false;
      return !(row.race_stage ?? "").includes("一般");
    },
  },
  {
    key: "C3-before-first-semifinal",
    label: "PR #871 以前: 最初の準優より前まで",
    keep: (meet, row) => {
      const firstSemifinal = meet.rows
        .filter((r) => (r.race_stage ?? "").includes("準優"))
        .map((r) => r.race_id)
        .sort()[0];
      return !firstSemifinal || row.race_id < firstSemifinal;
    },
  },
];

export { pastPrelimRace, HYPOTHESES, SUBSETS, rankOf, SHIPPED_CUT, CUTS };
