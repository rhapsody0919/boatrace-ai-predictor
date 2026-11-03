import FavoriteStarButton from "../common/FavoriteStarButton.jsx";
import "./RacerProfileHeader.css";
import { formatRacerKana } from "../../utils/racerName";
import { FRONT_TAKING_ANCHOR } from "./RacerFrontTaking";

/**
 * 選手個別ページのヒーロー部分（氏名・よみ・支部・級別）
 * よみは「選手名のよみ」で探す人と同姓同名の見分けのために出す（GS00、2026-10-28）
 * プロフィールが無い選手は見出しに登録番号を入れ、全員が同じ見出しにならないようにする
 * isInya のときは「イン屋」の札を出し、押すと前付けの説明へ移る（docs/design/inya-racer/mock/）
 */
export default function RacerProfileHeader({
  profile,
  grade,
  racerId,
  isInya = false,
}) {
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
          <a
            className="racer-profile-header-inya"
            href={`#${FRONT_TAKING_ANCHOR}`}
            title="ファンの呼び名です。公式の用語ではありません"
            data-testid="racer-inya-chip"
            onClick={(e) => {
              const target = document.getElementById(FRONT_TAKING_ANCHOR);
              if (!target) return;
              e.preventDefault();
              const reduce = window.matchMedia?.(
                "(prefers-reduced-motion: reduce)",
              ).matches;
              target.scrollIntoView({
                behavior: reduce ? "auto" : "smooth",
                block: "start",
              });
              target.focus({ preventScroll: true });
            }}
          >
            イン屋<span>前付けで内へ ↓</span>
          </a>
        )}
      </div>
    </div>
  );
}
