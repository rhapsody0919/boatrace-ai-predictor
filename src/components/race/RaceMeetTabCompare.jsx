/**
 * RaceMeetTab の「6艇の今節」比較表（行＝艇、列＝得点率・節内順位・前検）。
 * 値は RaceMeetTabModel の `buildMeetModel` の結果（m）で受け取る。
 */
import { FINISH_ABSENT, MEET_SMALL_SAMPLE_RUNS, meetRateHidden } from "./seriesPoints";
import { rankInBorder, EXCLUDED_LABEL_KEY } from "./RaceMeetTabModel";
import RaceMeetTabCompareSide from "./RaceMeetTabCompareSide";
import { BoatRowSelectButton } from "./RaceMeetTabForecast";

// 得点率は平均なので「1着→6着」と「3着→3着」が同じ5.00になる。
// 次をどう見るかは並びで変わる
function Finishes({ m, finishes }) {
  const { t, prelimOver } = m;
  return (
    finishes.length > 0 && (
      <span className="rmt-finishes">
        <span className="rmt-finishes-label">
          {/* 予選が終わった後は、並びは予選の走だけ（得点率に数える走、BOA-457）。
              「着順」とだけ書くと、準優の日の一般戦など後の走が抜けて見える
              （2026-09-29 戸田12R の山田康二: 並び6走・節の全走は7走。BOA-568） */}
          {t(prelimOver ? "meetTab.finishLabelPrelim" : "meetTab.finishLabel")}
        </span>
        {finishes.map((f, i2) => (
          <span key={i2}>
            {i2 > 0 && t("meetTab.finishSeparator")}
            {/* 1着だけ強く出す。勝負駆けは「勝ちがあるか」で
                見え方が変わり、並びの中で一番探される数字 */}
            <span className={f === 1 ? "is-win" : undefined}>
              {f === FINISH_ABSENT
                ? t("meetTab.finishAbsent")
                : (f ?? t("meetTab.finishDq"))}
            </span>
          </span>
        ))}
      </span>
    )
  );
}

// 前検は「何位か」より「何秒か」で水面を読む数字。順位だけでは会場の
// 出方が分からない
function PretestCell({ m, p }) {
  const { t, pretestOf, bestCls, bestPretest } = m;
  const pt = pretestOf(p.racerId);
  return (
    <td className={`rmt-pretest${bestCls(bestPretest, p.number)}`}>
      {pt?.pretest_time !== null && pt?.pretest_time !== undefined
        ? pt.pretest_rank
          ? t("meetTab.pretestCell", {
              time: Number(pt.pretest_time).toFixed(2),
              rank: pt.pretest_rank,
            })
          : Number(pt.pretest_time).toFixed(2)
        : pt?.pretest_rank
          ? t("meetTab.pretestRank", { rank: pt.pretest_rank })
          : "—"}
    </td>
  );
}

// 比較表の行見出し（艇番・名前・級別＋着順の並び）
function PlayerHead({ m, p, finishes }) {
  const { t, pretestOf } = m;
  const pt = pretestOf(p.racerId);
  return (
    <th scope="row">
      <BoatRowSelectButton m={m} p={p}>
        {pt?.racer_class && (
          <span className="rmt-class" title={t("meetTab.classTitle")}>
            {pt.racer_class}
          </span>
        )}
      </BoatRowSelectButton>
      <Finishes m={m} finishes={finishes} />
    </th>
  );
}

function RateCell({ m, p, row }) {
  const { t, bestCls, bestRate } = m;
  const hideRate = meetRateHidden(row);
  return (
    <td className={`rmt-rate${bestCls(bestRate, p.number)}`}>
      {!hideRate && row.runs < MEET_SMALL_SAMPLE_RUNS && (
        <span className="rmt-warn" title={t("basicInfo.smallSampleTitle")}>
          ⚠
        </span>
      )}
      {hideRate ? "—" : row.rate.toFixed(2)}
      {/* 公式の前夜の減点を引いた選手（BOA-782）。着順の点と合わない理由を行で示す */}
      {!hideRate && row.penaltyFromOfficial > 0 && (
        <span className="rmt-penalty">
          {t("meetTab.penaltyMark", {
            points: row.penaltyFromOfficial,
          })}
        </span>
      )}
    </td>
  );
}

