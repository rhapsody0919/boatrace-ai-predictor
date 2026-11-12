/**
 * RaceMeetTab の「得点率早見」（6艇×着順）。公式と同じ行列で、ボーダーの目安との
 * 関係を色で示す。「当確」という断定はしない（番組が未確定で
 * ボーダー自体が推定のため。公式も「毎日変動します」と注記している）。
 * 値は RaceMeetTabModel の `buildMeetModel` の結果（m）で受け取る。
 */
import { BOAT_COLORS, getBoatChipBackground } from "../../utils/colors";
import HorizontalScrollButtons from "../common/HorizontalScrollButtons";
import { MEET_SMALL_SAMPLE_RUNS, meetRateHidden } from "./seriesPoints";
import { EXCLUDED_LABEL_KEY } from "./RaceMeetTabModel";

function ForecastHead({ m }) {
  const { t, hasNeeded } = m;
  return (
    <thead>
      <tr>
        <th scope="col">{t("meetTab.colBoat")}</th>
        <th scope="col">{t("meetTab.colScore")}</th>
        {/* 公式（PC横長）は必要得点を右端に置くが、390pxでは
            右端の列が画面外になる。「今の得点率」と「あと何点要るか」
            が一番見たい2つなので前に出す */}
        {hasNeeded && <th scope="col">{t("meetTab.colNeeded")}</th>}
        {[1, 2, 3, 4, 5, 6].map((n) => (
          <th key={n} scope="col">
            {t("meetTab.forecastRankHeader", { rank: n })}
          </th>
        ))}
      </tr>
    </thead>
  );
}

// 行見出しの選択ボタン（艇番のチップ＋名前。children は名前の後ろに続く）。比較表と共有
export function BoatRowSelectButton({ m, p, children }) {
  const { onFocusBoat, selectedBoat } = m;
  const color = BOAT_COLORS[p.number] || {};
  return (
    <button
      type="button"
      className="rmt-row-select"
      onClick={() => onFocusBoat(p.number)}
      aria-pressed={p.number === selectedBoat}
    >
      <span
        className="rmt-boat-chip"
        style={{
          background: getBoatChipBackground(p.number),
          color: color.text,
        }}
      >
        {p.number}
      </span>
      <span className="rmt-name" translate="no">
        {p.name?.replace(/\s+/g, "")}
      </span>
      {children}
    </button>
  );
}

function ForecastPlayerHead({ m, p }) {
  return (
    <th scope="row">
      <BoatRowSelectButton m={m} p={p} />
    </th>
  );
}

function ForecastRateCell({ m, row }) {
  const { t, showBorderBadge, border } = m;
  const hideRate = meetRateHidden(row);
  return (
    <td
      className={`rmt-rate${
        showBorderBadge &&
        border !== undefined &&
        !row.withdrawn &&
        row.rate >= border
          ? " is-in-border"
          : ""
      }`}
    >
      {/* 走数が少ない得点率は、目安に届いて青くても当てにならない。
          比較表と同じ⚠を付ける（BOA-757） */}
      {!hideRate && row.runs < MEET_SMALL_SAMPLE_RUNS && (
        <span className="rmt-warn" title={t("basicInfo.smallSampleTitle")}>
          ⚠
        </span>
      )}
      {hideRate ? "—" : row.rate.toFixed(2)}
    </td>
  );
}

// 必要得点は今日の残りの予選ぶん（1日2走ある選手もいる）
// を足した点数。横の早見は次の1走だけなので、2走以上
// 残っていれば走数を添える。無いと「1着でも目安に
// 届かないのに必要得点17」と食い違って読める（BOA-596）
function NeededReachable({ t, needed, remaining }) {
  return (
    <>
      {t("meetTab.neededPoints", {
        points: needed.needed,
      })}
      {/* 走数は2行目に小さく出す。1行に並べると
          375pxで列が広がり、早見の3着以降が
          最初の画面から外れた（ファン評価1周目） */}
      {remaining > 1 && (
        <span className="rmt-needed-runs">
          {t("meetTab.neededPointsRuns", {
            runs: remaining,
          })}
        </span>
      )}
    </>
  );
}

function NeededCell({ m, row, needed, remaining }) {
  const { t } = m;
  return (
    <td className="rmt-needed">
      {/* 順位の対象外（賞典除外・今節F・途中帰郷）の選手は準優に
          乗れないので、必要得点を出さない（BOA-587）。公式の備考で
          途中帰郷の選手は今日の番組に残っていることがあり、「必要得点0」と
          出て目安に届いたように読まれた（BOA-782 ファン評価1周目） */}
      {row.withdrawn ? (
        <span className="rmt-excluded">
          {t(`meetTab.${EXCLUDED_LABEL_KEY[row.excludedReason] ?? "withdrawn"}`)}
        </span>
      ) : needed === null ? (
        "—"
      ) : needed.reachable ? (
        <NeededReachable t={t} needed={needed} remaining={remaining} />
      ) : (
        <span className="rmt-unreachable">{t("meetTab.neededUnreachable")}</span>
      )}
    </td>
  );
}

