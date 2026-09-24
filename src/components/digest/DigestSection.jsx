/**
 * DigestSection - 「本日のデータ一覧」の各セクションの共通枠（BOA-402、screens.md C-2）
 *
 * 見出し・1行の説明・件数・空状態を1箇所にまとめる。
 * 逃げ／まくり／逃がし／フライング／帰郷の5セクションで使い回す
 * （`.claude/rules/component-reuse.md`「同じUIパターンが2箇所以上なら共通化」）。
 *
 * **空状態でセクションごと消さない。** 「該当0件」と「読み込めていない」を
 * 利用者が区別できるようにするため、0件でも見出しと説明は残して
 * 「本日、条件に該当するレースはありません」と明示する（spec §6）。
 */
import "./DigestSection.css";

function DigestSection({
  title,
  description,
  count = null,
  total = null,
  emptyMessage = "本日、条件に該当するレースはありません",
  notice = null,
  children,
}) {
  const isEmpty = count === 0;

  return (
    <section className="digest-section">
      <div className="digest-section__head">
        <h2 className="digest-section__title">{title}</h2>
        {count !== null && (
          <span className="digest-section__count">
            {total !== null && total > count
              ? `上位${count}件 / ${total}件`
              : `${count}件`}
          </span>
        )}
      </div>
      {description && (
        <p className="digest-section__description">{description}</p>
      )}
      {notice && <p className="digest-section__notice">{notice}</p>}
      {isEmpty ? (
        <p className="digest-section__empty">{emptyMessage}</p>
      ) : (
        children
      )}
    </section>
  );
}

export default DigestSection;
