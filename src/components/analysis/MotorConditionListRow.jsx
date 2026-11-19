/** MotorConditionChart の一覧表の見出しと行（MotorConditionChart.jsx から本文を字のまま移した） */
import { useTranslation } from "react-i18next";
import { SMALL_SAMPLE_THRESHOLD } from "../../pure/basicInfoStats.js";
import { formatPowerIndex, powerIndexTone } from "../../utils/smallSampleRate";
import { motorRate3View } from "../../utils/motorFreshRate";
import RateBar from "../common/RateBar";
import { BOAT_COLORS, BOAT_LINE_COLORS } from "../../utils/colors";
import { POWER_INDEX_TONE_CLASS } from "./motorConditionView";

export function MotorListHead({ firstMeet, showVenueRank, officialMode, periodDays, hasPretest, showFirstPlaceRate, showFinalCount, showChampionshipCount }) {
  const { t } = useTranslation();
  return (
    <thead>
      <tr>
        <th>{t("analysis.laneHeader")}</th>
        <th>{t("table.playerName")}</th>
        <th>{t("analysis.motor.motorNumberShortHeader")}</th>
        {/* 公式2連率（節時点、棒）と会場内順位を、機番のすぐ右に置く（BOA-428、
        ユーザー承認のモック）。375px で左から5列が最初の画面に入り、6基の強さの
        差と会場の中での位置が、横に送らずに読める。以前（BOA-451）は再計算した
        2連率を先に置き、公式2連率をそのすぐ右にしていた。再計算した2連率は
        消さずに会場内順位の右へ移す（見比べられる位置は保つ）。過去レースは
        2連率の列そのものが公式値なので、その列を棒にし、再計算の列は無い */}
        {/* 過去レースもこの列は出走表時点の公式値なので、見出しは同じ（承認済みのモック） */}
        {/* 最初の開催は全艇が自前の値なので「公式」を外す（BOA-830、2026-10-11 ユーザー決定） */}
        <th className="motor-wrap-head">
          {t(
            firstMeet
              ? "analysis.motor.freshRate2Header"
              : "analysis.motor.officialRate2Header",
          )}
        </th>
        {showVenueRank && (
          <th className="motor-wrap-head motor-venue-rank-head">
            {t("analysis.motor.venueRankHeader")}
          </th>
        )}
        {/* 期間で集計した2連率。公式2連率と並ぶので、見出しに期間を書く（ファン評価） */}
        {!officialMode && (
          <th>
            {t("analysis.motor.rate2PeriodHeader", {
              period: t(
                periodDays === 30
                  ? "analysis.motor.period30"
                  : "analysis.motor.period90",
              ),
            })}
          </th>
        )}
        {/* 当日のレースの3連率も期間の再計算なので、2連率と同じく期間を書く。
            書かないと公式の3連率と読み違える（ファン評価2周目） */}
        <th>
          {officialMode
            ? t("analysis.motor.rate3Header")
            : t("analysis.motor.rate3PeriodHeader", {
                period: t(
                  periodDays === 30
                    ? "analysis.motor.period30"
                    : "analysis.motor.period90",
                ),
              })}
        </th>
        {hasPretest && (
          <th>{t("analysis.motor.pretestTimeHeader")}</th>
        )}
        {showFirstPlaceRate && (
          <th>{t("analysis.motor.firstPlaceRateHeader")}</th>
        )}
        <th>{t("analysis.motor.powerIndexHeader")}</th>
        {showFinalCount && (
          <th>{t("analysis.motor.finalCountHeader")}</th>
        )}
        {showChampionshipCount && (
          <th>{t("analysis.motor.championshipCountHeader")}</th>
        )}
      </tr>
    </thead>
  );
}

function MotorNumCell({ row, currentParts, partsBoat, setPartsBoat }) {
  const { t } = useTranslation();
  return (
    <>
      {/* 見出しが「機番」なので数字だけ（BOA-428、承認済みのモック。375px で棒と
          会場内順位を最初の画面に入れるため「◯号機」を詰めた） */}
      <td className="motor-num">
        {row.motor_number}
        {(() => {
          const parts = currentParts.find((item) => item.boat === row.boat_number);
          return parts && !parts.failed && !parts.unavailable ? (
            <button type="button" className="mcc-parts-badge"
              aria-expanded={partsBoat === row.boat_number}
              aria-controls="mcc-parts-names"
              onClick={(event) => {
                event.stopPropagation();
                setPartsBoat(partsBoat === row.boat_number ? null : row.boat_number);
              }}>
              {t("analysis.motor.partsCountBadge", { n: parts.count })}
            </button>
          ) : null;
        })()}
      </td>
    </>
  );
}

