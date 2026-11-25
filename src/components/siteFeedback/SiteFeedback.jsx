import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { trackEvent } from "../../utils/analytics";
import {
  feedbackPageType,
  isFeedbackHiddenPath,
} from "../../pure/siteFeedback";
import { OPEN_SITE_FEEDBACK_EVENT } from "./openEvent";
import { useSiteFeedbackForm } from "./useSiteFeedbackForm";
import SiteFeedbackPanel from "./SiteFeedbackPanel";
import "./SiteFeedback.css";

function BubbleIcon() {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M21 12a8 8 0 0 1-8 8H5l-2 2V12a8 8 0 0 1 8-8h2a8 8 0 0 1 8 8Z" />
      <path d="M8.5 10.5h7M8.5 14h4.5" />
    </svg>
  );
}

/**
 * 下へ読み進めている間は小さく（アイコンだけに）し、上へ戻すか先頭の近くで元に戻す。
 * 向きが変わった位置（turn）からの移動量で決める: 読み込みで本文の高さが変わると
 * スクロール位置が数px 上下するので、1回のイベントの差では決めない（小さく→元に→小さく、とちらつく）。
 */
const SHRINK_AFTER_DOWN = 8;
const RESTORE_AFTER_UP = 40;
const NEAR_TOP = 40;
const SHRINK_BELOW = 80;

function useShrinkOnScroll() {
  const [mini, setMini] = useState(false);
  useEffect(() => {
    let lastY = window.scrollY;
    let turn = lastY;
    let down = true;
    const onScroll = () => {
      const y = window.scrollY;
      if (y === lastY) return;
      const nowDown = y > lastY;
      if (nowDown !== down) {
        down = nowDown;
        turn = lastY;
      }
      lastY = y;
      if (y < NEAR_TOP || turn - y >= RESTORE_AFTER_UP) setMini(false);
      else if (y > SHRINK_BELOW && y - turn >= SHRINK_AFTER_DOWN) setMini(true);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  return mini;
}

/**
 * サイト全体のご意見ボックス。右下の小さなボタンと、押すと開く入力パネル。
 * ログインなし・匿名で、欲しい機能や使いにくいところを送ってもらう（設計: docs/design/site-feedback-box/spec.md）。
 * - 既存の固定表示とは重ねない（置き場所の決まりは SiteFeedback.css の冒頭、パネルは SiteFeedbackPanel.css）
 * - 管理画面・共有用の画面・思考アシストでは出さない（isFeedbackHiddenPath）
 * - フッターの入口は OPEN_SITE_FEEDBACK_EVENT で同じパネルを開く
 */
export default function SiteFeedback() {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  // 開いた画面のパス。別の画面へ移ったら閉じる（書きかけは残る）。描画の中で自分の状態を直すので、
  // 戻る→進むで同じパスへ戻っても開き直さない
  const [openAt, setOpenAt] = useState(null);
  if (openAt !== null && openAt !== pathname) setOpenAt(null);
  const open = openAt === pathname;
  const btnRef = useRef(null);
  // 開いた入口（フッターのボタン等）。利用者が閉じたらそこへフォーカスを戻す
  const openerRef = useRef(null);
  const restoreFocus = useRef(false);
  const mini = useShrinkOnScroll();
  const form = useSiteFeedbackForm({
    pathname,
    lang: i18n.resolvedLanguage ?? i18n.language,
  });
  const hidden = isFeedbackHiddenPath(pathname);

  const openPanel = (opener) => {
    // 送った後に ×・閉じる 以外で閉じていた（画面を移った・送っている間に閉じた）なら、空の入力から始める
    if (form.status === "sent") form.reset();
    restoreFocus.current = false;
    openerRef.current = opener ?? null;
    setOpenAt(pathname);
    trackEvent("site_feedback_open", {
      feedback_entry: opener ? "footer" : "button",
      feedback_page_type: feedbackPageType(pathname),
    });
  };

  const closePanel = () => {
    restoreFocus.current = true;
    setOpenAt(null);
    // 送った後に閉じたら、次に開いたときは空の入力から始める
    if (form.status === "sent") form.reset();
  };

  // 利用者が閉じたら、開いた入口（無ければ右下のボタン）へフォーカスを戻す。ボタンは閉じた後に描かれるので effect で行う。
  // 画面を移って閉じたときは戻さない（移った先のフォーカスを横取りしない）
  useEffect(() => {
    if (open || !restoreFocus.current) return;
    restoreFocus.current = false;
    const opener = openerRef.current;
    (opener?.isConnected ? opener : btnRef.current)?.focus();
  }, [open]);

  // フッターの入口。購読は付けっぱなしにし、呼ぶ中身だけ毎回の描画の物に替える
  const openPanelRef = useRef(openPanel);
  useEffect(() => {
    openPanelRef.current = openPanel;
  });
  useEffect(() => {
    if (hidden) return undefined;
    const onOpen = (e) =>
      openPanelRef.current(e.detail?.opener ?? document.activeElement);
    window.addEventListener(OPEN_SITE_FEEDBACK_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SITE_FEEDBACK_EVENT, onOpen);
  }, [hidden]);

  if (hidden) return null;

  return createPortal(
    <div className="site-fb">
      {!open && (
        <button
          type="button"
          ref={btnRef}
          className={`site-fb-btn${mini ? " is-mini" : ""}`}
          aria-haspopup="dialog"
          aria-label={t("siteFeedback.openAria")}
          data-testid="site-feedback-button"
          onClick={() => openPanel(null)}
        >
          <BubbleIcon />
          <span className="site-fb-btn-label">{t("siteFeedback.open")}</span>
        </button>
      )}
      {open && <SiteFeedbackPanel form={form} onClose={closePanel} />}
    </div>,
    document.body,
  );
}