function ForecastCells({ m, row, cells, remaining }) {
  const { showBorderBadge, border } = m;
  const hideRate = meetRateHidden(row);
  return cells.map((f) => (
    <td
      key={f.rank}
      className={
        showBorderBadge &&
        border !== undefined &&
        !row.withdrawn &&
        // 今日2走以上残る選手の行は色を付けない。セルの数字は
        // 「次の1走だけ」の得点率で、準優に届くかは残りの
        // 走次第なので、その着で届くとは言えない。1周目は
        // 「残りを全部6着でも届くか」で塗ったが、数字と色の
        // 基準がずれ「7.00なのに色なし」と読まれた（BOA-596）
        remaining <= 1 &&
        f.rate >= border
          ? "is-in-border"
          : undefined
      }
    >
      {hideRate ? "—" : f.rate.toFixed(2)}
    </td>
  ));
}

function ForecastRow({ m, item }) {
  const { player: p, row, cells, needed, remaining } = item;
  const { selectedBoat, onFocusBoat, hasNeeded } = m;
  return (
    <tr
      className={p.number === selectedBoat ? "is-current" : ""}
      onClick={() => onFocusBoat(p.number)}
    >
      <ForecastPlayerHead m={m} p={p} />
      <ForecastRateCell m={m} row={row} />
      {hasNeeded && (
        <NeededCell m={m} row={row} needed={needed} remaining={remaining} />
      )}
      <ForecastCells m={m} row={row} cells={cells} remaining={remaining} />
    </tr>
  );
}

function ForecastTable({ m }) {
  const { forecastRows } = m;
  return (
    <table className="rmt-forecast-table">
      <ForecastHead m={m} />
      <tbody>
        {forecastRows.map((item) => (
          <ForecastRow key={item.player.number} m={m} item={item} />
        ))}
      </tbody>
    </table>
  );
}

function ForecastMain({ m }) {
  // 早見の表（6艇×着順）は390pxで右が切れるため手がかりを出す（useHorizontalScrollHint）
  const { ref, hasMore, hasLess, update, scrollRight, scrollLeft } =
    m.forecastScroll;
  return (
    <div className="race-split__main">
      <div
        className={`rmt-forecast-hint hscroll-hint${hasMore ? " has-more" : ""}`}
      >
        {/* 右へ送ると艇番・選手名の列が消えて、ボタンでは戻れなかった。左の列を固定し、
            「‹」も出す（BOA-699・BOA-704） */}
        <HorizontalScrollButtons
          hasMore={hasMore}
          hasLess={hasLess}
          onMore={scrollRight}
          onLess={scrollLeft}
        />
        <div
          className="rmt-forecast-scroll"
          ref={ref}
          onScroll={update}
        >
          <ForecastTable m={m} />
        </div>
      </div>
    </div>
  );
}

function ForecastSide({ m }) {
  const { t, slots, border, showBorderBadge } = m;
  const hasBorder = showBorderBadge && border !== undefined;
  return (
    <div className="race-split__side">
      <p className="rmt-sub">
        {hasBorder
          ? t("meetTab.forecastNote", {
              slots,
              rate: border.toFixed(2),
            })
          : t("meetTab.forecastNoteNoBorder")}
      </p>
      {/* 得点率の列の青い文字の意味（BOA-711 U2 のファン評価: どこにも書かれていなかった）。
          文をつなぐ空白の扱い（和文で「。 」にしない）が要らないよう、段落を分ける */}
      {hasBorder && <p className="rmt-sub">{t("meetTab.forecastRateBlueNote")}</p>}
      {/* 目安の出し方と誤差、必要得点の式は長いので折りたたむ。
          実測の差（若松G1 0.07 / 桐生一般 0.83）まで書くのは、
          「数位ずれる」を具体で示さないと目安の精度を過信されるため */}
      {hasBorder && (
        <details className="rmt-how">
          <summary>{t("meetTab.forecastDetailSummary")}</summary>
          <p className="rmt-caveat">{t("meetTab.forecastDetail", { slots })}</p>
        </details>
      )}
    </div>
  );
}

export default function RaceMeetTabForecast({ m }) {
  const { t, forecastRows } = m;
  if (forecastRows.length === 0) return null;
  return (
    <div className="rmt-card">
      <h3 className="rmt-card-title">{t("meetTab.forecastTitle")}</h3>
      <div className="race-split">
        <ForecastMain m={m} />
        <ForecastSide m={m} />
      </div>
    </div>
  );
}
