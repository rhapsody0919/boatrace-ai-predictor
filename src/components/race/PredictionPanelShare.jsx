/**
 * PredictionPanel の共有文・SNSシェアボタン・会場攻略ガイドリンク
 */
import { Link } from "react-router-dom";
import { SocialShareButtons } from "../SocialShareButtons";
import { shareUrlFor } from "../../utils/share";
import { getVenueGuidePath } from "../../utils/venueUtils";

function shareHashtags(isFinished, isCancelled, inCautionShare) {
  if (isFinished) return ["ボートレース", "展開予測", "龍神レーダー"];
  // 中止のレースは予想を出さないので「AI予想」のタグを外す。注意度の文面も本命・推奨を書かないので外す
  return isCancelled || inCautionShare
    ? ["ボートレース", "龍神レーダー"]
    : ["ボートレース", "AI予想", "龍神レーダー"];
}

/** SNSシェアボタン（結果確定後で、展開予測の候補がどれも1着でなければ出さない。BOA-754） */
export function ShareSection({
  shareTitle,
  pathname,
  search,
  analysisRaceId,
  isFinished,
  isCancelled,
  inCautionShare,
}) {
  if (!shareTitle) return null;
  return (
    <div className="social-share-wrapper">
      <SocialShareButtons
        // 今見ているレース（言語・選んだタブ・艇込み）を共有する（BOA-691）
        shareUrl={shareUrlFor(`${pathname}${search}`)}
        title={shareTitle}
        raceId={analysisRaceId}
        shareKind={isFinished ? "result" : "prediction"}
        hashtags={shareHashtags(isFinished, isCancelled, inCautionShare)}
        size={40}
      />
    </div>
  );
}

/** 会場攻略ガイドリンク */
export function VenueGuideLink({ venueCode, venueName, t }) {
  if (!venueCode || !getVenueGuidePath(venueCode)) return null;
  return (
    <div className="venue-guide-link">
      <Link to={getVenueGuidePath(venueCode)}>
        <span className="venue-guide-icon">&#x1F4D6;</span>
        <div className="venue-guide-content">
          <span className="venue-guide-title">
            {t("panel.venueGuideLink", {
              venue: venueCode
                ? t(`venues.${venueCode}`, venueName)
                : venueName,
            })}
          </span>
          <span className="venue-guide-desc">{t("panel.venueGuideDesc")}</span>
        </div>
        <span className="venue-guide-arrow">&rarr;</span>
      </Link>
    </div>
  );
}
