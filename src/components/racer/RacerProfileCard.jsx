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
 * 最初の画面は成績の要約に譲り、登録番号・支部・登録期だけ見せて残りは畳む（BOA-1688）
 */
const ALWAYS_SHOWN = new Set(["登録番号", "支部", "登録期"]);

function FactsGrid({ facts }) {
  return (
    <div className="racer-profile-facts-grid">
      {facts.map((fact) => (
        <div className="racer-profile-fact" key={fact.label}>
          <strong>{fact.label}</strong>
          <span translate={fact.translateNo ? "no" : undefined}>{fact.value}</span>
        </div>
      ))}
    </div>
  );
}

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

  const shown = facts.filter((fact) => ALWAYS_SHOWN.has(fact.label));
  const folded = facts.filter((fact) => !ALWAYS_SHOWN.has(fact.label));
  return (
    <div className="racer-profile-card">
      <FactsGrid facts={shown} />
      {folded.length > 0 && (
        <details className="racer-profile-more">
          <summary>プロフィールの詳細（生年月日・出身地など）</summary>
          <FactsGrid facts={folded} />
        </details>
      )}
    </div>
  );
}
