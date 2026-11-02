import "./RacerProfileHeader.css";
import { formatRacerKana } from "../../utils/racerName";

/**
 * 選手個別ページのヒーロー部分（氏名・よみ・支部・級別）
 * よみは「選手名のよみ」で探す人と同姓同名の見分けのために出す（GS00、2026-10-28）
 * プロフィールが無い選手は見出しに登録番号を入れ、全員が同じ見出しにならないようにする
 */
export default function RacerProfileHeader({ profile, grade, racerId }) {
  const name =
    profile?.name?.replace(/\s+/g, "") ?? `登録番号${racerId}の選手情報なし`;
  const kana = formatRacerKana(profile?.name_kana);

  return (
    <div className="racer-profile-header">
      <h1 translate="no">{name}</h1>
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
      </div>
    </div>
  );
}
