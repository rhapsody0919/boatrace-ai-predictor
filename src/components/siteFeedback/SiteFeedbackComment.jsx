import { useId } from "react";
import { FEEDBACK_MAX_COMMENT } from "../../pure/siteFeedback";
import "./SiteFeedbackComment.css";

const K = "siteFeedback";

/**
 * ご意見ボックスの内容の欄（必須、500字まで、文字数の表示）。空のまま送ろうとしたら理由を出す。
 * form は useSiteFeedbackForm の返り値。textRef は空で送ったときに入力欄へ戻すためにパネルが持つ。
 */
export function CommentField({ t, form, textRef }) {
  const textId = useId();
  const errId = useId();
  return (
    <div className="site-fb-field">
      <label className="site-fb-q" htmlFor={textId}>
        {t(`${K}.commentLabel`)}
      </label>
      <textarea
        id={textId}
        ref={textRef}
        className="site-fb-text"
        value={form.comment}
        maxLength={FEEDBACK_MAX_COMMENT}
        placeholder={t(`${K}.placeholder`)}
        aria-invalid={form.emptyTried || undefined}
        aria-describedby={form.emptyTried ? errId : undefined}
        onChange={(e) => form.setComment(e.target.value)}
      />
      <div className="site-fb-under">
        <span className="site-fb-error" id={errId} role="alert">
          {form.emptyTried ? t(`${K}.empty`) : ""}
        </span>
        <span className="site-fb-count">
          {t(`${K}.count`, {
            n: form.comment.length,
            max: FEEDBACK_MAX_COMMENT,
          })}
        </span>
      </div>
    </div>
  );
}
