/**
 * RaceResult - レース結果表示コンポーネント（着順・配当・決まり手のみ）
 *
 * 2026-09-16(BOA-346): 従来ここにあった「答え合わせ」ロジック
 * （イン崩れ指数の的中/不的中判定showVolatilityOutcome/isUpset、展開予測の実測精度）は
 * 「AI予想」タブ（RaceAiPredictionTab.jsx）へ移設した。結果タブは着順・配当・決まり手の
 * みのシンプルな内容に絞る方針（BOA-305〜312フィードバック#7の延長）
 */
import { useTranslation } from "react-i18next";
import { translateTechnique } from "./raceIndicators";
import { parseRaceId } from "../../utils/raceId";
import VenueDaySummaryCard from "./VenueDaySummaryCard";
import RaceStartFormation from "./RaceStartFormation";

import { RaceResultTable } from "./RaceResultTable";
import { RaceResultPayoutSection } from "./RaceResultPayoutSection";
import { useRaceResultData } from "./RaceResultData";
import InlineFetchError from "../InlineFetchError";
import PastRateLayerGate from "./pastRate/PastRateLayerGate";
import PastRateReview from "./pastRate/PastRateReview";
import { getDeadlineDate } from "../../utils/raceDeadlineStatus";
import {
  FINISH_MARKS,
  RACE_OUTCOME,
  getRaceOutcomeState,
  getRefundBoats,
  isBoatRefunded,
  normalizeFinishMark,
} from "../../utils/raceOutcome";
import {
  derivePayoutInfo,
  deriveStartTimingInfo,
  podiumDecision,
} from "./raceResultPayoutInfo";
import { PayoutRowsTable } from "./RaceResultPayoutRows";
// 結果表の行を組み立てる（BOA-543）。rank1〜rank6 は公式ページの並び順のままで、
// 返還艇（F・L・欠）や不成立レースの艇も着順の列に入っている（浜名湖 2026-09-14 6R の
// rank=4-1-2 はうち1・2号艇がF）。そのため race_start_timings の finish_rank・finish_mark が
// あるときはそちらで着順を組み立て、着が数字でない艇（F・L・欠・落・転・妨・＿ 等）は
// 着順から外して公式の記号のまま末尾に並べる。
// 不成立（raceStatus='no_race'）は着順が無いので、全艇を枠順に記号で並べる。
// 返還艇（refundBoats）は、着欄が数字でも着順に入れない（繰り上げもしない）。
// finish_mark が1行も無い（取得失敗・2026-09-21より前の大半）ときは rank1〜 を着順として使い、
// 成立状態が分かっていれば返還艇だけを着順から外す。
//
// 行: { key, boat, position(1〜6 | null), mark(正規化した記号 | null), refunded, time }
function buildResultRows(result, startTimings, boatsInRace) {
  const outcome = getRaceOutcomeState(result);
  const isNoRace = outcome === RACE_OUTCOME.NO_RACE;
  // レースタイムは race_time1〜6 が rank1〜6 と同じ並びで入っているため、艇→列の位置で引く
  const rankIndexByBoat = new Map();
  [1, 2, 3, 4, 5, 6].forEach((position) => {
    const boat = result[`rank${position}`];
    if (boat && !rankIndexByBoat.has(boat)) {
      rankIndexByBoat.set(boat, position - 1);
    }
  });
  const timeOf = (boat) =>
    rankIndexByBoat.has(boat)
      ? (result.raceTimes?.[rankIndexByBoat.get(boat)] ?? null)
      : null;
  const unrankedRow = (boat, mark) => ({
    key: `boat-${boat}`,
    boat,
    position: null,
    mark,
    refunded:
      isBoatRefunded(result, boat) || Boolean(FINISH_MARKS[mark]?.refund),
    // 着順の無い艇（返還・失格・不成立）にはレースタイムを出さない（公式と同じ）
    time: null,
  });

  const hasFinishData = (startTimings ?? []).some(
    (st) => st.finishMark != null,
  );
  if (!hasFinishData) {
    if (isNoRace) {
      return boatsInRace.map((boat) => unrankedRow(boat, null));
    }
    const ranked = [1, 2, 3, 4, 5, 6]
      .map((position) => ({ position, boat: result[`rank${position}`] }))
      .filter((row) => row.boat && !isBoatRefunded(result, row.boat))
      .map(({ position, boat }) => ({
        key: `rank-${position}`,
        boat,
        position,
        mark: null,
        refunded: false,
        time: result.raceTimes?.[position - 1] ?? null,
      }));
    const refunded = getRefundBoats(result)
      .filter((boat) => !ranked.some((row) => row.boat === boat))
      .sort((a, b) => a - b)
      .map((boat) => unrankedRow(boat, null));
    return [...ranked, ...refunded];
  }

  const isRanked = (st) =>
    !isNoRace &&
    st.finishRank != null &&
    /^[1-6]$/.test(String(st.finishMark ?? "")) &&
    !isBoatRefunded(result, st.boatNumber);
  const ranked = startTimings
    .filter(isRanked)
    .sort((a, b) => a.finishRank - b.finishRank || a.boatNumber - b.boatNumber)
    .map((st) => ({
      key: `boat-${st.boatNumber}`,
      boat: st.boatNumber,
      position: st.finishRank,
      mark: null,
      refunded: false,
      time: timeOf(st.boatNumber),
    }));
  const unranked = startTimings
    .filter((st) => !isRanked(st))
    .sort((a, b) => a.boatNumber - b.boatNumber)
    .map((st) => {
      const mark = normalizeFinishMark(st.finishMark);
      // 着欄が数字なのに着順に入れない艇（不成立のレース・返還艇。本来は無い）は、数字を
      // 着順のように見せないよう記号を外す（不成立なら「着順なし」、返還なら「返還」のラベル）
      const isNumeric = mark != null && /^[1-6]$/.test(mark);
      return unrankedRow(
        st.boatNumber,
        isNumeric ? (isNoRace ? "_" : null) : mark,
      );
    });
  return [...ranked, ...unranked];
}

