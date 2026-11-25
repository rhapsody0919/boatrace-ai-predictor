import { useId } from "react";
import { Link } from "react-router-dom";
import {
  FEEDBACK_KINDS,
  FEEDBACK_MAX_RATING,
  canSendFeedback,
} from "../../pure/siteFeedback";
import { CommentField } from "./SiteFeedbackComment";
import "./SiteFeedbackFields.css";

/*
 * ご意見ボックスの入力（内容・種類・満足度・送る・注記）と、送った後のお礼。パネルの枠と開閉は SiteFeedbackPanel.jsx。
 * 状態と送信は useSiteFeedbackForm.js の form を受け取る。
 */

const K = "siteFeedback";
const RATINGS = Array.from({ length: FEEDBACK_MAX_RATING }, (_, i) => i + 1);

// 選んでいない星は輪郭線だけ（CSS の fill: none）。選んだ星だけ塗る
function StarIcon() {
  return (
    <svg
      className="site-fb-star-icon"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2.6l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5L12 17.4l-5.8 3.1 1.1-6.5L2.6 9.4l6.5-.9z" />
    </svg>
  );
}

/**
 * ラジオのキー。選んであるラジオで Space を押したら外す（ブラウザは選んであるラジオの Space で click を出さないので、
 * マウス・指の「もう一度押すと外れる」（onClick）とそろえるためにここで受ける）。Enter では送らない。
 */
const radioKeys = (checked, clear) => (e) => {
  // 選んだつもりの Enter で、書いた内容を誤って送らない（ブラウザはラジオの上の Enter でもフォームを送る）
  if (e.key === "Enter") {
    e.preventDefault();
    return;
  }
  if (e.key !== " " || !checked) return;
  e.preventDefault();
  clear();
};

/** 任意の1つ選び。本物のラジオなので Tab は1か所・矢印キーで動く。選んだものをもう一度押すと外れる */
function KindChips({ t, name, kind, setKind }) {
  return (
    <div className="site-fb-chips">
      {FEEDBACK_KINDS.map((k) => (
        <label key={k} className="site-fb-chip">
          <input
            type="radio"
            name={name}
            checked={kind === k}
            onChange={() => setKind(k)}
            onClick={() => kind === k && setKind(null)}
            onKeyDown={radioKeys(kind === k, () => setKind(null))}
          />
          <span className="site-fb-chip-face">{t(`${K}.kinds.${k}`)}</span>
        </label>
      ))}
    </div>
  );
}

function RatingStars({ t, name, rating, setRating }) {
  return (
    <div className="site-fb-stars">
      {RATINGS.map((n) => (
        <label
          key={n}
          className={`site-fb-star${rating != null && n <= rating ? " is-on" : ""}`}
        >
          <input
            type="radio"
            name={name}
            checked={rating === n}
            aria-label={t(`${K}.ratingAria`, {
              n,
              max: FEEDBACK_MAX_RATING,
              label: t(`${K}.ratings.${n}`),
            })}
            onChange={() => setRating(n)}
            onClick={() => rating === n && setRating(null)}
            onKeyDown={radioKeys(rating === n, () => setRating(null))}
          />
          <StarIcon />
        </label>
      ))}
      {/* 選んだ星の言葉。読み上げはラジオの名前（aria-label）が同じ言葉を読むので、ここは読ませない */}
      <span className="site-fb-star-cap" aria-hidden="true">
        {rating != null ? t(`${K}.ratings.${rating}`) : ""}
      </span>
    </div>
  );
}

export function FeedbackForm({ t, form, textRef }) {
  const kindName = useId();
  const rateName = useId();
  const sending = form.status === "sending";
  const onSubmit = (e) => {
    e.preventDefault();
    // 空のまま押したら、理由を出して入力欄へ移す
    if (!canSendFeedback(form.comment)) textRef.current?.focus();
    form.send();
  };
  return (
    <form className="site-fb-form" onSubmit={onSubmit} noValidate>
      <CommentField t={t} form={form} textRef={textRef} />
      <fieldset className="site-fb-field">
        <legend className="site-fb-q">
          {t(`${K}.kindLabel`)}
          <span className="site-fb-opt">{t(`${K}.optional`)}</span>
        </legend>
        <KindChips
          t={t}
          name={kindName}
          kind={form.kind}
          setKind={form.setKind}
        />
      </fieldset>
      <fieldset className="site-fb-field">
        <legend className="site-fb-q">
          {t(`${K}.ratingLabel`)}
          <span className="site-fb-opt">{t(`${K}.optional`)}</span>
        </legend>
        <RatingStars
          t={t}
          name={rateName}
          rating={form.rating}
          setRating={form.setRating}
        />
      </fieldset>
      {form.failed && (
        <p className="site-fb-error" role="alert">
          {t(`${K}.error`)}
        </p>
      )}
      {/* 送っている間も disabled にしない（disabled だとフォーカスがパネルの外へ落ち、Esc・Tab が効かなくなる）。
          二度押しは useSiteFeedbackForm の send が止める */}
      <button type="submit" className="site-fb-send" aria-disabled={sending}>
        {t(sending ? `${K}.sending` : `${K}.send`)}
      </button>
      <p className="site-fb-note">{t(`${K}.note`)}</p>
    </form>
  );
}

/** 送った後のお礼。返信できない断りと、お問い合わせページへのリンク */
export function FeedbackThanks({ t, onMore, onClose, doneRef }) {
  return (
    <div className="site-fb-thanks" role="status">
      <p className="site-fb-thanks-body">{t(`${K}.thanksBody`)}</p>
      <p className="site-fb-note">
        {t(`${K}.thanksReply`)}{" "}
        {/* /contact は ja 専用（TRANSLATED_PATHS に無い）ので、どの言語でも接頭辞なしで指す（CookieConsent の /privacy と同じ）。
            画面を移るとパネルは閉じる */}
        <Link to="/contact" hrefLang="ja" className="site-fb-link">
          {t(`${K}.contactLink`)}
        </Link>
      </p>
      <div className="site-fb-btnrow">
        <button type="button" className="site-fb-ghost" onClick={onMore}>
          {t(`${K}.more`)}
        </button>
        <button
          type="button"
          className="site-fb-send"
          ref={doneRef}
          onClick={onClose}
        >
          {t(`${K}.close`)}
        </button>
      </div>
    </div>
  );
}
