import { useTranslation } from "react-i18next";
import "./InCautionBadge.css";

/**
 * イン崩れ注意度の段の札（BOA-822、screens S-1・S-2・S-3）。崩れやすい（!・薄い橙）／中くらい（色なし・枠線だけ）／
 * 堅め（薄い緑）。真ん中の段を出さないと「値が無い」と同じ見た目になるので、枠線で出す（承認）。
 * 段は保存した level をそのまま使い、画面で閾値をかけ直さない（plan §1）。
 *
 * @param {{level: "low"|"mid"|"high", pct?: number|null}} props pct を渡すと札の中に割合も出す（一覧）
 */
export default function InCautionBadge({ level, pct = null }) {
  const { t } = useTranslation();
  if (!["low", "mid", "high"].includes(level)) return null;
  return (
    <span className={`in-caution-badge in-caution-badge--${level}`}>
      {/* ▲は予想の印（単穴）に読まれるので、印と重ならない「!」（2026-10-18 オーナー決定）。色だけに頼らない区別は残す */}
      {level === "high" && <span aria-hidden="true">!</span>}
      {t(`inCaution.level.${level}`)}
      {pct !== null && <span className="in-caution-badge-pct"> {pct}%</span>}
    </span>
  );
}
