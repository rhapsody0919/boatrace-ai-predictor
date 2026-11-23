import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import {
  FEEDBACK_KINDS,
  FEEDBACK_MAX_COMMENT,
  FEEDBACK_MAX_RATING,
  canSendFeedback,
} from "../../pure/siteFeedback";

const K = "siteFeedback";
const RATINGS = Array.from({ length: FEEDBACK_MAX_RATING }, (_, i) => i + 1);
/** この幅以下は下からのシート（SiteFeedback.css の @media と同じ値） */
const SHEET_QUERY = "(max-width: 600px)";

function CloseIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M5 5l10 10M15 5L5 15" />
    </svg>
  );
}

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

function CommentField({ t, form, textRef }) {
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

function FeedbackForm({ t, form, textRef }) {
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

function FeedbackThanks({ t, onMore, onClose, doneRef }) {
  return (
    <div className="site-fb-thanks" role="status">
      <p className="site-fb-thanks-body">{t(`${K}.thanksBody`)}</p>
      <p className="site-fb-note">{t(`${K}.thanksReply`)}</p>
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

/** Tab を先頭と末尾でつなぎ、パネルの外へフォーカスが出ないようにする */
function trapTab(e, panel) {
  const list = [...panel.querySelectorAll("button, textarea, input")].filter(
    (el) => !el.disabled,
  );
  if (list.length === 0) return;
  const first = list[0];
  const last = list[list.length - 1];
  const active = document.activeElement;
  if (e.shiftKey && (active === first || active === panel)) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && active === last) {
    e.preventDefault();
    first.focus();
  }
}

/**
 * スマホで画面のキーボードが出たら、その高さだけパネルを持ち上げる
 * （iOS Safari は position: fixed; bottom: 0 をキーボードの上へ動かさず、「送る」が隠れる）。
 * 指で拡大している間（scale > 1）は見える範囲が縮むだけなので、持ち上げない。
 */
function useKeyboardInset(panelRef) {
  useEffect(() => {
    const vv = window.visualViewport;
    const panel = panelRef.current;
    if (!vv || !panel) return undefined;
    const update = () => {
      const kb =
        vv.scale > 1
          ? 0
          : Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      panel.style.setProperty("--site-fb-kb", `${Math.round(kb)}px`);
    };
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, [panelRef]);
}

/**
 * シート（スマホ幅）を開いている間は、後ろのページをスクロールさせない。閉じたら元の値に戻す。
 * 広い幅の小窓では止めない（スクロールバーが消えて、本文がその幅だけ横にずれる）。
 */
function useSheetScrollLock() {
  useEffect(() => {
    if (!window.matchMedia?.(SHEET_QUERY).matches) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
}

// 指で触る端末は、開いた瞬間にキーボードを出さない（パネルの全体を先に見せる）
const isTouch = () => !!window.matchMedia?.("(pointer: coarse)").matches;

/**
 * ご意見ボックスの入力パネル（スマホ幅は下からのシート、広い幅は右下の小窓）。
 * 開いたら入力欄（指で触る端末はパネル、送った後は「閉じる」）にフォーカスを移し、Esc・背景・×で閉じる。
 */
export default function SiteFeedbackPanel({ form, onClose }) {
  const { t } = useTranslation();
  const titleId = useId();
  const panelRef = useRef(null);
  const textRef = useRef(null);
  const doneRef = useRef(null);
  const sent = form.status === "sent";
  useKeyboardInset(panelRef);
  useSheetScrollLock();

  useEffect(() => {
    if (sent) doneRef.current?.focus();
    else if (isTouch()) panelRef.current?.focus();
    else textRef.current?.focus();
  }, [sent]);

  const onKeyDown = (e) => {
    // 日本語の変換を取り消す Esc では閉じない
    if (e.nativeEvent.isComposing || e.keyCode === 229) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
    } else if (e.key === "Tab" && panelRef.current) {
      trapTab(e, panelRef.current);
    }
  };

  return (
    <>
      <div
        className="site-fb-scrim"
        data-testid="site-feedback-scrim"
        onClick={onClose}
      />
      <div
        className="site-fb-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panelRef}
        onKeyDown={onKeyDown}
        data-testid="site-feedback-panel"
      >
        <div className="site-fb-head">
          <div className="site-fb-head-text">
            <h2 className="site-fb-title" id={titleId}>
              {t(sent ? `${K}.thanksTitle` : `${K}.title`)}
            </h2>
            {!sent && <p className="site-fb-lead">{t(`${K}.lead`)}</p>}
          </div>
          <button
            type="button"
            className="site-fb-x"
            aria-label={t(`${K}.close`)}
            onClick={onClose}
          >
            <CloseIcon />
          </button>
        </div>
        {sent ? (
          <FeedbackThanks
            t={t}
            onMore={form.reset}
            onClose={onClose}
            doneRef={doneRef}
          />
        ) : (
          <FeedbackForm t={t} form={form} textRef={textRef} />
        )}
      </div>
    </>
  );
}