// 不成立の理由の1行（「フライング5艇（1・2・3・5・6号艇）で不成立」）。着順なし（＿）以外の
// 全艇が返還の記号（F・L・欠）のときだけ出す。それ以外（失格が混ざる等）は理由を省く
function noRaceReason(t, rows) {
  const others = rows.filter((row) => row.mark !== "_");
  if (
    others.length === 0 ||
    !others.every((row) => FINISH_MARKS[row.mark]?.refund)
  ) {
    return null;
  }
  const groups = new Map();
  others.forEach((row) => {
    if (!groups.has(row.mark)) groups.set(row.mark, []);
    groups.get(row.mark).push(row.boat);
  });
  const separator = t("result.noRace.boatSeparator");
  const list = [...groups.entries()]
    .map(([mark, boats]) =>
      t(`result.noRace.group.${FINISH_MARKS[mark].key}`, {
        count: boats.length,
        boats: boats.join(separator),
      }),
    )
    .join(t("result.noRace.groupSeparator"));
  return t("result.noRace.reason", { list });
}

function CancelledResult({ t }) {
  return (
    <div className="race-result">
      <div className="result-empty-state">
        <h4>🏁 {t("result.title")}</h4>
        <div className="result-empty-icon">🚫</div>
        <p className="result-empty-title">{t("result.cancelledTitle")}</p>
        <p className="result-empty-body">{t("result.cancelledBody")}</p>
      </div>
    </div>
  );
}

function ResultHead({ result, isNoRace, isPartialRefund, noRaceReasonText, t }) {
  return (
    <>
      <div className="rr-head">
        <div className="rr-title">
          <h4>🏁 {isNoRace ? t("result.noRace.title") : t("result.title")}</h4>
          {isPartialRefund && (
            <span className="rr-refund-tag">
              {getRefundBoats(result).length > 0
                ? t("result.refundTag")
                : t("result.partialNoRaceTag")}
            </span>
          )}
        </div>
        {!isNoRace && result.winningTechnique && (
          <span className="rr-tag">
            {t("result.winningTechniqueLabel", {
              technique: translateTechnique(t, result.winningTechnique),
            })}
          </span>
        )}
      </div>
      {isNoRace && (
        <p className="rr-outcome-note">
          {noRaceReasonText
            ? t("result.noRace.bodyWithReason", { reason: noRaceReasonText })
            : t("result.noRace.body")}
        </p>
      )}
    </>
  );
}

