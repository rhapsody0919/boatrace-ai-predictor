import "./RacerProfileHeader.css";
import { splitRacerName } from "../../utils/racerName";

/**
 * 選手個別ページのヒーロー部分（氏名・よみ・支部・級別）
 * よみは「選手名のよみ」で探す人と同姓同名の見分けのために出す（GS00、2026-10-28）
 */
export default function RacerProfileHeader({ profile, grade }) {
  const name = profile?.name?.replace(/\s+/g, "") ?? "選手情報なし";
  // name_kana は姓と名の間に全角スペースが入るので、半角1つでつなぎ直す
  const kana = splitRacerName(profile?.name_kana).join(" ");

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
