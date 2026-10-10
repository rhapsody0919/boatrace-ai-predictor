import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../../../utils/analytics";
import { getTodayJST } from "../../../utils/dateUtils";
import {
  readRaceView,
  showNewBadge,
  writeRaceView,
} from "../../../utils/raceView";
import "./AssistViewSwitch.css";

/**
 * 上部の切り替え「出走表とタブ／思考アシスト」（BOA-430 PR6、spec D-22、承認モック mock/pr6-switch.html）。
 * レース詳細と思考アシストの同じ位置（サイトのヘッダーの直下）に置く。下線のタブ型で、選んだ方に ✓・太字・下線。
 * 押すと同じレースのもう一方へ移り（履歴は置き換え）、選んだ方をこの端末に残す。
 * 出すかどうか（フラグ・ja・tab/boat の指定）は呼ぶ側が決める
 * @param {{current: "race"|"assist", raceId: string}} props
 */
export default function AssistViewSwitch({ current, raceId }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [saved] = useState(readRaceView);
  const newBadge =
    current !== "assist" && showNewBadge({ saved, today: getTodayJST() });

  const go = (view) => {
    writeRaceView(view);
    if (view === current) return;
    // どちらへ移ったか（docs/design/thinking-assist/events.md）。押し直しは送らない
    trackEvent("assist_view_switch", { race_id: raceId, assist_view: view });
    navigate(view === "assist" ? `/race/${raceId}/assist` : `/race/${raceId}`, {
      replace: true,
    });
  };

  const button = (view, label) => (
    <button
      type="button"
      aria-pressed={current === view}
      onClick={() => go(view)}
    >
      {current === view && <span aria-hidden="true">✓</span>}
      {label}
      {view === "assist" && newBadge && (
        <span className="assist-view-switch__new">
          {t("raceDetailPage.assistSwitch.new")}
        </span>
      )}
    </button>
  );

  return (
    <div className="assist-view-switch">
      <div
        className="assist-view-switch__seg"
        role="group"
        aria-label={t("raceDetailPage.assistSwitch.label")}
      >
        {button("race", t("raceDetailPage.assistSwitch.raceCard"))}
        {button("assist", t("raceDetailPage.assistSwitch.assist"))}
      </div>
      {current === "race" && (
        <p className="assist-view-switch__note">
          {t("raceDetailPage.assistSwitch.note")}
        </p>
      )}
    </div>
  );
}
