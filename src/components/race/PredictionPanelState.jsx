/**
 * PredictionPanel の状態フック（URL の艇・タブ、枠別情報の期間、AI用コピーのトースト）
 */
import { useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import {
  RACE_BOAT_PARAM,
  RACE_TAB_PARAM,
  parseBoatParam,
} from "../../utils/raceUrlState";
import { MEET_FORM_ANCHOR } from "./meetFormTrend";
import { isThinkingAssistEnabled } from "../../config/featureFlags";
import { useToast } from "../Toast";
import { trackEvent } from "../../utils/analytics";

/**
 * 「今どの艇を見ているか」を基本情報・枠別情報・今節・モータ情報の4タブで共有する（BOA-492、モータ情報は BOA-494）。
 * 各タブが自前で持っていた頃は、基本情報で4号艇を開いてから枠別へ移ると1号艇に
 * 戻って選び直しが要った。RaceTabsは非アクティブタブをアンマウントするため、
 * 枠別→今節→枠別と戻っただけでも消えていた。
 * null は「まだどの艇も選んでいない」。基本情報タブは null なら何も展開せず、
 * 枠別・今節は null なら従来どおり1号艇にフォールバックする（初回表示は3タブとも
 * 現状のまま変わらない）。モータ情報は一覧のまま選んだ艇の行を示し、ドリルダウンは
 * 自動で開かない（BOA-494 案A。一覧が主役）
 *
 * 選択は URL の ?boat=（タブは ?tab=）に置く（BOA-493）。選ぶたびに history.replace で
 * 書き戻すので、アドレスバーのコピーや共有シートで送ったリンクが同じ艇・タブで開く。
 * レースが変われば選択は無効（次のレースの4号艇は別人）だが、前後のレースへのリンクは
 * クエリの無い /race/:raceId なので、移動すれば自然に消える
 */
export function useRaceUrlState() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { pathname, search } = useLocation();
  const focusedBoat = parseBoatParam(searchParams.get(RACE_BOAT_PARAM));
  // 値が変わるときだけ書き戻す（同じ値で navigate しない）。push ではなく replace にして、
  // 戻るボタンが艇・タブの選択を1つずつ巻き戻さないようにする
  //
  // 土台は描画時点の searchParams ではなく、その時点の実際の URL（window.location.search）。
  // react-router の setSearchParams は関数形式でも描画時点の値を渡すため、艇を押した直後
  // （書き戻しが画面に反映される前）にタブを押すと、古い値を土台にして boat を消していた
  const setRaceParam = (key, value) => {
    const next = value == null ? null : String(value);
    const params = new URLSearchParams(window.location.search);
    if (params.get(key) === next) return;
    if (next == null) params.delete(key);
    else params.set(key, next);
    setSearchParams(params, { replace: true });
  };
  const handleFocusBoat = (boat) => setRaceParam(RACE_BOAT_PARAM, boat);
  return {
    searchParams,
    pathname,
    search,
    focusedBoat,
    setRaceParam,
    handleFocusBoat,
  };
}

/**
 * 枠別情報タブの6艇の表の期間（直近3期／当地、BOA-1294）。RaceTabs は非アクティブなタブを
 * アンマウントするので、タブを移っても選んだ期間が残るようここで持つ。URL・保存には置かない
 * レースが変われば既定（直近3期）に戻す（選んだレースとセットで持つ）
 */
export function useSixBoatPeriod(analysisRaceId) {
  const [sixBoatPeriodState, setSixBoatPeriodState] = useState(null);
  const sixBoatPeriod =
    sixBoatPeriodState?.raceId === analysisRaceId
      ? sixBoatPeriodState.period
      : "recent3";
  const setSixBoatPeriod = (period) =>
    setSixBoatPeriodState({ raceId: analysisRaceId, period });
  return { sixBoatPeriod, setSixBoatPeriod };
}

/**
 * AI用にコピーした直後のトーストに、思考アシストへの1行を足す（BOA-832、2026-10-11 ユーザー選択）。
 * 6秒出し、マウスを重ねている間・フォーカスがある間は消さない。ja・フラグありのとき。
 * 移っても表示の選択は残さない（上部の切り替えとは違う）。履歴に積むので戻るでレース詳細へ
 */
export function useAiCopyToast({ analysisRaceId, t, i18n, navigate }) {
  const {
    toast: aiCopyToast,
    showToast: showAiCopyToast,
    hide: hideAiCopyToast,
    hold: holdAiCopyToast,
    release: releaseAiCopyToast,
  } = useToast();
  const handleAiCopy = (message, type) => {
    const raceIdForAssist = analysisRaceId;
    if (
      type !== "success" ||
      !raceIdForAssist ||
      !isThinkingAssistEnabled() ||
      i18n.resolvedLanguage !== "ja"
    ) {
      showAiCopyToast(message, type);
      return;
    }
    showAiCopyToast(message, type, {
      duration: 6000,
      action: {
        label: t("aiCopy.toastAssist"),
        onClick: () => {
          hideAiCopyToast();
          trackEvent("assist_view_switch", {
            race_id: raceIdForAssist,
            assist_view: "assist",
            assist_entry: "copy_toast",
          });
          navigate(`/race/${raceIdForAssist}/assist`);
        },
      },
    });
  };
  return {
    aiCopyToast,
    hideAiCopyToast,
    holdAiCopyToast,
    releaseAiCopyToast,
    handleAiCopy,
  };
}

/**
 * ほかのタブの中からタブを切り替える依頼（AI予想タブの「龍神ソナーのタブへ」）。
 * RaceTabs は選択を自分で持つので、seq を増やして同じタブへの依頼も届くようにする
 *
 * 龍神ソナーの展開シナリオから、攻める艇の今節の足（直前情報タブのカード）へ（BOA-885）。
 * 艇・タブ・カードの位置（#meet-form-trend）を1回の書き換えで URL に置き、タブを切り替える。
 * setSearchParams は # を落とすので navigate で書く。カードは出たときに # を見て下がる
 *
 * イン崩れ注意度のカードから龍神ソナーの類似レースへ（BOA-822）。ソナーの節は ?sonar= を最初の描画で読むが、
 * URL の更新はタブの切り替えより遅れて届くので、最初に開く副タブは prop で渡す（ファン評価1周目）
 */
export function useTabRequests(navigate) {
  const [tabRequest, setTabRequest] = useState(null);
  const [sonarInitialTab, setSonarInitialTab] = useState(null);
  const openMeetForm = (boat) => {
    const params = new URLSearchParams(window.location.search);
    params.set(RACE_TAB_PARAM, "beforeInfo");
    params.set(RACE_BOAT_PARAM, String(boat));
    navigate(
      { search: `?${params.toString()}`, hash: MEET_FORM_ANCHOR },
      { replace: true },
    );
    setTabRequest((r) => ({ id: "beforeInfo", seq: (r?.seq ?? 0) + 1 }));
  };
  return {
    tabRequest,
    setTabRequest,
    sonarInitialTab,
    setSonarInitialTab,
    openMeetForm,
  };
}
