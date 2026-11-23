import { formatPercent } from "../../utils/formatters";

// 選手ページの成績・調子（RacerPerformanceStats）の成績ブロック（会場・枠番の固定状況で4分岐、ADR-0063）と枠番別回収率

// 会場別/枠番別の一覧テーブル。行クリックでフィルタに反映する形が4箇所
// （会場別・枠番別の全体一覧、会場/枠番固定時のクロス集計2種）で共通のため
// 集約（BOA-159レビューで発見、component-reuse.md準拠）
function StatBreakdownTable({ headers, rows, translateNo }) {
  return (
    <div className="table-wrapper">
      <table
        className="racer-return-rate-table"
        translate={translateNo ? "no" : undefined}
      >
        <thead>
          <tr>
            {headers.map((header) => (
              <th key={header}>{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={row.key}
              className="racer-vc-row-clickable"
              onClick={row.onClick}
            >
              {row.cells.map((cell, index) => (
                <td key={index}>{cell}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const rateOrDash = (v) => (v !== null ? formatPercent(v) : "-");

/** 会場別成績（両方未固定） */
export function VenueBreakdown({ t, vc, venueStats }) {
  return (
    <div className="racer-technique-profile">
      <h3>
        会場別成績（当地成績、2025年12月以降・最大過去2年・出走5走以上）
        <span className="h3-hint">会場名をクリックで絞り込み →</span>
      </h3>
      <StatBreakdownTable
        translateNo
        headers={["会場", "出走数", "1着率", "2連率", "3連率"]}
        rows={venueStats.map((row) => ({
          key: row.venue_code,
          onClick: () => vc.setVcVenue(String(row.venue_code)),
          cells: [
            t(`venues.${row.venue_code}`),
            row.total_races,
            rateOrDash(row.win_rate),
            rateOrDash(row.top2_rate),
            rateOrDash(row.top3_rate),
          ],
        }))}
      />
    </div>
  );
}

/** 枠番別成績（両方未固定、全会場計） */
export function CourseBreakdown({ vc, courseStats }) {
  return (
    <div className="racer-technique-profile">
      <h3>
        枠番別成績（当サイト集計・2025年12月以降・全会場計）
        <span className="h3-hint">枠番をクリックで絞り込み →</span>
      </h3>
      <p className="racer-vc-note">
        ※何号艇で出たかで分けた成績です。実際に入ったコースで分けた成績は、公式の期別成績がある選手なら上の「進入コース別成績（公式）」にあります
      </p>
      <StatBreakdownTable
        headers={["枠番", "出走数", "勝数", "1着率", "2連率", "3連率"]}
        rows={courseStats.map((row) => ({
          key: row.course,
          onClick: () => vc.setVcBoat(String(row.course)),
          cells: [
            row.course,
            row.total,
            row.wins,
            rateOrDash(row.winRate),
            rateOrDash(row.top2Rate),
            rateOrDash(row.top3Rate),
          ],
        }))}
      />
    </div>
  );
}

function NoRuns({ vcLabel }) {
  return (
    <p className="racer-stat-note">
      {vcLabel}: 該当する出走がありません（対象期間:
      2025年12月以降、最大過去2年）
    </p>
  );
}

/** 会場か枠番の片方だけ固定したときのクロス集計の表（無ければ注記） */
function CrossBreakdown({
  heading,
  hint,
  translateNo,
  headers,
  rows,
  vc,
  vcLabel,
}) {
  const { vcCrossData } = vc;
  return (
    <div className="racer-technique-profile">
      <h3>
        {heading} — {vcLabel}
        <span className="h3-hint">{hint}</span>
      </h3>
      {vcCrossData && vcCrossData.length > 0 ? (
        <StatBreakdownTable
          translateNo={translateNo}
          headers={headers}
          rows={rows}
        />
      ) : (
        <NoRuns vcLabel={vcLabel} />
      )}
    </div>
  );
}

const crossCells = (first, row) => [
  first,
  row.n,
  rateOrDash(row.winRate),
  rateOrDash(row.top2Rate),
  rateOrDash(row.top3Rate),
];

/** 会場だけ固定: その会場の枠番別成績 */
export function CrossBoatBreakdown({ vc, vcLabel }) {
  return (
    <CrossBreakdown
      heading="枠番別成績"
      hint="枠番をクリックでさらに絞り込み →"
      headers={["枠番", "出走数", "1着率", "2連率", "3連率"]}
      rows={(vc.vcCrossData ?? []).map((row) => ({
        key: row.key,
        onClick: () => vc.setVcBoat(String(row.key)),
        cells: crossCells(`${row.key}号艇`, row),
      }))}
      vc={vc}
      vcLabel={vcLabel}
    />
  );
}

/** 枠番だけ固定: その枠番の会場別成績 */
export function CrossVenueBreakdown({ t, vc, vcLabel }) {
  return (
    <CrossBreakdown
      heading="会場別成績"
      hint="会場をクリックでさらに絞り込み →"
      translateNo
      headers={["会場", "出走数", "1着率", "2連率", "3連率"]}
      rows={(vc.vcCrossData ?? []).map((row) => ({
        key: row.key,
        onClick: () => vc.setVcVenue(String(row.key)),
        cells: crossCells(t(`venues.${row.key}`, row.key), row),
      }))}
      vc={vc}
      vcLabel={vcLabel}
    />
  );
}

/** 会場・枠番を両方固定して、該当の出走が無いときの注記 */
export function BothFixedNoRuns({ vc, vcData, vcLabel }) {
  const show =
    vc.vcVenueFixed &&
    vc.vcBoatFixed &&
    !vc.vcHistoryLoading &&
    !vc.vcHistoryError &&
    vcData &&
    vcData.n === 0;
  return show ? <NoRuns vcLabel={vcLabel} /> : null;
}

const returnOrDash = (v) => (v !== null ? `${v.toFixed(0)}%` : "-");

/** 回収率を出す最少の走数。未満の行は「-」（選手ごとの回収率は時期の前後でほぼ当たらない。number-scope.md §4） */
const RETURN_RATE_MIN_RUNS = 30;
const returnCell = (row, v) =>
  row.sample_count >= RETURN_RATE_MIN_RUNS ? returnOrDash(v) : "-";

/**
 * 枠番別回収率（過去180日）。参考の値なので畳み、矢印・色・順位は付けない。
 * 見出しの走数は枠番の出走数の和（その期間の全出走）
 */
export function ReturnRateTable({ view, boatReturnRate }) {
  if (!view.hasReturnRate) return null;
  const total = boatReturnRate.reduce((sum, row) => sum + row.sample_count, 0);
  return (
    <details className="racer-technique-profile racer-return-fold">
      <summary>
        枠番別回収率（過去180日）
        <span className="racer-return-fold-hint">参考・{total}走</span>
      </summary>
      <p className="racer-vc-note">
        {RETURN_RATE_MIN_RUNS}走未満の枠番は「-」にしています。回収率は走数が少ないと大きくぶれるため、順位や好不調の目安にはしないでください
      </p>
      <div className="table-wrapper">
        <table className="racer-return-rate-table">
          <thead>
            <tr>
              <th>枠番</th>
              <th>出走数</th>
              <th>単勝回収率</th>
              <th>複勝回収率</th>
            </tr>
          </thead>
          <tbody>
            {boatReturnRate.map((row) => (
              <tr key={row.boat_number}>
                <td>{row.boat_number}</td>
                <td>{row.sample_count}</td>
                <td>{returnCell(row, row.win_return_rate)}</td>
                <td>{returnCell(row, row.place_return_rate)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
