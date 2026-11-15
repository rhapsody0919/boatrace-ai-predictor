/**
 * raceIndicators の行定義（当日体重・チルト・調整重量・部品交換・前走・枠別・決まり手・回収率）
 */
import { Fragment } from "react";
import { bestOf } from "../../utils/bestOf";
import {
  meetPrevRunState,
  meetPrevRunWhenParams,
} from "../../utils/prevResult";
import {
  toNumber,
  translatePartName,
  translateTechniqueShort,
  wakuRateOf,
} from "./raceIndicatorsHelpers";

export function buildWeightRows(c) {
  const { t, ph, maintenanceByBoat, entryWeights } = c;
  return [
    {
      // 当日体重は計量時点の実測値であり、値の高低が好走/凡走を示唆する指標では
      // ないため、他行と違いbestは持たせない（BOA-289、tilt/adjustmentWeightと同じ扱い）
      //
      // 直前情報タブにも出す（BOA-484、基本情報タブの行はそのまま残す）: 調整重量と
      // 同じく当日に決まる値で、展示前から公開されるため。展示前（exhibition_data の行がまだ無い）は、
      // 出走表の体重（race_entries.weight_kg、発走60分前に取得）を出す。
      // 直前情報ページの体重と同じ時刻に公開され、値も一致する（getRaceEntryWeights）。
      // entryWeights: null=渡されない（RaceCardDataTable 等。従来どおり exhibition_data のみ）、
      // {state:"loading"|"error"|"empty"|"published"}
      key: "todayWeight",
      label: t("dataTable.rowTodayWeight"),
      shortLabel: t("review.cols.todayWeight"),
      alsoBeforeInfo: true,
      tab: null,
      best: null,
      render: (p) => {
        const row = maintenanceByBoat.get(p.number);
        const weight = toNumber(row?.today_weight);
        if (weight !== null) {
          return <span className="drt-value">{weight.toFixed(1)}kg</span>;
        }
        const entryWeight =
          entryWeights?.state === "published"
            ? toNumber(entryWeights.byBoat?.[p.number])
            : null;
        if (entryWeight !== null) {
          return <span className="drt-value">{entryWeight.toFixed(1)}kg</span>;
        }
        if (entryWeights?.state === "loading") {
          return <span className="drt-skeleton" aria-hidden="true" />;
        }
        return row ? "—" : ph("motorMaintenance");
      },
    },
    {
      // チルト・調整重量は選手が選んだ「設定値」であり、値の高低が好走/凡走を
      // 示唆する指標ではないため、他行と違いbestは持たせない（BOA-221）
      key: "tilt",
      label: t("dataTable.rowTilt"),
      shortLabel: t("review.cols.tilt"),
      // 直前情報タブへ分離（BOA-304）: 発走30/15/10分前まで未確定のため
      category: "beforeInfo",
      tab: null,
      best: null,
      render: (p) => {
        const row = maintenanceByBoat.get(p.number);
        if (!row) return ph("motorMaintenance");
        const tilt = toNumber(row.tilt);
        if (tilt === null) return "—";
        return (
          <span className="drt-value">
            {tilt > 0 ? `+${tilt.toFixed(1)}` : tilt.toFixed(1)}
          </span>
        );
      },
    },
    {
      key: "adjustmentWeight",
      label: t("dataTable.rowAdjustmentWeight"),
      shortLabel: t("review.cols.adjustmentWeight"),
      // 直前情報タブへ分離（BOA-304）: 発走30/15/10分前まで未確定のため
      category: "beforeInfo",
      tab: null,
      best: null,
      render: (p) => {
        const row = maintenanceByBoat.get(p.number);
        if (!row) return ph("motorMaintenance");
        const weight = toNumber(row.adjustment_weight);
        return weight !== null ? (
          <span className="drt-value">{weight.toFixed(1)}kg</span>
        ) : (
          "—"
        );
      },
    },
  ];
}

export function buildPartsChangedRow(c) {
  const { t, ph, maintenanceByBoat } = c;
  return [
    {
      // 部品交換・プロペラ交換（当該レースの展示時点、BOA-221の列を流用）。
      // モーター調子ドリルダウン（BOA-221）の「交換履歴」とは異なり、
      // 今回のレース1回分の交換有無のみを示す。値の高低が好走/凡走を
      // 示唆する指標ではないため、他行と違いbestは持たせない
      key: "partsChanged",
      label: t("dataTable.rowPartsChanged"),
      shortLabel: t("review.cols.partsChanged"),
      category: "beforeInfo",
      tab: null,
      best: null,
      render: (p) => {
        const row = maintenanceByBoat.get(p.number);
        if (!row) return ph("motorMaintenance");
        const parts = row.parts_changed ?? null;
        const propellerChanged = !!row.propeller_change;
        if ((!parts || parts.length === 0) && !propellerChanged) return "—";
        return (
          <span className="drt-value drt-parts-changed">
            {parts && parts.length > 0 && (
              <span className="drt-badge">
                {/* 部品名ごとに塊にし、折り返しは区切り（listSeparator）の後と「×２」の前だけにする。
                    1つの文字列だとスマホで「シャフ／ト」と語の途中で折れた
                    （BOA-612 ファン評価3周目）。「リング×２」を1つの塊にすると
                    62px あり、320px の列（約44px）に入らない */}
                {parts.map((part, i) => (
                  <Fragment key={part}>
                    {translatePartName(t, part)
                      .split(/(?=×)/)
                      .map((chunk) => (
                        <span key={chunk} className="drt-part">
                          {chunk}
                        </span>
                      ))}
                    {i < parts.length - 1 && t("listSeparator")}
                  </Fragment>
                ))}
              </span>
            )}
            {propellerChanged && (
              <span className="drt-badge">
                {t("analysis.motor.propellerChanged")}
              </span>
            )}
          </span>
        );
      },
    },
  ];
}

