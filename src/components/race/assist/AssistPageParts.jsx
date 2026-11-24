/**
 * 思考アシストのページの区画（ヘッダー・図の列・深掘り）。props はページの本体の袋（view）をそのまま受ける。
 * src/pages/ThinkingAssistPage.jsx から本文を変えずに移した（振る舞いは変えない）
 */
import { Link } from "react-router-dom";
import AssistHeader from "./AssistHeader";
import RoughCard from "./RoughCard";
import RaceLaneBoard from "./RaceLaneBoard";
import BetTypeTabs from "./BetTypeTabs";
import { FlowConclusion } from "./LensSummary";
import BoatDeepDive from "./BoatDeepDive";
import { isAnalogyFinderEnabled } from "../../../config/featureFlags";
import { ASSIST_COPY } from "../../../data/thinkingAssistCopy";
import { meetFormSearch } from "../meetFormTrend";
import { deepRunsOf } from "../../../pure/predictionAssistState";

export function AssistHeaderSection({
  race,
  data,
  raceId,
  oddsAt,
  dispatch,
  act,
  post,
  v16Status,
  partNotes,
  v16Off,
  absentKnown,
  rough,
  scope,
  lineup,
  today,
  roughStatus,
  inCautionMode,
}) {
  return (
    <AssistHeader
      race={race}
      venueCode={data.parsed?.venueCode}
      raceId={raceId}
      round={data.round}
      stage={data.stage}
      canPost={data.defaultStage === "post"}
      onStage={(stage) => dispatch({ type: "stage", stage })}
      oddsAt={oddsAt}
      oddsFinal={data.odds.data?.byType?.trifecta?.final === true}
      showSonar={isAnalogyFinderEnabled()}
      tidal={data.venueInfo.data?.tidal === true}
      onVenue={() => act({ type: "sheet", sheet: "venue" })}
    >
      {post && v16Status === "exhibition_reflecting" && (
        <p className="ta-note">{ASSIST_COPY.stateReflecting}</p>
      )}
      {partNotes.map((part) => (
        <p key={part} className="ta-note">
          {ASSIST_COPY.partFailed(part)}
        </p>
      ))}
      {v16Off ? (
        <p className="ta-note">
          {absentKnown ? ASSIST_COPY.stateAbsent : ASSIST_COPY.stateNotSaved}
        </p>
      ) : (
        <RoughCard
          rough={rough}
          scope={scope}
          lineup={lineup}
          classes={today?.classes ?? null}
          status={roughStatus}
          onOpen={() => act({ type: "sheet", sheet: "rough" })}
          inCautionMode={inCautionMode}
          raceId={raceId}
        />
      )}
    </AssistHeader>
  );
}

export function AssistFigColumn({
  state,
  summary,
  cancelled,
  betType,
  onBetType,
  model,
  racers,
  bets,
  oddsNote,
  act,
  dispatch,
  toggleBet,
  marks,
  onTarget,
  raceId,
  deepBoat,
}) {
  return (
    <div className="ta-split-fig">
      {/* 展開は結論（形の見立て・今日の展示）を図の上に（spec D-47 (3)） */}
      {state.lens === "flow" && <FlowConclusion m={summary.flow} />}
      {/* 1列の幅（〜1023px）では券種のタブを艇の行の上に置く。2列では右の列のタブを使う（CSS で出し分け。
            BOA-990 ファン評価3周目 P2、2026-10-27 オーナー「推奨通りで良い」） */}
      {state.lens === "bet" && !cancelled && (
        <div className="ta-bettype-top">
          <BetTypeTabs
            betType={betType.id}
            onBetType={(id) => onBetType(id, "tab")}
          />
        </div>
      )}
      {cancelled && state.lens === "bet" ? (
        // 中止のレースは買い目レンズにこの1行だけ（D-38）
        <p className="ta-status">{ASSIST_COPY.cancelled}</p>
      ) : (
        <RaceLaneBoard
          model={model}
          lensLabel={ASSIST_COPY.lenses[state.lens].label}
          racers={racers}
          deep={state.deep}
          bets={bets}
          oddsNote={oddsNote}
          onDeep={(boat) => act({ type: "deep", boat })}
          onMetric={(metric, boat) => act({ type: "metric", metric, boat })}
          onBack={() => dispatch({ type: "back" })}
          onBasis={(basis) => dispatch({ type: "stBasis", basis })}
          onToggleBet={toggleBet}
          // 軸・展開の印は v16 が無ければ材料が空なので出ない。機力のチルト・交換は DB の展示なので欠場でも出す
          marks={marks}
          target={state.target}
          onTarget={onTarget}
          // 2連の券種は3段目の候補を使わない（マークシートと同じく薄くして押せない。BOA-990 画面2・3）。
          // 連複は段の名前を「1艇目・2艇目・3艇目」に
          legs={betType.legs}
          ordered={betType.ordered}
          legUnusedNote={
            betType.legs < 3
              ? ASSIST_COPY.legUnused(
                  ASSIST_COPY.betTypeLabels[betType.id],
                  betType.ordered,
                )
              : null
          }
        />
      )}
      {/* 機力の差が今日だけか今節ずっとかを確かめる導線（BOA-885）。深掘り中の艇、無ければ1号艇 */}
      {state.lens === "power" && (
        <Link
          className="ta-link ta-meetform-link"
          to={`/race/${raceId}${meetFormSearch(deepBoat ?? 1)}`}
        >
          {ASSIST_COPY.meetFormLinkPower}
        </Link>
      )}
    </div>
  );
}

export function AssistDeepDive({
  state,
  deepBoat,
  racers,
  venueName,
  raceId,
  v16Off,
  today,
  post,
  finalRound,
  data,
  boatFacts,
  deepRunsReady,
  maintenanceRows,
  courseByBoat,
  act,
  dispatch,
}) {
  return (
    <BoatDeepDive
      key={`${deepBoat}:${state.deepNonce}`}
      boat={deepBoat}
      racer={racers[deepBoat - 1]}
      venue={venueName}
      raceId={raceId}
      today={v16Off ? null : today}
      post={post}
      finalRound={finalRound}
      round={data.round}
      scope={boatFacts[deepBoat - 1].scope}
      chips={boatFacts[deepBoat - 1].chips}
      runs={deepRunsOf(data, racers, deepBoat, deepRunsReady)}
      technique={
        data.technique.status === "ready"
          ? ((data.technique.data ?? []).find(
              (r) => r.boat_number === deepBoat,
            ) ?? null)
          : null
      }
      pretest={
        data.motor.status === "ready"
          ? ((data.motor.data?.rows ?? []).find(
              (r) => r.boat_number === deepBoat,
            ) ?? null)
          : null
      }
      weight={
        (maintenanceRows ?? []).find((r) => r.boat_number === deepBoat)
          ?.today_weight ?? null
      }
      course={courseByBoat?.[deepBoat - 1] ?? deepBoat}
      /* 展示進入が無いうちは艇番を枠なりのコースとみなす。画面に「枠なり想定」と出す */
      courseAssumed={courseByBoat?.[deepBoat - 1] == null}
      onMetric={(metric, boat) => act({ type: "metric", metric, boat })}
      openAll={state.deepAll}
      onClose={() => dispatch({ type: "closeDeep" })}
    />
  );
}
