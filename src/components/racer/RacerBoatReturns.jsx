import { useMemo, useState } from "react";
import { BOAT_COLORS } from "../../utils/colors";
import { boatReturnRows, boatReturnSeries } from "../../pure/racerBoatReturns.js";
import RacerBoatReturnChart from "./RacerBoatReturnChart";
import "./RacerBoatReturns.css";

/**
 * 枠番別回収率（表と、枠番ごとの通算の推移）。オーナー承認 2026-11-26（side-session-notes の g2-racer/rr2・rr3）。
 * 「この枠の中は絞り込みが効きます」の枠の中に置き、期間・会場・枠番・グレード・種別・進入コースの絞り込みで数え直す
 * （元は過去180日に固定で、30走未満を「-」で隠していた。オーナーの指摘 2026-11-26）。
 * 参考の値なので畳み、色・矢印・順位は付けない。走数は全行に出し、6走未満は灰、0走は「—」
 */

const FEW_RUNS = 6;

function Rate({ value }) {
  if (value === null) return "—";
  return (
    <>
      {Math.round(value).toLocaleString("ja-JP")}
      <span className="rbr-unit">%</span>
    </>
  );
}

function ReturnTable({ rows }) {
  return (
    <div className="table-wrapper">
      <table className="racer-return-rate-table rbr-table">
        <thead>
          <tr>
            <th>枠番</th>
            <th>出走</th>
            <th>単勝回収率</th>
            <th>複勝回収率</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.boat} className={row.n > 0 && row.n < FEW_RUNS ? "rbr-few" : undefined}>
              <td>{row.boat}</td>
              <td>{row.n}</td>
              <td>
                <Rate value={row.winReturn} />
                {row.n > 0 && <span className="rbr-sub">1着{row.wins}回</span>}
              </td>
              <td>
                <Rate value={row.placeReturn} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BoatPicker({ selected, onSelect }) {
  return (
    <div className="rbr-picker" role="group" aria-label="推移を見る枠番">
      {[1, 2, 3, 4, 5, 6].map((boat) => (
        <button
          key={boat}
          type="button"
          className="rbr-pick"
          aria-pressed={boat === selected}
          style={
            boat === selected
              ? { background: BOAT_COLORS[boat].bg, color: BOAT_COLORS[boat].text }
              : undefined
          }
          onClick={() => onSelect(boat)}
        >
          {boat}
        </button>
      ))}
    </div>
  );
}

function ReturnTrend({ vc, filter, boat, onSelect }) {
  const points = useMemo(
    () => boatReturnSeries(vc.vcHistory, filter, boat),
    [vc.vcHistory, filter, boat],
  );
  return (
    <div className="rbr-trend">
      <p className="rbr-trend-title">推移（各走の時点までの通算）</p>
      {!vc.vcBoatFixed && <BoatPicker selected={boat} onSelect={onSelect} />}
      <p className="rbr-trend-sub">
        {boat}号艇・{points.length}走・点線は100%
      </p>
      {points.length >= 2 ? (
        <>
          <RacerBoatReturnChart points={points} />
          <p className="racer-vc-note">
            走が少ないうちは、1回の払戻で線が大きく動きます。○は単勝の払戻金が1,000円以上だった走。いちばん大きい走に日付を付けています。
          </p>
        </>
      ) : (
        <p className="racer-stat-note">この枠番の走が2走未満のため、推移の線は出しません</p>
      )}
    </div>
  );
}

export default function RacerBoatReturns({ vc, vcLabel }) {
  const [picked, setPicked] = useState(1);
  // 会場・枠番・グレード・種別の絞り。進入コースは vc.vcHistory の時点で絞られている
  const venueCode = vc.vcVenueFixed ? Number(vc.vcVenue) : null;
  const boatNumber = vc.vcBoatFixed ? Number(vc.vcBoat) : null;
  const raceGrade = vc.vcGrade === "all" ? null : vc.vcGrade;
  const raceStage = vc.vcStage === "all" ? null : vc.vcStage;
  const filter = useMemo(
    () => ({ venueCode, boatNumber, raceGrade, raceStage }),
    [venueCode, boatNumber, raceGrade, raceStage],
  );
  const rows = useMemo(() => boatReturnRows(vc.vcHistory, filter), [vc.vcHistory, filter]);
  if (!vc.vcHistory?.length) return null;
  const total = rows.reduce((sum, row) => sum + row.n, 0);
  const boat = filter.boatNumber ?? picked;
  return (
    <details className="racer-technique-profile racer-return-fold rbr-fold">
      <summary>
        枠番別回収率
        {vc.vcActive && <span className="racer-vc-scope">— {vcLabel}</span>}
        <span className="racer-return-fold-hint">参考・{total}走・期間と会場は上の絞り込み</span>
      </summary>
      <ReturnTable rows={rows} />
      <ReturnTrend vc={vc} filter={filter} boat={boat} onSelect={setPicked} />
      <p className="racer-vc-note">
        回収率は、単勝・複勝の払戻金（100円あたり）の合計を「出走数×100円」で割った値です。走数が少ないとぶれが大きく、1号艇でも30走で単勝は±40ポイントほど動きます。外の枠は払戻が大きく振れやすく、これより大きくぶれます。1回の大きな払戻で値が跳ね上がることがあります。選手の力の差や次の結果を示す値ではありません。
      </p>
    </details>
  );
}
