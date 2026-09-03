import { Composition } from "remotion";
import { AshiyaCM, AmagasakiCM } from "./AshiyaCM.jsx";
import { YoungPersonaCM } from "./YoungPersonaCM.jsx";
import { HitCheckCM } from "./HitCheckCM.jsx";
import { ToolShowcaseCM } from "./ToolShowcaseCM.jsx";
import { RivalryCM } from "./RivalryCM.jsx";
import { TriviaCM } from "./TriviaCM.jsx";
import {
  MascotCM_A,
  MascotCM_A2,
  MascotCM_A3,
  MascotCM_B,
  MascotCM_B2,
  MascotCM_B3,
  MascotCM_C,
  MascotCM_C2,
  MascotCM_C3,
} from "./MascotCM.jsx";
import { ToolCM_A } from "./ToolCM.jsx";
import { ToolTallyCM } from "./ToolTallyCM.jsx";
import { LivePredictionCM_A } from "./LivePredictionCM.jsx";
import {
  VenueRankingCM,
  VenueRankingCM_EN,
  VenueRankingCM_Manshu,
  VenueRankingCM_Manshu_EN,
  VenueRankingCM_Manshu_EN_VariantB,
  VenueRankingCM_WinRate,
  VenueRankingCM_WinRate_VariantB,
  VenueRankingCM_Motor2Rate,
  VenueRankingCM_TopStart,
  VenueRankingCM_TopStart_EN,
  VenueRankingCM_ExTime,
  VenueRankingCM_EdogawaLosing,
  VenueRankingCM_Top3Rate,
  BoatRankingCM_PlaceReturn,
  BoatRankingCM_RunnerUp,
  BoatRankingCM_TechniqueShare,
  BoatRankingCM_NarutoNigeWin,
  BoatRankingCM_TechniqueConsistency,
} from "./VenueRankingCM.jsx";
import { KimariteCM_B } from "./KimariteCM.jsx";
import { LivePredictionCM_B } from "./LivePredictionCM2.jsx";
import { LivePredictionCM_TikTok } from "./LivePredictionCM_TikTok.jsx";
import { LivePredictionHookCM_Demo } from "./LivePredictionHookCM.jsx";
import { AnswerCheckHookCM_Demo } from "./AnswerCheckHookCM.jsx";
import { AccuracyProofCM_C } from "./AccuracyProofCM.jsx";
import { LivePredictionCM_C } from "./LivePredictionCM3.jsx";
import { TodaysRacerFormCM } from "./TodaysRacerFormCM.jsx";
import { TodaysMotorFormCM } from "./TodaysMotorFormCM.jsx";
import { OutcomeDistributionCM } from "./OutcomeDistributionCM.jsx";
import { ReturnRateCM } from "./ReturnRateCM.jsx";
import { NoteExplainerCM_DataRaceTable } from "./NoteExplainerCM.jsx";
import { NoteExplainerCM_ReturnRate } from "./NoteExplainerReturnRate.jsx";
import { NoteExplainerCM_FormRanking } from "./NoteExplainerFormRanking.jsx";
import { NoteExplainerCM_LanguageSwitcher } from "./NoteExplainerLanguageSwitcher.jsx";
import { LanguageSwitcherCM } from "./LanguageSwitcherCM.jsx";
import { DataQuoteCard } from "./DataQuoteCard.jsx";
import {
  YoutubeChannelAvatar,
  YoutubeChannelBanner,
} from "./YoutubeChannelBranding.jsx";
import {
  TechniqueConsistencyCM,
  TECHNIQUE_CONSISTENCY_DURATION,
} from "./TechniqueConsistencyCM.jsx";
import { RaceInsightYoutubeTemplate } from "./RaceInsightYoutubeCM.jsx";

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="AmagasakiCM"
        component={AmagasakiCM}
        durationInFrames={330}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="BoatRankingCM-PlaceReturn"
        component={BoatRankingCM_PlaceReturn}
        durationInFrames={413}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="BoatRankingCM-RunnerUp"
        component={BoatRankingCM_RunnerUp}
        durationInFrames={413}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="BoatRankingCM-TechniqueShare"
        component={BoatRankingCM_TechniqueShare}
        durationInFrames={413}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="BoatRankingCM-NarutoNigeWin"
        component={BoatRankingCM_NarutoNigeWin}
        durationInFrames={413}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="BoatRankingCM-TechniqueConsistency"
        component={BoatRankingCM_TechniqueConsistency}
        durationInFrames={601}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="AshiyaCM"
        component={AshiyaCM}
        durationInFrames={330}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="YoungPersonaCM"
        component={YoungPersonaCM}
        durationInFrames={390}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="HitCheckCM"
        component={HitCheckCM}
        durationInFrames={390}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="ToolShowcaseCM"
        component={ToolShowcaseCM}
        durationInFrames={390}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="RivalryCM"
        component={RivalryCM}
        durationInFrames={390}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="TriviaCM"
        component={TriviaCM}
        durationInFrames={420}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MascotCM-A"
        component={MascotCM_A}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MascotCM-B"
        component={MascotCM_B}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MascotCM-C"
        component={MascotCM_C}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MascotCM-A2"
        component={MascotCM_A2}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MascotCM-A3"
        component={MascotCM_A3}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MascotCM-B2"
        component={MascotCM_B2}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MascotCM-B3"
        component={MascotCM_B3}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MascotCM-C2"
        component={MascotCM_C2}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="MascotCM-C3"
        component={MascotCM_C3}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="ToolCM-A"
        component={ToolCM_A}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="ToolTallyCM"
        component={ToolTallyCM}
        durationInFrames={420}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="LivePredictionCM-A"
        component={LivePredictionCM_A}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM"
        component={VenueRankingCM}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-EN"
        component={VenueRankingCM_EN}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-Manshu"
        component={VenueRankingCM_Manshu}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-Manshu-EN"
        component={VenueRankingCM_Manshu_EN}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-Manshu-EN-VariantB"
        component={VenueRankingCM_Manshu_EN_VariantB}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-WinRate"
        component={VenueRankingCM_WinRate}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-WinRate-VariantB"
        component={VenueRankingCM_WinRate_VariantB}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-Motor2Rate"
        component={VenueRankingCM_Motor2Rate}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-TopStart"
        component={VenueRankingCM_TopStart}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-TopStart-EN"
        component={VenueRankingCM_TopStart_EN}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-ExTime"
        component={VenueRankingCM_ExTime}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-EdogawaLosing"
        component={VenueRankingCM_EdogawaLosing}
        durationInFrames={413}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="VenueRankingCM-Top3Rate"
        component={VenueRankingCM_Top3Rate}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="KimariteCM-B"
        component={KimariteCM_B}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="LivePredictionCM-B"
        component={LivePredictionCM_B}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="LivePredictionCM-TikTok"
        component={LivePredictionCM_TikTok}
        durationInFrames={475}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="LivePredictionHookCM-Demo"
        component={LivePredictionHookCM_Demo}
        durationInFrames={505}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="AnswerCheckHookCM-Demo"
        component={AnswerCheckHookCM_Demo}
        durationInFrames={610}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="AccuracyProofCM-C"
        component={AccuracyProofCM_C}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="LivePredictionCM-C"
        component={LivePredictionCM_C}
        durationInFrames={425}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="TodaysRacerFormCM"
        component={TodaysRacerFormCM}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="TodaysMotorFormCM"
        component={TodaysMotorFormCM}
        durationInFrames={600}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="OutcomeDistributionCM"
        component={OutcomeDistributionCM}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="ReturnRateCM"
        component={ReturnRateCM}
        durationInFrames={450}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="NoteExplainerCM-DataRaceTable"
        component={NoteExplainerCM_DataRaceTable}
        durationInFrames={1500}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="NoteExplainerCM-ReturnRate"
        component={NoteExplainerCM_ReturnRate}
        durationInFrames={1100}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="NoteExplainerCM-FormRanking"
        component={NoteExplainerCM_FormRanking}
        durationInFrames={1500}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="LanguageSwitcherCM"
        component={LanguageSwitcherCM}
        durationInFrames={430}
        fps={30}
        width={1080}
        height={1920}
      />
      <Composition
        id="NoteExplainerCM-LanguageSwitcher"
        component={NoteExplainerCM_LanguageSwitcher}
        durationInFrames={900}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="DataQuoteCard-Cover"
        component={DataQuoteCard}
        durationInFrames={1}
        fps={30}
        width={1200}
        height={630}
        defaultProps={{
          headline: "サンプル見出し",
          statValue: "",
          statLabel: "",
          caption: "",
        }}
      />
      <Composition
        id="DataQuoteCard-YouTubeThumbnail"
        component={DataQuoteCard}
        durationInFrames={1}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{
          headline: "サンプル見出し",
          statValue: "",
          statLabel: "",
          caption: "",
        }}
      />
      <Composition
        id="YoutubeChannelAvatar"
        component={YoutubeChannelAvatar}
        durationInFrames={1}
        fps={30}
        width={800}
        height={800}
      />
      <Composition
        id="YoutubeChannelBanner"
        component={YoutubeChannelBanner}
        durationInFrames={1}
        fps={30}
        width={2560}
        height={1440}
      />
      <Composition
        id="TechniqueConsistencyCM"
        component={TechniqueConsistencyCM}
        durationInFrames={TECHNIQUE_CONSISTENCY_DURATION}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="RaceInsightYoutubeCM"
        component={RaceInsightYoutubeTemplate}
        durationInFrames={600}
        fps={30}
        width={1920}
        height={1080}
        defaultProps={{
          venue: "住之江",
          raceNumber: 6,
          raceDate: "9/3",
          indexPercent: 100,
          boatWinRate: "2.61",
          nigePercent: 33,
          reasons: [
            "1号艇の全国勝率が非常に低い（2.61）→ イン崩れリスク高",
            "1号艇の今節STが遅い（平均0.190秒）→ イン崩れリスク",
          ],
          patterns: [
            { winnerCourse: 1, technique: "nige", probability: 0.33 },
            { winnerCourse: 3, technique: "makurizashi", probability: 0.1 },
            { winnerCourse: 5, technique: "makurizashi", probability: 0.08 },
          ],
          featureDigest: ["AI予想", "イン崩れ指数", "無料"],
        }}
      />
    </>
  );
}