function RankCell({ m, p, row }) {
  const { t, bestCls, bestRank, tiedCount, postPrelimFlying } = m;
  const tied = tiedCount(row.rank);
  return (
    <td className={`rmt-rank${bestCls(bestRank, p.number)}`}>
      {/* 途中で節を離脱した選手・賞典除外の選手は順位の対象外
          （公式も同じ）。理由で説明を出し分ける（BOA-587） */}
      {row.rank === null ? (
        <span
          className="rmt-excluded"
          title={t(
            `meetTab.${EXCLUDED_LABEL_KEY[row.excludedReason] ?? "withdrawn"}Title`,
          )}
        >
          {t(`meetTab.${EXCLUDED_LABEL_KEY[row.excludedReason] ?? "withdrawn"}`)}
        </span>
      ) : tied > 1 ? (
        <span title={t("meetTab.rankTiedTitle", { tied })}>
          {t("meetTab.rankTied", { rank: row.rank })}
        </span>
      ) : (
        t("meetTab.rankPlain", { rank: row.rank })
      )}
      {/* 予選の後にFを切った選手。順位は予選で確定しているので
          残すが、予選中のFの選手（賞典除外で順位なし）と並ぶと
          食い違って見えるため印を添える（BOA-626） */}
      {row.rank !== null && postPrelimFlying.has(row.racerId) && (
        <span
          className="rmt-post-flying"
          title={t("meetTab.postPrelimFlyingTitle")}
        >
          {t("meetTab.postPrelimFlying")}
        </span>
      )}
    </td>
  );
}

function RankedRow({ m, p, row, borderEdge }) {
  const { selectedBoat, onFocusBoat, showBorderBadge, slots } = m;
  const inBorder = showBorderBadge && rankInBorder(row, slots);
  return (
    <tr
      className={[
        p.number === selectedBoat ? "is-current" : "",
        // 「目安内」をセル内のバッジで出すと、390pxで
        // 前検の列が card の外へ押し出されて切れた。
        // 行の左帯＋点線＋注記に置き換える
        inBorder ? "is-in-border" : "",
        borderEdge ? "is-border-edge" : "",
      ]
        .filter(Boolean)
        .join(" ")}
      // 行＝選手なので、行をタップしたら下の詳細が切り替わる。
      // 下のチップまで指を動かさせない（表は横スクロールしない
      // ためスワイプ誤爆の懸念も無い）
      onClick={() => onFocusBoat(p.number)}
    >
      <PlayerHead m={m} p={p} finishes={row.finishes} />
      <RateCell m={m} p={p} row={row} />
      <RankCell m={m} p={p} row={row} />
      <PretestCell m={m} p={p} />
    </tr>
  );
}

function RankedRows({ m }) {
  const { sortedPlayers, ranking, showBorderBadge, slots } = m;
  return sortedPlayers
    .map((p) => ({
      player: p,
      row: ranking.find((r) => r.racerId === p.racerId),
    }))
    .filter((x) => x.row)
    // 順位の対象外（途中帰郷・賞典除外）は末尾（目安の点線の下）に回す。
    // 得点率の順のままだと点線より上に並び、「点線より上が目安内」と読めた
    // （BOA-782 ファン評価3周目）
    .sort(
      (a, b) =>
        Number(a.row.withdrawn) - Number(b.row.withdrawn) ||
        b.row.rate - a.row.rate,
    )
    .map(({ player: p, row }, i, arr) => {
      const inBorder = showBorderBadge && rankInBorder(row, slots);
      // 目安内の最後の行に太い罫線を引く。「誰が線の上か」は
      // 数字を突き合わせないと分からず、実際に読み落とされた。
      // 次の行だけでなく、下に目安内の行が1つも無いことで決める。順位の
      // 対象外（途中帰郷・賞典除外）が目安内の間に挟まると、線が2本になり
      // 下の目安内の艇が「線より下」に見えた（BOA-782 ファン評価2周目）
      const borderEdge =
        inBorder &&
        !arr.slice(i + 1).some((x) => rankInBorder(x.row, slots));
      return (
        <RankedRow
          key={p.number}
          m={m}
          p={p}
          row={row}
          borderEdge={borderEdge}
        />
      );
    });
}

