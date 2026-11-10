import { useTranslation } from "react-i18next";
import FavoriteStarButton from "../common/FavoriteStarButton.jsx";
import "./RacerProfileHeader.css";
import { formatRacerKana } from "../../utils/racerName";
import { RACER_FRONT_TAKING_ID } from "./RacerFrontTaking";

// 札を押すと前付けの説明へ移る。「動きを減らす」設定のときはスクロールを滑らかにしない
function scrollToFrontTaking() {
  const el = document.getElementById(RACER_FRONT_TAKING_ID);
  if (!el) return;
  const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
}

/**
 * 選手個別ページのヒーロー部分（氏名・よみ・支部・級別）
 * よみは「選手名のよみ」で探す人と同姓同名の見分けのために出す（GS00、2026-10-28）
 * プロフィールが無い選手は見出しに登録番号を入れ、全員が同じ見出しにならないようにする
 */
export default function RacerProfileHeader({
  profile,
  grade,
  racerId,
  isInya = false,
}) {
  const { t } = useTranslation();
  const name =
    profile?.name?.replace(/\s+/g, "") ?? `登録番号${racerId}の選手情報なし`;
  const kana = formatRacerKana(profile?.name_kana);

  return (
    <div className="racer-profile-header">
      <div className="favorite-star-header-row">
        <h1 translate="no">{name}</h1>
        {racerId && (
          <FavoriteStarButton
            type="racer"
            id={Number(racerId)}
            name={name}
            entry="racer_header"
            withLabel
          />
        )}
      </div>
      {kana && (
        <p className="racer-profile-header-kana" translate="no">
          {kana}
        </p>
      )}
      <div className="racer-profile-header-meta">
        {profile?.branch && (
          <span className="racer-profile-header-branch" translate="no">
            {profile.branch}支部
          </span>
        )}
        {grade && <span className="racer-profile-header-grade">{grade}</span>}
        {isInya && (
          <button
            type="button"
            className="racer-profile-header-inya"
            aria-label={t("frontTaking.badgeAria")}
            onClick={scrollToFrontTaking}
          >
            {t("frontTaking.badge")}
          </button>
        )}
      </div>
    </div>
  );
}
