/**
 * raceIndicators の行定義（平均ST・ST・展示ST・展示タイム）
 */
import { bestOf } from "../../utils/bestOf";
import { formatExhibitionSt, slashDate } from "../../utils/formatters";
import { toNumber } from "./raceIndicatorsHelpers";

export function buildStRows(c) {
  const {
    t,
    ph,
    cand,
    stByBoat,
    officialStByBoat,
    st30ByBoat,
    officialPeriod,
  } = c;
  return [
    // 平均ST は2行で出す（BOA-815、2026-10-10 ユーザー承認）。
    // 1行目は公式の出走表と同じ値（2桁、公式が2桁のため）。最良は表示桁で比べるので同じ値が並ぶことがある。
    // 2026-10-02 に3桁にした理由（2桁だと最良が5艇同時に光る）は、3桁の2行目で補う
    {
      key: "avgSt",
      label: t("dataTable.rowAvgSt"),
      shortLabel: t("review.cols.avgSt"),
      note: t("dataTable.rowAvgStOfficialNote"),
      // 期間は名前に入れず「?」に出す（「前期」と書くと5〜6月・11〜12月に意味がずれる。2026-10-10 ユーザー判断）
      ...(officialPeriod
        ? {
            hintKey: "avgStOfficialPeriod",
            hintValues: {
              from: slashDate(officialPeriod.calcFrom),
              to: slashDate(officialPeriod.calcTo),
            },
          }
        : {}),
      tab: "racecard",
      best: bestOf(cand.avgSt, "min", { digits: 2 }),
      render: (p) => {
        const rate = toNumber(officialStByBoat.get(p.number));
        return rate !== null ? (
          <span className="drt-value">{rate.toFixed(2)}</span>
        ) : (
          ph("officialAvgSt")
        );
      },
    },
    {
      key: "avgSt30",
      label: t("dataTable.rowAvgSt30"),
      shortLabel: t("review.cols.avgSt30"),
      tab: "racecard",
      best: bestOf(cand.avgSt30, "min", { digits: 3 }),
      render: (p) => {
        const rate = toNumber(st30ByBoat.get(p.number));
        return rate !== null ? (
          <span className="drt-value">{rate.toFixed(3)}</span>
        ) : (
          ph("st30")
        );
      },
    },
    {
      key: "st",
      label: t("dataTable.rowSt"),
      shortLabel: t("review.cols.st"),
      tab: "st",
      best: bestOf(cand.st, "min", { digits: 2 }),
      render: (p) => {
        const row = stByBoat.get(p.number);
        if (!row || !row.sample_count) return ph("stPredictability");
        return (
          <span className="drt-value">±{row.avg_deviation.toFixed(2)}</span>
        );
      },
    },
    {
      key: "exSt",
      label: t("dataTable.rowExSt"),
      shortLabel: t("review.cols.exSt"),
      // 直前情報タブへ分離（BOA-304）: 発走30/15/10分前まで未確定のため
      category: "beforeInfo",
      tab: "st",
      best: bestOf(cand.exSt, "min", { digits: 2 }),
      render: (p) => {
        const row = stByBoat.get(p.number);
        const shown = formatExhibitionSt(
          row?.exhibition_st,
          row?.exhibition_start_flag,
        );
        if (shown === null) return ph("stPredictability");
        return row?.exhibition_start_flag ? (
          <span className="drt-value" title={t("dataTable.exStFlagTitle")}>
            {shown}
          </span>
        ) : (
          <span className="drt-value">{shown}</span>
        );
      },
    },
  ];
}

export function buildExhibitionRow(c) {
  const { t, ph, cand, exByBoat } = c;
  return [
    {
      key: "exhibition",
      label: t("dataTable.rowExhibition"),
      shortLabel: t("review.cols.exhibition"),
      // 直前情報タブへ分離（BOA-304）: 発走30/15/10分前まで未確定のため
      category: "beforeInfo",
      tab: "extrend",
      best: bestOf(cand.exhibition, "min", { digits: 2 }),
      render: (p) => {
        const row = exByBoat.get(p.number);
        if (!row) return ph("exhibitionTime");
        if (row.exhibition_time !== null && row.exhibition_time !== undefined) {
          return (
            <span className="drt-value">{row.exhibition_time.toFixed(2)}</span>
          );
        }
        if (
          row.avg_exhibition_time !== null &&
          row.avg_exhibition_time !== undefined
        ) {
          return (
            <span className="drt-value drt-sub">
              ({row.avg_exhibition_time.toFixed(2)})
            </span>
          );
        }
        return "—";
      },
    },
  ];
}
