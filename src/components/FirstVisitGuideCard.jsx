import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import GuideVideoPlayer from "./GuideVideoPlayer";
import "./FirstVisitGuideCard.css";

export default function FirstVisitGuideCard() {
  const { i18n } = useTranslation();
  const [visible, setVisible] = useState(true);

  if (i18n.language !== "ja") return null;
  if (!visible) return null;

  return (
    <div className="first-visit-guide-card">
      <button
        type="button"
        className="first-visit-guide-card__close"
        onClick={() => setVisible(false)}
        aria-label="閉じる"
      >
        ×
      </button>
      <p className="first-visit-guide-card__title">👋 初めての方へ</p>
      <p className="first-visit-guide-card__body">
        龍神レーダーの使い方を30秒の動画でご紹介します。会場選びから分析の見方まで、これだけ見れば迷いません。
      </p>
      <GuideVideoPlayer
        videoSrc="/videos/onboarding-flow.mp4"
        posterSrc="/videos/onboarding-flow-poster.jpg"
      />
      <Link to="/how-to-use" className="first-visit-guide-card__link">
        もっと詳しい使い方ガイドを見る →
      </Link>
    </div>
  );
}
