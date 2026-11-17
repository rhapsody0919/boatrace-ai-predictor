/**
 * PredictionPanel のタブ定義（RaceTabs に渡す tabs 配列を組む）
 *
 * レース詳細ページのタブ構成（BOA-305〜307/312、並び順はBOA-454）。
 *
 * 並びは「粒度」で揃える。**6艇を横断して見るタブを前に → 選手1人を掘る
 * タブを後ろに → 買い目・結果を最後に**。390pxでは完全に見えるタブが4つ
 * しか無い（実測: 可視334px / 全体613px）ため、先頭4枠に何を置くかが
 * そのまま「開いて最初に何を見るか」になる。以前は
 * 基本情報→AI予想→枠別情報→モータ情報の順で、先頭4つが全部「過去の集計」
 * になっており、当日の情報（今節・直前情報）が両方とも画面外にあった。
 *
 * 狭い「今節」(51px)を3番目に置いたことで、5番目の枠別情報が
 * 288〜366pxと半分見える位置に来る（実測、可視334px）。半分見えているタブ自体が
 * 「右に続く」の手がかりになる（フェードや「›」より強い）。
 *
 * タブの統合（枠別情報＋モータ情報など）はしない。8→6にしても334pxに
 * 入るのは4つのままで、可視数が1つも増えないのに、統合後のタブが縦に
 * 長くなる（タブを跨ぐのは1タップだが、縦スクロールは何回もスワイプする）。
 */
import { RACE_SONAR_PARAM, SONAR_RACE_TAB } from "../../utils/raceUrlState";
import { isAnalogyFinderEnabled } from "../../config/featureFlags";
import AnalogyFinderSection from "./analogy/AnalogyFinderSection";
import MotorConditionChart from "../analysis/MotorConditionChart";
import RaceBasicInfoTab from "./RaceBasicInfoTab";
import RaceWakuInfoTab from "./RaceWakuInfoTab";
import RaceMeetTab from "./RaceMeetTab";
import RaceBeforeInfoTab from "./RaceBeforeInfoTab";
import RaceAiPredictionTab from "./RaceAiPredictionTab";
import RaceOddsListTab from "./RaceOddsListTab";
import RaceResult from "./RaceResult";

// 龍神ソナー（BOA-271）。AI予想タブの下から独立したタブにした（2026-10-08 ユーザー決定、
// 承認モック docs/design/analogy-finder/mock/APPROVED.md）。位置は基本情報と AI予想の間。
// 公開は機能フラグで切り替える（隠している間はタブごと出さないので API も呼ばない）
function sonarTabs(c) {
  if (!isAnalogyFinderEnabled()) return [];
  return [
    {
      id: SONAR_RACE_TAB,
      label: c.t("raceTabs.sonar"),
      content: (
        <AnalogyFinderSection
          key={c.analysisRaceId}
          raceId={c.analysisRaceId}
          players={c.prediction.allPlayers}
          onOpenMeetForm={c.openMeetForm}
          initialTab={c.sonarInitialTab}
        />
      ),
    },
  ];
}

// 日和には無い龍神レーダー独自の差別化要素。6艇横断で読むものでも
// あるため前半に置く
function raceGradeOf(prediction, selectedRace) {
  return (
    prediction?.raceGrade ??
    selectedRace?.rawData?.raceGrade ??
    selectedRace?.raceGrade ??
    null
  );
}

function aiPredictionTab(c) {
  const { prediction, selectedRace } = c;
  const sonarOn = isAnalogyFinderEnabled();
  const openSonar = () =>
    c.setTabRequest((r) => ({
      id: SONAR_RACE_TAB,
      seq: (r?.seq ?? 0) + 1,
    }));
  return {
    id: "aiPrediction",
    label: c.t("raceTabs.aiPrediction"),
    content: (
      <RaceAiPredictionTab
        prediction={prediction}
        venueCode={c.venueCode}
        venueName={c.venueName}
        raceId={c.analysisRaceId}
        raceStartTime={selectedRace?.startTime}
        raceGrade={raceGradeOf(prediction, selectedRace)}
        raceStage={
          prediction?.raceStage ?? selectedRace?.rawData?.raceStage ?? null
        }
        isCancelled={c.isCancelled}
        onOpenSonar={sonarOn ? openSonar : null}
        // イン崩れ注意度のカード（BOA-822）の「類似レース400件で見ると？」は類似レースの副タブで開く。
        // ソナーの節は開いたときに ?sonar= を1回だけ読む（非表示のタブはアンマウントされる）
        onOpenSonarSimilar={
          sonarOn
            ? () => {
                c.setSonarInitialTab("similar");
                c.setRaceParam(RACE_SONAR_PARAM, "similar");
                openSonar();
              }
            : null
        }
      />
    ),
  };
}

