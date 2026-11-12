/**
 * PredictionPanel - AI予想結果セクション
 * App.jsx と RaceDetail.jsx で共通利用
 *
 * AI予想モデル大規模改修（2026-08-13）: 3モデル切替（standard/safeBet/upsetFocus）を廃止し、
 * unifiedモデル1本に統合。AiAnalysisSectionは展開予測パネル/イン崩れ指数バッジの2ブロック構成
 * （FR2/FR3）。
 * 3連単参考情報（FR4、TrifectaReferenceCard）はUX上のフィードバックにより2026-08-14に表示を廃止。
 * バックエンド生成（generate-unified-trifecta-reference.js/bet_recommendations）自体は
 * 将来のモデル評価用途で残置している
 *
 * 2026-08-14追記: AiAnalysisSection（展開予測パネル/イン崩れバッジ）は
 * 「これから何が起きそうか」を示す未来志向のUIのため、結果確定済みレースには表示しない
 * （結果と矛盾する見え方になるため）。過去レースの検証はレース結果パネル（RaceResult、
 * 複勝的中/展開予測的中の検証）が担う。unifiedモデルのデータが無い日付でAIデータ分析欄が
 * 空白のまま表示される問題も、未確定レースに限定することで実質的に解消される
 *
 * 2026-08-14再追記(複勝予想パネル撤去): 複勝予想の「実測回収率」バッジが、1レース1点分の
 * 投資額(100円)で2点(◎○)ぶんの的中を数える実行不可能な計算方式により約1.5倍に水増しされて
 * いたことが判明（実際に両方100円ずつ買った場合の真の回収率は92.4%、BOA-180）。的中率90%
 * 自体は正しい実測値だったが、ユーザー判断により複勝予想UI（本コンポーネント内のパネル・
 * ホームページのレースカード一覧プレビュー）を一式撤去した。データ取得基盤（複勝オッズ
 * スクレイピング等）は将来の再設計に備えて残置している
 *
 * 2026-09-15追記(日和スタイルのタブ構成、BOA-305〜312): レース詳細ページに
 * 「基本情報/モータ情報/結果」の3タブ（RaceTabs）を追加した。
 * - 基本情報タブ（RaceBasicInfoTab、BOA-306）はDataRaceTableとは別の切り口
 *   （会場/グレード/期間フィルタ×棒グラフ）のため重複ではなく併存する
 * - モータ情報タブ（BOA-308）は既存のEmbeddedAnalysisSection「モーター調子」を
 *   タブへ昇格したため、重複表示を避けるためアコーディオン版は撤去した
 * - 結果タブ（BOA-312）は従来PredictionSection側で常時表示していたRaceResultを
 *   タブへ移設した。「データで振り返る」（RaceReview）はユーザー判断により
 *   BOA-312で撤去済み（docs/reference/deprecated-terms.json参照）
 * 残り4タブ（枠別情報/今節成績/オッズ検索/オッズ一覧）はデータ未整備の
 * ため未実装（`docs/design/scraping-full-coverage/`待ち）
 *
 * 2026-09-16追記(直前情報タブ分離、BOA-304): DataRaceTable（基本情報、過去実績系）に
 * 混在していた「当日更新・レース前は未確定」の4指標（展示ST/展示タイム/チルト/
 * 調整重量）を「直前情報」タブへ分離した（RaceBeforeInfoTab、モータ情報と結果の間）。
 * レース前の長い時間帯にDataRaceTable全体が「未完成」に見える問題への対応。
 * あわせて表示欠落だった気象情報（race_conditions）も同タブに追加した
 *
 * 2026-09-16追記(「AI予想」独立タブ新設、BOA-346): 日和には無い龍神レーダー独自の
 * AI予想機能（展開予測カード/イン崩れ指数バッジ/出現パターン）を、常時表示エリアの
 * 折りたたみ（旧AiAnalysisSection）から「AI予想」タブ（基本情報の次）へ格上げした。
 * 確定済みレースの答え合わせロジック（旧RaceResult.jsxの
 * showVolatilityOutcome/isUpset）も同タブに統合したため、結果タブは着順・配当・
 * 決まり手のみのシンプルな内容になった。詳細はRaceAiPredictionTab.jsx参照
 *
 * 2026-09-16再追記(枠別情報タブ追加、BOA-307): 基本情報とモータ情報の間に
 * 「枠別情報」タブ（RaceWakuInfoTab）を追加した。選手を選んで枠番別
 * （1〜6）成績を見る棒グラフ＋直近10走ドリルダウン、決まり手傾向（全艇合算）
 * の2カード構成。既存のVenueTendencyPanel・AttackDefenseAnalysisとは
 * 見せ方の主語が異なるため併存させ、このタブがアクティブな間は他のタブと
 * 同様にshowPreRaceAnalysisTools側で非表示にする（詳細はRaceWakuInfoTab.jsx
 * 冒頭のコメント参照）
 *
 * 2026-09-16追記(オッズ一覧タブ追加、BOA-311): FR-4（オッズ全券種対応、
 * race_odds.trifecta_all/trio_all/exacta_all/quinella_all/wide_all）が
 * 本番稼働済みになったため、「直前情報」と「結果」の間に「オッズ一覧」タブ
 * （RaceOddsListTab）を追加した。券種タブ×全組み合わせの常時表示×オッズ
 * タップでの推移表示（日和のオッズ一覧に寄せた構成。詳細はコンポーネント
 * 冒頭コメント参照）。選手名表示のためplayersを渡す
 */
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useRaceData } from "../../hooks/useRaceData";
import { SONAR_RACE_TAB } from "../../utils/raceUrlState";
import { isInCautionEnabled } from "../../config/featureFlags";
import { useRaceWinnerCourse } from "../../hooks/useRaceWinnerCourse";
import PredictionLoadingOverlay from "./PredictionLoadingOverlay";
import { getRaceId } from "../../utils/raceId";
import { AI_COPY_PROMPT_TYPES } from "../../utils/aiCopyPrompts";
import { PredictionErrorView } from "./PredictionPanelBanners";
import { buildShareTitle } from "./PredictionPanelShareTitle";
import {
  buildOfficialUrl,
  deriveRaceFlags,
  resolveRaceDate,
} from "./PredictionPanelDerive";
import {
  useRaceUrlState,
  useSixBoatPeriod,
  useAiCopyToast,
  useTabRequests,
} from "./PredictionPanelState";
import { buildMainTabs } from "./PredictionPanelTabs";
import PredictionPanelBody from "./PredictionPanelBody";