function RateBarCell({ row, i, view, explainBoat, setExplainBoat }) {
  const { t } = useTranslation();
  const { officialRates, officialRateMax, officialRateBestBoats, rateViews, rateLabel } = view;
  return (
    <>
      {/* 連対率は**小数1桁**で出す（BOA-474、2026-09-28）。
        `official_2rate`（`race_entries.motor_2rate`）は、同じ節・同じ
        モーターでもレースによって桁数が違う。出走表の行は二段階で埋まり、
        前夜の初期投入（番組表＝Bファイル由来）は**1桁**、発走60分前ごろの
        出走表更新が**2桁**に上書きするため、当日のまだ更新が走っていない
        レースだけが1桁のまま残る（実測: 2026-09-28 戸田の12R=54.8 /
        6R=54.84、同じ21号機・同じ節・同じ瞬間）。2桁で出すと同じモーターが
        レースによって 54.80 と 54.84 に見える。1桁に揃えると
        **9月の節内不一致748件のうち691件（92.4%）が消える**
        （残りは連続開催の節境界で、桁の問題ではない）。
        基本情報タブのデータ出走表も同じ値を `toFixed(1)` で出しており、
        ボートレース日和も1桁。再計算した2連率/3連率も、母数が数十走で
        2桁目に意味が無いため揃える */}
      <td className="motor-rate-bar-cell">
        <RateBar
          value={officialRates[i]}
          max={officialRateMax}
          // 線用の艇色（1号艇・2号艇はテーマで反転するトークン）。ダークモードで
          // 2号艇の黒い棒が紺の背景に溶けていた（ファン評価）
          fill={BOAT_LINE_COLORS[row.boat_number]}
          best={officialRateBestBoats.has(row.boat_number)}
          label={
            rateViews[i].kind === "own" ? (
              <>
                {rateLabel(rateViews[i], i)}
                {/* 自前の値の印。押すと表の下に出どころを出す（行の
                    ドリルダウンは開かない） */}
                <button
                  type="button"
                  className="motor-fresh-own-mark"
                  aria-expanded={explainBoat === row.boat_number}
                  aria-label={t(
                    "analysis.motor.freshOwnExplain",
                    { n: rateViews[i].runs },
                  )}
                  onClick={(e) => {
                    e.stopPropagation();
                    setExplainBoat((b) =>
                      b === row.boat_number
                        ? null
                        : row.boat_number,
                    );
                  }}
                >
                  {t("analysis.motor.freshOwnMark")}
                </button>
              </>
            ) : (
              rateLabel(rateViews[i], i)
            )
          }
        />
        {/* 入れ替えから90日以内の公式の値は、何走で出た数字かを添える（BOA-830） */}
        {rateViews[i].kind === "official" &&
          rateViews[i].priorRuns !== null && (
            <span className="motor-waku-n motor-fresh-prior-runs">
              {t("analysis.motor.freshPriorRuns", {
                n: rateViews[i].priorRuns,
              })}
            </span>
          )}
      </td>
    </>
  );
}

function MotorPeriodRateCells({ row, view }) {
  const { t } = useTranslation();
  const { officialMode, hasPretest } = view;
  return (
    <>
      {!officialMode && (
        <td className="rate">
          {row.motor_2rate?.toFixed(1)}
          {/* このレースより前に結果の出た走が無い新モーター（当日の
              レースのみ判定できる）。公式の 0.0 は消さずに添える
              （BOA-513、ファン4人のパネル） */}
          {row.sample_count === 0 && (
            <span className="motor-waku-n motor-first-use">
              {t("analysis.motor.firstUseBadge")}
            </span>
          )}
        </td>
      )}
      <td className="rate">
        {/* 過去レースは3連率も公式値。2連率を自前にした艇は3連率も自前にそろえる。
            2連率だけ差し替えると、3連率の 0.0 を「3着以内が一度も無い」と読まれる
            （BOA-830。当日のレースは期間の再計算なのでそのまま） */}
        {officialMode
          ? (() => {
              const v3 = motorRate3View(row);
              if (v3.kind === "notRun") return "-";
              return v3.value === null
                ? "-"
                : v3.value.toFixed(1);
            })()
          : row.motor_3rate?.toFixed(1)}
      </td>
      {hasPretest && (
        <td className="rate motor-pretest-cell">
          {row.pretest_time !== null &&
          row.pretest_time !== undefined ? (
            <>
              {Number(row.pretest_time).toFixed(2)}
              {row.pretest_rank ? (
                <span className="motor-waku-n">
                  {t("analysis.motor.pretestRank", {
                    rank: row.pretest_rank,
                  })}
                </span>
              ) : null}
            </>
          ) : (
            "-"
          )}
        </td>
      )}
    </>
  );
}

