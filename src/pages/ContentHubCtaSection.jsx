import { Link } from "react-router-dom";

// CTAセクション
export function CtaSection() {
  return (
    <section className="hub-cta">
      <h2>AI予想を試してみる</h2>
      <p>学んだ知識をAI予想と組み合わせて、勝率アップを目指しましょう</p>
      <Link to="/" className="cta-btn">
        本日のAI予想を見る →
      </Link>
    </section>
  );
}