function ResultSkeleton({ boatsInRace }) {
  return (
    <div className="rr-table-skeleton" aria-busy="true">
      {boatsInRace.map((boat) => (
        <div className="rr-skeleton-row" key={boat}>
          <span className="rr-skeleton-bar" />
        </div>
      ))}
    </div>
  );
}

// 表の下の注記（ST図の読み方・進入データなし・着順の欠け）
function ResultTableNotes({
  isLoadingStartTimings,
  isNoRace,
  info,
  rowCount,
  t,
}) {
  return (
    <>
      {/* ST図の読み方。初見では黄線が何か・どちらが早いかが分からない
          （BOA-559 ファン評価3周目） */}
      {info.validStartTimings.length > 0 && (
        <p className="rr-note rr-st-legend">{t("result.stLegend")}</p>
      )}
      {/* 以前は「進入コースは精度確認中のため表示していない」と出していた（BOA-238 の頃は
          進入の元データが無かった）。今は本番STの進入を出すので、データが無いレースだけ断る（BOA-625） */}
      {!isLoadingStartTimings && !isNoRace && info.courseOrder.length === 0 && (
        <p className="rr-note">{t("result.courseNoData")}</p>
      )}
      {!isLoadingStartTimings && !isNoRace && rowCount < 6 && (
        <p className="rr-note rr-note-missing-ranks">
          {t("result.missingRanksNote")}
        </p>
      )}
    </>
  );
}

// PC（1200px 以上）はスタート隊形を左、着順の表を右の2段（BOA-881）
function StartSplit({
  rows,
  players,
  boatsInRace,
  info,
  isNoRace,
  isLoadingStartTimings,
  startTimingFailed,
  onRetry,
  t,
}) {
  return (
    <div className="race-split">
      <div className="race-split__main">
        {!isLoadingStartTimings && info.formationRows && (
          // スタート隊形（コース順）の絵。結果の表の上（BOA-811、承認モック
          // docs/design/race-result-start-formation/mock）。進入の並びもこの絵で見る（前の「進入」の1行は外した）
          <RaceStartFormation rows={info.formationRows} />
        )}
      </div>
      <div className="race-split__side">
        {isLoadingStartTimings ? (
          <ResultSkeleton boatsInRace={boatsInRace} />
        ) : (
          <RaceResultTable
            rows={rows}
            players={players}
            startTimingByBoat={info.startTimingByBoat}
            fastestStartTiming={info.fastestStartTiming}
            isNoRace={isNoRace}
            t={t}
          />
        )}
        {startTimingFailed && <InlineFetchError onRetry={onRetry} />}
        <ResultTableNotes
          isLoadingStartTimings={isLoadingStartTimings}
          isNoRace={isNoRace}
          info={info}
          rowCount={rows.length}
          t={t}
        />
      </div>
    </div>
  );
}

// PC（1200px 以上）は払戻金を左、この日の水面傾向を右の2段（BOA-881）
function PayoutSplit({
  payoutInfo,
  raceId,
  raceStartTime,
  isNoRace,
  decision,
  parsedRaceId,
  t,
}) {
  const { payoutRowsToShow, partialVoid, hasFinalOddsPopularity } = payoutInfo;
  return (
    <div className="race-split">
      <div className="race-split__main">
        {payoutRowsToShow && (
          <RaceResultPayoutSection
            payoutRows={payoutRowsToShow}
            partialVoid={partialVoid}
            hasFinalOddsPopularity={hasFinalOddsPopularity}
            t={t}
          >
            <PayoutRowsTable rows={payoutRowsToShow} t={t} />
          </RaceResultPayoutSection>
        )}
        {/* 過去に発生した割合を見る の振り返り（BOA-635 spec FR-4）。不成立のレースでは出さない */}
        {raceId && !isNoRace && (
          <PastRateLayerGate raceId={raceId}>
            {(layer) => (
              <PastRateReview
                layer={layer}
                raceId={raceId}
                deadline={getDeadlineDate(raceId, raceStartTime)}
                decision={decision}
              />
            )}
          </PastRateLayerGate>
        )}
      </div>
      <div className="race-split__side">
        {/* この日の水面傾向（phase a FR-5 / BOA-222）。払戻の下＝結果タブの最下部。
            払戻が無い過去データでも出すため、払戻の条件ブロックの外に置く */}
        {parsedRaceId && (
          <VenueDaySummaryCard
            venueCode={parsedRaceId.venueCode}
            date={parsedRaceId.date}
            raceId={raceId}
          />
        )}
      </div>
    </div>
  );
}

