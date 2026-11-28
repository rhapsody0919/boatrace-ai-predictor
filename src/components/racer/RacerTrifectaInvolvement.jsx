import { useEffect, useMemo, useState } from "react";
import InlineFetchError from "../InlineFetchError";
import { getRaceTrifectaPayouts } from "../../services/racerQueries3.js";
import {
  trifectaInvolvementRows,
  trifectaInvolvementSeries,
  TRIFECTA_TREND_START,
} from "../../pure/racerTrifectaInvolvement.js";
import RacerTrifectaChart from "./RacerTrifectaChart";
import "./RacerTrifectaInvolvement.css";

/**
 * 3着以内のレースの3連単配当（表と、1走あたり配当の通算の推移）。オーナー承認 2026-11-26
 * （side-session-notes の g2-racer/tri。ファン4人の議論で形を決め、data-scientist・wording-editor・visual-designer を通した）。
 * 「この枠の中は絞り込みが効きます」の枠の中に置き、絞り込みで数え直す。参考の値なので畳み、色・矢印・順位は付けない。
 * 「1走あたり配当」は舟券1点の成績ではないので円で出し、回収率・% と並べない
 */

const LABELS = { 1: "1着", 2: "2着", 3: "3着", all: "全体" };
const yen = (v) => Math.round(v).toLocaleString("ja-JP");

/**
 * 配当は走ごとの履歴とは別に読む（履歴の形は全貌動画と共有して固定されているため）。失敗は state に持つ。
 * 読んだ配当には、どの走の分かを鍵で持たせ、今の走の分がそろうまで ready にしない。絞り込み（進入コース）で
 * 履歴が替わると古い配当が残り、取得中・失敗のときに「0円・0回」の表を本物の顔で出した（ファン評価 P1 2026-11-26）
 */
function useTrifectaPayouts(racerId, history) {
  const raceIds = useMemo(() => (history ?? []).map((row) => row.raceId), [history]);
  const key = raceIds.join(",");
  const [state, setState] = useState({ key: null, payouts: null, errorKey: null, error: null, retry: 0 });
  useEffect(() => {
    if (raceIds.length === 0) return undefined;
    let alive = true;
    getRaceTrifectaPayouts(racerId, raceIds)
      .then((payouts) => alive && setState((s) => ({ ...s, key, payouts })))
      .catch((error) => alive && setState((s) => ({ ...s, errorKey: key, error })));
    return () => {
      alive = false;
    };
  }, [racerId, raceIds, key, state.retry]);
  const retry = () => setState((s) => ({ ...s, errorKey: null, error: null, retry: s.retry + 1 }));
  // 失敗も今の走の分だけを出す。今の走の配当がそろうまで表は作らない
  const error = state.errorKey === key ? state.error : null;
  const ready = raceIds.length > 0 && state.key === key && !error;
  return { payouts: ready ? state.payouts : null, error, retry };
}

const Unit = ({ children }) => <span className="rti-unit">{children}</span>;

function MedianCell({ row }) {
  if (row.values) return <>{row.values.map(yen).join("・")}<Unit>円</Unit></>;
  if (row.median === null) return "—";
  return <>{yen(row.median)}<Unit>円</Unit></>;
}

function InvolvementTable({ rows, runs }) {
  return (
    <div className="table-wrapper">
      <table className="racer-return-rate-table rti-table">
        <thead>
          <tr>
            <th>着順</th>
            <th>回数</th>
            <th>全{runs}走<br />あたり配当</th>
            <th>中央値</th>
            <th>万舟</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key} className={row.key === "all" ? "rti-total" : undefined}>
              <th scope="row">{LABELS[row.key]}</th>
              <td>{row.count}<Unit>回</Unit></td>
              <td>{row.perRun === null ? "—" : <>{yen(row.perRun)}<Unit>円</Unit></>}</td>
              <td><MedianCell row={row} /></td>
              <td>{row.manshu}<Unit>回</Unit></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function RacerTrifectaInvolvement({ racerId, vc, vcLabel }) {
  // 畳んだままの人に余計な取得をさせない。開いたときに読む
  const [open, setOpen] = useState(false);
  const { payouts, error, retry } = useTrifectaPayouts(racerId, open ? vc.vcHistory : null);
  const venueCode = vc.vcVenueFixed ? Number(vc.vcVenue) : null;
  const boatNumber = vc.vcBoatFixed ? Number(vc.vcBoat) : null;
  const raceGrade = vc.vcGrade === "all" ? null : vc.vcGrade;
  const raceStage = vc.vcStage === "all" ? null : vc.vcStage;
  const filter = useMemo(
    () => ({ venueCode, boatNumber, raceGrade, raceStage }),
    [venueCode, boatNumber, raceGrade, raceStage],
  );
  const table = useMemo(
    () => (payouts ? trifectaInvolvementRows(vc.vcHistory, filter, payouts) : null),
    [vc.vcHistory, filter, payouts],
  );
  // 見出しの走数は配当を読む前から出す（隣の枠番別回収率とそろえる）
  const runs = useMemo(() => trifectaInvolvementRows(vc.vcHistory, filter, {}).runs, [vc.vcHistory, filter]);
  const points = useMemo(
    () => (payouts ? trifectaInvolvementSeries(vc.vcHistory, filter, payouts) : []),
    [vc.vcHistory, filter, payouts],
  );
  if (!vc.vcHistory?.length) return null;
  return (
    <details className="racer-technique-profile racer-return-fold rti-fold" onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary>
        3着以内のレースの3連単配当
        {vc.vcActive && <span className="racer-vc-scope">— {vcLabel}</span>}
        <span className="racer-return-fold-hint">参考・{runs}走・上の絞り込みが全て効きます</span>
      </summary>
      {error && <InlineFetchError onRetry={retry} />}
      {!error && !table && <p className="racer-stat-note">読み込み中...</p>}
      {table && (
        <>
          <InvolvementTable rows={table.rows} runs={table.runs} />
          <div className="rti-trend">
            <p className="rti-trend-title">1走あたり配当の推移（各走の時点までの通算）</p>
            <p className="rti-trend-sub">{TRIFECTA_TREND_START}走目から</p>
            {points.length >= 2 ? (
              <>
                <RacerTrifectaChart points={points} />
                <p className="racer-vc-note">○は万舟（3連単1万円以上）の走。配当がいちばん大きかった万舟の走に日付を付けています。</p>
              </>
            ) : (
              <p className="racer-vc-note">出走が{TRIFECTA_TREND_START + 1}走に満たないため、推移の線は出しません</p>
            )}
          </div>
          <p className="racer-vc-note">
            3着以内に入ったレースの3連単の配当（100円あたり）です。「全{table.runs}走あたり配当」は、その配当の合計を全ての出走数（{table.runs}走）で割った額で、舟券1点の成績ではありません。配当は相手の2艇や人気でも決まります。
          </p>
          <p className="racer-vc-note">中央値は回数が少ないと幅が広く、2回以下は値をそのまま出しています。</p>
        </>
      )}
    </details>
  );
}
