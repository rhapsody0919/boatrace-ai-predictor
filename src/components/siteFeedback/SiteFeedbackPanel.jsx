import { useEffect, useId, useRef } from "react";
import { useTranslation } from "react-i18next";
import { FeedbackForm, FeedbackThanks } from "./SiteFeedbackFields";
import "./SiteFeedbackPanel.css";

const K = "siteFeedback";
/** この幅以下は下からのシート（SiteFeedbackPanel.css の @media と同じ値） */
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

/** Tab を先頭と末尾でつなぎ、パネルの外へフォーカスが出ないようにする */
function trapTab(e, panel) {
  const list = [
    ...panel.querySelectorAll("button, textarea, input, a[href]"),
  ].filter((el) => !el.disabled);
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