// 勝負駆けは「この6人の中で誰が一番欲しがっているか」でしか読めない。
// レースを開いたら最初に見るものなので前半に置く（日和はモータ情報の
// 隣に置いているが、日和に位置を合わせるより粒度で揃える方を採った）
function meetTab(c) {
  return {
    id: "meet",
    label: c.t("raceTabs.meet"),
    content: (
      <RaceMeetTab
        focusedBoat={c.focusedBoat}
        onFocusBoat={c.handleFocusBoat}
        raceId={c.analysisRaceId}
        venueCode={c.venueCode}
        players={c.prediction.allPlayers}
        isCancelled={c.isCancelled}
      />
    ),
  };
}

// 展示タイムは締切前に最も判断へ効く。レースの状況（朝は未確定、
// 直前で埋まる）で並びを動かすと位置が覚えられなくなるため、
// 順番は固定したまま4番目に置く
function beforeInfoTab(c) {
  const { prediction, selectedRace } = c;
  return {
    id: "beforeInfo",
    label: c.t("raceTabs.beforeInfo"),
    content: (
      <RaceBeforeInfoTab
        focusedBoat={c.focusedBoat}
        onFocusBoat={c.handleFocusBoat}
        raceId={c.analysisRaceId}
        venueCode={c.venueCode}
        players={prediction.allPlayers}
        weather={prediction.weather}
        raceGrade={
          selectedRace?.rawData?.raceGrade ?? selectedRace?.raceGrade ?? null
        }
        isFinished={c.isFinished}
      />
    ),
  };
}

// 結果タブは決着後にしか中身が無い。未確定レースでは
// 「まだ確定していません」という空タブを出すだけで、押した人にとっては
// 何も得るものが無いうえ、狭いタブバーの枠を1つ占める。確定したら
// 現れ、そのまま既定タブになる（defaultTabId）
function resultTabs(c) {
  if (!c.isFinished) return [];
  return [
    {
      id: "result",
      label: c.t("raceTabs.result"),
      content: (
        <RaceResult
          prediction={c.prediction}
          raceId={c.analysisRaceId}
          raceStartTime={c.selectedRace?.startTime}
        />
      ),
    },
  ];
}

// ここから下は「艇を1つ選んで掘る」タブ
function deepDiveTabs(c) {
  return [
    {
      id: "waku",
      label: c.t("raceTabs.waku"),
      content: (
        <RaceWakuInfoTab
          focusedBoat={c.focusedBoat}
          onFocusBoat={c.handleFocusBoat}
          venueCode={c.venueCode}
          players={c.prediction.allPlayers}
          raceId={c.analysisRaceId}
          sixBoatPeriod={c.sixBoatPeriod}
          onSixBoatPeriodChange={c.setSixBoatPeriod}
        />
      ),
    },
    {
      id: "motor",
      label: c.t("raceTabs.motor"),
      content: (
        <MotorConditionChart
          embedded
          initialVenueCode={c.venueCode}
          initialRaceId={c.analysisRaceId}
          focusedBoat={c.focusedBoat}
          onFocusBoat={c.handleFocusBoat}
        />
      ),
    },
    {
      id: "oddsList",
      label: c.t("raceTabs.oddsList"),
      content: (
        <RaceOddsListTab
          raceId={c.analysisRaceId}
          raceStartTime={c.selectedRace?.startTime}
          players={c.prediction.allPlayers}
        />
      ),
    },
  ];
}

export function buildMainTabs(c) {
  return [
    {
      id: "basic",
      label: c.t("raceTabs.basic"),
      content: (
        <RaceBasicInfoTab
          focusedBoat={c.focusedBoat}
          onFocusBoat={c.handleFocusBoat}
          raceId={c.analysisRaceId}
          venueCode={c.venueCode}
          players={c.prediction.allPlayers}
        />
      ),
    },
    ...sonarTabs(c),
    aiPredictionTab(c),
    meetTab(c),
    beforeInfoTab(c),
    ...deepDiveTabs(c),
    // 結果タブは oddsList の後ろ（末尾）
    ...resultTabs(c),
  ];
}
