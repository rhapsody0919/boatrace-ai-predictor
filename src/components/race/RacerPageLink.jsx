import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { racerPagePath } from "../../utils/racerPagePath";
import "./RacerPageLink.css";

/**
 * 開いた詳細・選んだ艇の詳細の上に置く「{選手名}の選手ページ ›」（BOA-879）。
 * 艇の行・チップは「押すと開く・選ぶ」のまま、行き先が変わらないようにリンクはこちらに分ける（ファン4人の議論、
 * docs/design/racer-links/fan-panel.md）。選手ページは ja 専用で、同じタブで移る（出走表のリンクと同じ）
 */
export default function RacerPageLink({ racerId, name }) {
  const { t } = useTranslation();
  if (!racerId) return null;
  return (
    <Link
      to={racerPagePath(racerId)}
      className="racer-page-detail-link"
      data-testid="racer-page-detail-link"
    >
      <span translate="no">{name?.replace(/\s+/g, "")}</span>
      {t("racerLink.pageSuffix")}
    </Link>
  );
}