// データ出走表・枠番傾向・分析ツール群（レース前の予想材料）を隠すタブ。
// 結果/直前情報/モータ情報/AI予想の各タブは、それぞれのタブ内で同種の情報を
// 独立して表示しているため二重表示を避けて隠す（BOA-305〜312フィードバック#7、
// 2026-09-16のユーザーフィードバックでモータ情報タブも対象に追加。同日、
// BOA-346でAI予想タブも同じ扱いに追加）。
// 今節タブも同じ扱い（2026-09-27ユーザー指摘）。6艇の得点率・着順・前検と
// 選んだ1艇の走りを出しており、下にデータ出走表・枠番傾向が続くと
// 同じ6艇の数字が二重に並ぶ。
// 名前付きの一覧にすることで、今後タブが増えても1行の追加で済む
const PRE_RACE_TOOLS_HIDDEN_TABS = [
  "result",
  "beforeInfo",
  "motor",
  "waku",
  "aiPrediction",
  SONAR_RACE_TAB,
  "oddsList",
  "meet",
];

function PredictionPanel({
  prediction,
  selectedRace,
  isAnalyzing,
  date,
  status,
}) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  // フックはearly returnより前で無条件に呼ぶ必要があるため、selectedRace未確定時は空オブジェクトを渡す
  const { venueCode, venueName } = useRaceData(selectedRace || {});
  const analysisRaceId = selectedRace ? getRaceId(selectedRace) : null;
  // バナー/インライン両方のAiCopyButtonで選択状態とトースト表示を共有する
  // （別々に持つと選択がずれる・トーストが同じ座標に重複表示されるため）
  const [aiCopyPromptType, setAiCopyPromptType] = useState(
    AI_COPY_PROMPT_TYPES.WIN,
  );
  // 結果タブ表示中はDataRaceTable/VenueTendencyPanel/分析ツールアコーディオン群
  // （いずれもレース前の予想材料）を隠す（BOA-305〜312フィードバック#7）。
  // 初期値はRaceTabsのdefaultTabIdと同じ判定にしておき、初回描画時に一瞬
  // 表示されてすぐ消える「ちらつき」を防ぐ
  const [activeMainTab, setActiveMainTab] = useState(() =>
    prediction?.result?.finished ? "result" : "basic",
  );
  const urlState = useRaceUrlState();
  const tabRequests = useTabRequests(navigate);
  const { sixBoatPeriod, setSixBoatPeriod } = useSixBoatPeriod(analysisRaceId);
  const aiCopy = useAiCopyToast({ analysisRaceId, t, i18n, navigate });
  // 結果確定後の共有文に使う、1着の艇の進入コース（早期 return より前に呼ぶ。フックの順序の規則）
  const winnerCourse = useRaceWinnerCourse(
    selectedRace?.id,
    Boolean(prediction?.result?.finished),
  );

  if (!prediction && !isAnalyzing) return null;

  // null check を一箇所に集約：ここで selectedRace の存在を確認
  // 以降のコードでは selectedRace が null でないことを前提とする
  if (!selectedRace) return null;

  const raceDate = resolveRaceDate(date, selectedRace);
  const flags = deriveRaceFlags(prediction, status);
  const inCautionShare = isInCautionEnabled();
  const shareTitle = buildShareTitle({
    isFinished: flags.isFinished,
    inCautionShare,
    venueName,
    selectedRace,
    raceDate,
    isCancelled: flags.isCancelled,
    prediction,
    winnerCourse,
    t,
  });

  // ローディング中
  if (isAnalyzing) {
    return <PredictionLoadingOverlay />;
  }

  // エラー
  if (prediction.error) {
    return (
      <PredictionErrorView
        prediction={prediction}
        isCancelled={flags.isCancelled}
        t={t}
      />
    );
  }

  const ctx = {
    ...urlState,
    ...tabRequests,
    ...aiCopy,
    ...flags,
    t,
    prediction,
    selectedRace,
    venueCode,
    venueName,
    analysisRaceId,
    sixBoatPeriod,
    setSixBoatPeriod,
    officialUrl: buildOfficialUrl(venueCode, raceDate, selectedRace),
    aiCopyPromptType,
    setAiCopyPromptType,
    setActiveMainTab,
    // activeMainTab未確定時（初回レンダー等）は従来通り表示する
    showPreRaceAnalysisTools:
      !PRE_RACE_TOOLS_HIDDEN_TABS.includes(activeMainTab),
    shareTitle,
    inCautionShare,
  };
  return <PredictionPanelBody c={{ ...ctx, tabs: buildMainTabs(ctx) }} />;
}

export default PredictionPanel;