function MotorVenueStatCells({ row, i, view }) {
  const { showFirstPlaceRate, showFinalCount, showChampionshipCount, firstPlaceRates, firstPlaceRateRankClass, finalCountRankClass, championshipCountRankClass, venueStatsFailedCell, listPowerIndex, firstMeet } = view;
  return (
    <>
      {showFirstPlaceRate && (
        <td
          className={`rate ${firstPlaceRateRankClass(i)}`}
        >
          {row.venue_stats_failed
            ? venueStatsFailedCell
            : firstPlaceRates[i] !== null
            ? `${firstPlaceRates[i].toFixed(1)}%`
            : "-"}
        </td>
      )}
      <td
        className={`rate power-index ${
          POWER_INDEX_TONE_CLASS[
            powerIndexTone(
              listPowerIndex(row).value,
              listPowerIndex(row).n,
              SMALL_SAMPLE_THRESHOLD,
            )
          ] ?? ""
        }`}
      >
        {listPowerIndex(row).value !== null
          ? formatPowerIndex(listPowerIndex(row).value)
          : "-"}
      </td>
      {showFinalCount && (
        <td
          className={`rate ${finalCountRankClass(i)}`}
        >
          {row.venue_stats_failed
            ? venueStatsFailedCell
            : firstMeet
              ? "-"
              : (row.final_count ?? "-")}
        </td>
      )}
      {showChampionshipCount && (
        <td
          className={`rate ${championshipCountRankClass(i)}`}
        >
          {row.venue_stats_failed
            ? venueStatsFailedCell
            : firstMeet
              ? "-"
              : (row.championship_count ?? "-")}
        </td>
      )}
    </>
  );
}

export function MotorListRow({ row, i, view, focusedBoat, setDrillDownMotor, onFocusBoat, currentParts, partsBoat, setPartsBoat, explainBoat, setExplainBoat }) {
  const { showVenueRank, venueRankCell } = view;
  return (
    <tr
      className={[
        "motor-ranking-row",
        // 他のタブで選んだ艇は、一覧のまま行で示す（ドリルダウンは
        // 自動で開かない。一覧が主役で、初回の表示を変えない。BOA-494 案A）
        row.boat_number === focusedBoat ? "is-focused" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      onClick={() => {
        setDrillDownMotor(row.motor_number);
        // 行を押したら、他のタブにもその艇の選択を引き継ぐ
        onFocusBoat?.(row.boat_number);
      }}
    >
      {/* 枠は艇色のチップ（承認済みのモック。結果タブの .rr-boat-chip と同じ） */}
      <td className="rank">
        <span
          className="rr-boat-chip"
          style={{
            background: BOAT_COLORS[row.boat_number]?.bg,
            color: BOAT_COLORS[row.boat_number]?.text,
          }}
        >
          {row.boat_number}
        </span>
      </td>
      <td translate="no">
        {row.player_name?.replace(/\s+/g, "")}
      </td>
      <MotorNumCell row={row} currentParts={currentParts} partsBoat={partsBoat} setPartsBoat={setPartsBoat} />
      <RateBarCell row={row} i={i} view={view} explainBoat={explainBoat} setExplainBoat={setExplainBoat} />
      {showVenueRank && (
        <td className="motor-venue-rank">
          {venueRankCell(row.motor_number)}
        </td>
      )}
      <MotorPeriodRateCells row={row} view={view} />
      <MotorVenueStatCells row={row} i={i} view={view} />
    </tr>
  );
}
