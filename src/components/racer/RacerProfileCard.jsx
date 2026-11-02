import { Link } from "react-router-dom";
import "./RacerProfileCard.css";

function formatBirthDate(birthDate) {
  if (!birthDate) return null;
  const [y, m, d] = birthDate.split("-");
  return `${y}年${Number(m)}月${Number(d)}日`;
}

/**
 * 選手個別ページの基本情報グリッド
 * 値がある項目のみ表示する（プロフィール未取得の選手はfacts自体が空になる）
 */
export default function RacerProfileCard({ profile, racerId }) {
  if (!profile) {
    // 番号の打ち間違い・引退・データ未取得のどれかが画面から分かり、次に進めるようにする（ファン評価 GS00 1周目）
    return (
      <div className="racer-profile-card racer-profile-card-empty">
        <p>
          登録番号{racerId}
          のプロフィール情報がありません。番号の打ち間違い、引退した選手、またはまだデータを取り込んでいない選手の可能性があります。
        </p>
        <p>
          <Link to="/racers">選手一覧から探す →</Link>
        </p>
      </div>
    );
  }

  const facts = [
    // 登録番号は「選手名 登録番号」で探す人と、同姓同名の見分けのために先頭に出す（GS00、2026-10-28）
    { label: "登録番号", value: racerId, translateNo: true },
    { label: "生年月日", value: formatBirthDate(profile.birth_date) },
    { label: "支部", value: profile.branch, translateNo: true },
    { label: "出身地", value: profile.hometown, translateNo: true },
    { label: "登録期", value: profile.registration_period },
    {
      label: "身長・体重",
      value:
        profile.height_cm && profile.weight_kg
          ? `${profile.height_cm}cm / ${profile.weight_kg}kg`
          : null,
    },
    { label: "血液型", value: profile.blood_type },
  ].filter((fact) => fact.value);

  return (
    <div className="racer-profile-card">
      <div className="racer-profile-facts-grid">
        {facts.map((fact) => (
          <div className="racer-profile-fact" key={fact.label}>
            <strong>{fact.label}</strong>
            <span translate={fact.translateNo ? "no" : undefined}>
              {fact.value}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