function RaceResult({ prediction, raceId, raceStartTime = null }) {
  // 会場コードと開催日は raceId から導出する（propsを増やさない）
  const parsedRaceId = parseRaceId(raceId);
  const { t } = useTranslation();
  const result = prediction?.result;
  const finished = Boolean(result?.finished);
  const { startTimingState, finalOddsState, reload } = useRaceResultData(
    finished,
    raceId,
  );

  const isCurrentRace = startTimingState.raceId === raceId;
  const startTimings = isCurrentRace ? startTimingState.data : null;
  const startTimingFailed = isCurrentRace && startTimingState.failed;

  if (!prediction || !result || !finished) {
    return null;
  }

  // is_cancelled は現状どのスクリプトからも書き込まれていない（BOA-238調査時点）。中止は
  // races.cancellation_status の担当（isRaceCancelled）で、結果の行自体が無い。
  // 不成立は旧フラグ is_no_race（全行 false）ではなく raceStatus で判定する（BOA-543、下の isNoRace）
  if (result.isCancelled) {
    return <CancelledResult t={t} />;
  }

  const players = prediction.allPlayers ?? [];

  const outcome = getRaceOutcomeState(result);
  const isNoRace = outcome === RACE_OUTCOME.NO_RACE;
  // スタート情報（着欄の記号）を読み込んでいる間は、rank1〜 の並び（返還艇が混ざる）を
  // 一瞬でも着順として見せないよう、表の代わりにスケルトンを出す（BOA-543）
  // raceId が無いときは取得自体をしない（useEffect が早期 return する）ので、読み込み中にしない
  const isLoadingStartTimings = Boolean(raceId) && !isCurrentRace;

  // 統一結果テーブルの行（着／艇／選手名／ST／タイム）。バックフィルしていない過去データは
  // rank4以降が無いため、その場合は3行のみになる。返還艇の行も数に含める（BOA-543）
  const boatsInRace = players.length
    ? players.map((p) => p.number).sort((a, b) => a - b)
    : [1, 2, 3, 4, 5, 6];
  const rows = buildResultRows(result, startTimings, boatsInRace);
  const payoutInfo = derivePayoutInfo({
    result,
    outcome,
    startTimings,
    boatsInRace,
    finalOdds: finalOddsState.raceId === raceId ? finalOddsState.data : null,
  });

  return (
    <div className="race-result">
      <ResultHead
        result={result}
        isNoRace={isNoRace}
        isPartialRefund={outcome === RACE_OUTCOME.PARTIAL_REFUND}
        noRaceReasonText={isNoRace ? noRaceReason(t, rows) : null}
        t={t}
      />
      <StartSplit
        rows={rows}
        players={players}
        boatsInRace={boatsInRace}
        info={deriveStartTimingInfo(startTimings)}
        isNoRace={isNoRace}
        isLoadingStartTimings={isLoadingStartTimings}
        startTimingFailed={startTimingFailed}
        onRetry={reload}
        t={t}
      />
      <PayoutSplit
        payoutInfo={payoutInfo}
        raceId={raceId}
        raceStartTime={raceStartTime}
        isNoRace={isNoRace}
        decision={podiumDecision(rows)}
        parsedRaceId={parsedRaceId}
        t={t}
      />
    </div>
  );
}

export default RaceResult;
