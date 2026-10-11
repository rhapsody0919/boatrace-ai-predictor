import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../../../utils/analytics";
import { isThinkingAssistEnabled } from "../../../config/featureFlags";
import "./AssistEntryRow.css";

/**
 * タブ列のすぐ上の1行「材料を順に見るなら 思考アシスト ›」（BOA-832、2026-10-11 ユーザー選択）。
 * 上部の切り替えだけでは気づかれなかったので、レース詳細を読み進めた位置にも入口を置く。
 * タブの数を減らさず、どのタブを開いていても見える（タブ列の先頭の札は、375px で見えるタブが4つ→2つになり、
 * 結果が出たレースでは列が流れて画面の外に出るので採らなかった）。
 * - 押しても表示の選択（readRaceView）は残さない。履歴に積んで移る（戻るでレース詳細へ）
 * - 出すのはフラグがあり ja のとき。結果が出たレース・tab や boat を指定した URL でも出す
 * @param {{raceId: string}} props
 */
export default function AssistEntryRow({ raceId }) {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  if (!raceId || !isThinkingAssistEnabled() || i18n.resolvedLanguage !== "ja")
    return null;
  const go = () => {
    // どの入口から移ったか（docs/design/thinking-assist/events.md）
    trackEvent("assist_view_switch", {
      race_id: raceId,
      assist_view: "assist",
      assist_entry: "tab_row",
    });
    navigate(`/race/${raceId}/assist`);
  };
  return (
    <button type="button" className="assist-entry-row" onClick={go}>
      <span>{t("raceDetailPage.assistEntry.lead")}</span>
      <b>{t("raceDetailPage.assistSwitch.assist")}</b>
      <span className="assist-entry-row__arrow" aria-hidden="true">
        ›
      </span>
    </button>
  );
}
