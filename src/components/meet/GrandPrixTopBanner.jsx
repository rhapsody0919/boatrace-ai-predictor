import { Link } from "react-router-dom";
import { EDITION } from "../../data/grandPrixFeature.js";
import { grandPrixPhase } from "../../pure/grandPrixPhase.js";
import { getTodayJST } from "../../utils/dateUtils";
import "../race/SgNowBanner.css";

/**
 * トップの「グランプリ特集」の帯（BOA-1724）。開幕前は開幕までの日数、開催中は日目を出し、終わったら出さない。
 * 見た目は「SG開催中」の帯（SgNowBanner）と同じ。遷移先の /grandprix は ja 専用なので、呼び手が ja のときだけ置く
 */
export default function GrandPrixTopBanner() {
  const p = grandPrixPhase(getTodayJST(), EDITION);
  if (p.phase === "after") return null;
  // i18n-allow-start: ja のときだけ出す導線（遷移先が ja専用ページ）
  return (
    <div className="sg-now-banner" role="region" aria-label="グランプリ特集">
      <Link to="/grandprix" className="sg-now-banner__link">
        <span className="sg-now-banner__grade" style={{ backgroundColor: "var(--color-grade-sg)" }}>
          SG
        </span>
        <span className="sg-now-banner__text">
          {p.phase === "before" ? `グランプリ特集（${EDITION.venueName}）` : `グランプリ開催中（${EDITION.venueName}）`}{" "}
          <span style={{ whiteSpace: "nowrap" }}>
            {p.phase === "before" ? `開幕まで${p.days}日` : `${p.day}日目`}
          </span>
        </span>
        <span className="sg-now-banner__cta">特集を見る →</span>
      </Link>
    </div>
  );
  // i18n-allow-end
}
