// 「フォーマットカタログ」（資料のページ）。SnsHubAdmin.jsx から切り出し
import {
  GLOBAL_RULES,
  CHANNEL_RULES,
  FORMAT_LIBRARY,
  PERSONA_NOTES,
  DESIGN_GUIDELINE_NOTES,
  SHARED_COMPONENTS,
  buildDocUrl,
} from "../../../data/snsFormatCatalogContent";

// DB の型一覧（sns_template_variants）は、読む口（template-variants）を SH01 R2 で消したため出さない
export default function CatalogTab() {
  return (
    <div className="catalog-tab">
      <section className="catalog-section">
        <h2 className="catalog-section-title">生成ルール</h2>
        <RulesReferenceSection />
      </section>
      <section className="catalog-section">
        <h2 className="catalog-section-title">共有コンポーネント</h2>
        <SharedComponentsSection />
      </section>
      <section className="catalog-section">
        <h2 className="catalog-section-title">デザイン・ペルソナ方針</h2>
        <DocReferenceSection />
      </section>
    </div>
  );
}

// 全体ルール（Tier1）・チャネル別ルール（Tier2）へのリンク集。デザイン・
// ペルソナ方針（DocReferenceSection）とは意味が異なる（技術ルール vs
// 制作方針）ため別コンポーネントに分離した（2026-09-04、UI/UXレビュー指摘:
// 「デザイン・ペルソナ方針」の見出し下に技術ルールを入れると見出しと
// 中身が一致しない）
function RulesReferenceSection() {
  return (
    <div className="doc-reference-section">
      <div className="doc-reference-group">
        <h3 className="doc-reference-group-title">
          🌐 全体ルール（全チャネル共通）
        </h3>
        {GLOBAL_RULES.map((r) => (
          <div key={r.name} className="doc-reference-card">
            <div className="doc-reference-card-header">
              <span className="doc-reference-name">{r.name}</span>
            </div>
            <p className="doc-reference-summary">{r.summary}</p>
            <a
              href={buildDocUrl(r.docPath)}
              target="_blank"
              rel="noreferrer"
              className="doc-reference-link"
            >
              {r.docLabel} を見る →
            </a>
          </div>
        ))}
      </div>

      <div className="doc-reference-group">
        <h3 className="doc-reference-group-title">📡 チャネル別ルール</h3>
        <div className="doc-reference-channel-grid">
          {CHANNEL_RULES.map((r) => (
            <a
              key={r.platform}
              href={buildDocUrl(r.docPath)}
              target="_blank"
              rel="noreferrer"
              className="doc-reference-channel-link"
            >
              <span className="doc-reference-channel-label">{r.label}</span>
              <span className="doc-reference-channel-doc">{r.docLabel}</span>
            </a>
          ))}
        </div>
      </div>
    </div>
  );
}

// 再利用可能なRemotion共有コンポーネント一覧。venue-feature等のパイプラインは
// masterへコードをコミットしないため、既存の共有コンポーネントを知らずに
// 新しい形状のコードを書き捨ててしまう不具合が起きた（2026-09-05、棒グラフ
// 左偏りバグ）。ユーザー指摘を受け、生成ルール（RulesReferenceSection）とは
// 別に「実際にどんなコードが再利用できるか」を一覧できるようにした
function SharedComponentsSection() {
  return (
    <div className="doc-reference-section">
      <div className="doc-reference-group">
        {SHARED_COMPONENTS.map((c) => (
          <div
            key={c.name}
            className="doc-reference-card shared-component-card"
          >
            {c.imagePath && (
              <img
                src={c.imagePath}
                alt={`${c.name}のサンプル画像`}
                className="shared-component-thumb"
              />
            )}
            <div className="shared-component-card-body">
              <div className="doc-reference-card-header">
                <span className="doc-reference-name">{c.name}</span>
              </div>
              <p className="doc-reference-summary">{c.summary}</p>
              <a
                href={buildDocUrl(c.docPath)}
                target="_blank"
                rel="noreferrer"
                className="doc-reference-link"
              >
                {c.docLabel} を見る →
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function DocReferenceSection() {
  return (
    <div className="doc-reference-section">
      <div className="doc-reference-group">
        <h3 className="doc-reference-group-title">フォーマットライブラリ</h3>
        {FORMAT_LIBRARY.map((f) => (
          <div key={f.name} className="doc-reference-card">
            <div className="doc-reference-card-header">
              <span className="doc-reference-name">{f.name}</span>
              <span className="doc-reference-status">{f.status}</span>
            </div>
            <p className="doc-reference-summary">{f.summary}</p>
            <a
              href={buildDocUrl(f.docPath)}
              target="_blank"
              rel="noreferrer"
              className="doc-reference-link"
            >
              {f.docLabel} を見る →
            </a>
          </div>
        ))}
      </div>

      <div className="doc-reference-group">
        <h3 className="doc-reference-group-title">ペルソナ・キャラ選定</h3>
        <div className="doc-reference-card">
          <p className="doc-reference-summary">{PERSONA_NOTES.summary}</p>
          <a
            href={buildDocUrl(PERSONA_NOTES.docPath)}
            target="_blank"
            rel="noreferrer"
            className="doc-reference-link"
          >
            {PERSONA_NOTES.docLabel} を見る →
          </a>
        </div>
      </div>

      <div className="doc-reference-group">
        <h3 className="doc-reference-group-title">
          デザイン・ブランドガイドライン
        </h3>
        <div className="doc-reference-card">
          <p className="doc-reference-summary">
            {DESIGN_GUIDELINE_NOTES.summary}
          </p>
          <a
            href={buildDocUrl(DESIGN_GUIDELINE_NOTES.docPath)}
            target="_blank"
            rel="noreferrer"
            className="doc-reference-link"
          >
            {DESIGN_GUIDELINE_NOTES.docLabel} を見る →
          </a>
        </div>
      </div>
    </div>
  );
}