export function buildPrevResultRow(c) {
  const { t, ph, meetPrevByBoat } = c;
  return [
    {
      // 今節の前走（同じ会場・同じ節で、このレースより前の最後の走の着順・進入コース。
      // prevResult.js 参照。BOA-610 で「本日の前走」から変えた）は事実の記録であり、
      // bestは持たせない（BOA-289、tilt/adjustmentWeightと同じ扱い）
      key: "prevResult",
      label: t("dataTable.rowPrevResult"),
      shortLabel: t("review.cols.prevResult"),
      tab: null,
      best: null,
      render: (p) => {
        const row = meetPrevByBoat.get(p.number);
        if (!row) return ph("meetPrevRun");
        const state = meetPrevRunState(row);
        if (state.kind === "firstOfMeet") {
          return (
            // 375px で「今節初／戦」と語の途中で折れない（BOA-610 ファン評価3周目）
            <span className="drt-sub drt-nowrap">
              {t("dataTable.meetFirstRace")}
            </span>
          );
        }
        if (state.kind === "unknown") return "—";
        const when = meetPrevRunWhenParams(state.raceId);
        if (state.kind === "pending") {
          return (
            <span className="drt-value">
              <span className="drt-sub drt-nowrap">
                {t("dataTable.prevResultPending")}
              </span>
              {when && (
                <span className="drt-sub drt-nowrap">
                  {t("dataTable.prevResultWhen", when)}
                </span>
              )}
            </span>
          );
        }
        return (
          <span className="drt-value">
            {state.kind === "rank" ? (
              t("review.finishPosition", { position: state.rank })
            ) : state.markKey ? (
              // 記号は言語ごとの短い表記で出し、意味は title で補う
              <abbr title={t(`result.mark.${state.markKey}`)}>
                {t(`dataTable.prevMark.${state.markKey}`)}
              </abbr>
            ) : (
              state.mark
            )}
            {state.course !== null && (
              <span className="drt-sub drt-nowrap">
                {" "}
                {t("dataTable.prevResultCourse", { course: state.course })}
              </span>
            )}
            {when && (
              <span className="drt-sub drt-nowrap">
                {t("dataTable.prevResultWhen", when)}
              </span>
            )}
          </span>
        );
      },
    },
  ];
}

export function buildStatsRows(c) {
  const {
    t,
    ph,
    cand,
    techByBoat,
    rateByBoat,
    statsByBoat,
    localizedTechnique,
  } = c;
  return [
    {
      key: "courseRate",
      label: t("dataTable.rowCourseRate"),
      shortLabel: t("review.cols.courseRate"),
      tab: "attackdefense",
      best: bestOf(cand.courseRate, "max", { digits: 0 }),
      render: (p) => {
        const cr = wakuRateOf(statsByBoat, p.number);
        if (!cr) return ph("racerStats");
        return (
          <span className="drt-value">
            {cr.rate.toFixed(0)}%
            <span className="drt-sub">
              {cr.wins}/{cr.total}
            </span>
          </span>
        );
      },
    },
    {
      key: "technique",
      label: t("dataTable.rowTechnique"),
      shortLabel: t("review.cols.technique"),
      tab: "techprofile",
      best: null,
      render: (p) => {
        const row = techByBoat.get(p.number);
        if (!row) return ph("techniqueProfile");
        if (!row.win_count || row.techniques.length === 0)
          return <span className="drt-sub">{t("dataTable.noWins")}</span>;
        const top = row.techniques[0];
        return (
          <span className="drt-value drt-technique">
            <span className="drt-tech-full">
              {localizedTechnique(top.technique)}
            </span>
            <span className="drt-tech-short">
              {translateTechniqueShort(t, top.technique)}
            </span>
            <span className="drt-sub">
              {t("dataTable.winCount", { n: row.win_count })}
            </span>
          </span>
        );
      },
    },
    {
      key: "returnRate",
      label: t("dataTable.rowReturnRate"),
      shortLabel: t("review.cols.returnRate"),
      tab: "returnrate",
      best: bestOf(cand.returnRate, "max", { digits: 0 }),
      render: (p) => {
        const row = rateByBoat.get(p.number);
        if (!row || !row.sample_count) return ph("returnRate");
        return (
          <span
            className={`drt-value ${row.win_return_rate >= 100 ? "drt-plus" : ""}`}
          >
            {row.win_return_rate.toFixed(0)}%
          </span>
        );
      },
    },
  ];
}
