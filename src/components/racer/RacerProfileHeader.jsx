import "./RacerProfileHeader.css";

/**
 * 選手個別ページのヒーロー部分（氏名・支部・級別）
 */
export default function RacerProfileHeader({ profile, grade }) {
  const name = profile?.name?.replace(/\s+/g, "") ?? "選手情報なし";

  return (
    <div className="racer-profile-header">
      <h1 translate="no">{name}</h1>
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