function AbsentRows({ m }) {
  const { t, sortedPlayers, absentOnly, selectedBoat, onFocusBoat } = m;
  return sortedPlayers
    .map((p) => ({
      player: p,
      absent: absentOnly.find((r) => r.racerId === p.racerId),
    }))
    .filter((x) => x.absent)
    .map(({ player: p, absent }) => (
      <tr
        key={p.number}
        className={["is-absent", p.number === selectedBoat ? "is-current" : ""]
          .filter(Boolean)
          .join(" ")}
        onClick={() => onFocusBoat(p.number)}
      >
        <PlayerHead m={m} p={p} finishes={absent.finishes} />
        {/* 走数0で得点率・順位は出ない。空欄や0.00にせず
            欠場と書く（BOA-504） */}
        <td className="rmt-rate">
          <span title={t("meetTab.absentTitle")}>{t("meetTab.absent")}</span>
        </td>
        <td className="rmt-rank">—</td>
        <PretestCell m={m} p={p} />
      </tr>
    ));
}

// 今節をまだ走っていない艇（BOA-660）
function NotYetRunRows({ m }) {
  const { t, notYetRun, selectedBoat, onFocusBoat, isCancelled } = m;
  return notYetRun.map((p) => (
    <tr
      key={p.number}
      className={["is-not-yet-run", p.number === selectedBoat ? "is-current" : ""]
        .filter(Boolean)
        .join(" ")}
      onClick={() => onFocusBoat(p.number)}
    >
      <PlayerHead m={m} p={p} finishes={[]} />
      <td className="rmt-rate">—</td>
      {/* 中止のレースは走らないので「初戦」と書かない（ファン評価1周目） */}
      <td className="rmt-rank">
        {t(isCancelled ? "meetTab.notYetRunCancelled" : "meetTab.notYetRun")}
      </td>
      <PretestCell m={m} p={p} />
    </tr>
  ));
}

function CompareTable({ m }) {
  const { t, seriesSplit, meetTotal } = m;
  return (
    <table className="rmt-compare">
      <thead>
        <tr>
          <th scope="col">{t("meetTab.colBoat")}</th>
          <th scope="col">{t("meetTab.colScore")}</th>
          <th scope="col">{t("meetTab.colRank")}</th>
          <th scope="col">
            {/* Ｗ優勝戦の節では、節内順位は片側（24人前後）の中の順位なのに、
                前検の順位は節全体の中の順位（公式の値）。分母を見出しに出す（BOA-690） */}
            {seriesSplit
              ? t("meetTab.colPretestOf", { total: meetTotal })
              : t("meetTab.colPretest")}
          </th>
        </tr>
      </thead>
      <tbody>
        <RankedRows m={m} />
        <AbsentRows m={m} />
        <NotYetRunRows m={m} />
      </tbody>
    </table>
  );
}

// 6艇横断。レースを開いて最初に見るもの。6艇とも今節初戦（初日の1R等）でも表を出す。
// 表を出さないと1Rだけ見え方が変わり、出場人数も出ない（PR #1102 ファン評価1周目）
export default function RaceMeetTabCompare({ m }) {
  const { t, ranking, notYetRun } = m;
  if (!(ranking.length > 0 || notYetRun.length > 0)) return null;
  return (
    <div className="rmt-card">
      <h3 className="rmt-card-title">{t("meetTab.compareTitle")}</h3>
      {/* PC（1200px 以上）は表を左、注記を右の2段（BOA-881） */}
      <div className="race-split">
        <div className="race-split__main">
          <CompareTable m={m} />
        </div>
        <RaceMeetTabCompareSide m={m} />
      </div>
    </div>
  );
}
