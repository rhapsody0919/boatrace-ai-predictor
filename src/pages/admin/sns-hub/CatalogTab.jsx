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
import { FORMAT_LABELS } from "./constants.js";

export default function CatalogTab({ templateVariants }) {
  return (
    <div className="catalog-tab">
      <section className="catalog-section">
        <h2 className="catalog-section-title">型一覧</h2>
        <TemplateVariantList templateVariants={templateVariants} />
      </section>
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

function TemplateVariantList({ templateVariants }) {
  if (templateVariants.length === 0) {
    return (
      <div className="empty-state">
        <p>登録されている型はありません。</p>
      </div>
    );
  }

  const grouped = templateVariants.reduce((acc, tv) => {
    (acc[tv.format] ||= []).push(tv);
    return acc;
  }, {});

  return (
    <div className="template-variant-groups">
      {Object.entries(grouped).map(([format, variants]) => (
        <details key={format} className="template-variant-group">
          <summary className="template-variant-format">
            {FORMAT_LABELS[format] || format}（{variants.length}件）
          </summary>
          <table className="template-variant-table">
            <thead>
              <tr>
                <th>デザイン名</th>
                <th>コンポジション</th>
                <th>作成者</th>
                <th>状態</th>
              </tr>
            </thead>
            <tbody>
              {variants.map((tv) => (
                <tr key={tv.id}>
                  <td>{tv.variant_name}</td>
                  <td>{tv.composition_name}</td>
                  <td>{tv.created_by === "routine" ? "Routine" : "人間"}</td>
                  <td>{tv.active ? "稼働中" : "停止中"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      ))}
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
