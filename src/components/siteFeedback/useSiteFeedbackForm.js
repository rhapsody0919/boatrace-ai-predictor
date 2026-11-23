import { useRef, useState } from "react";
import { sendSiteFeedback } from "../../services/analogyFeedback";
import { trackEvent } from "../../utils/analytics";
import { readOrCreateClientKey } from "../../pure/clientKey";
import {
  buildSiteFeedbackRow,
  canSendFeedback,
  feedbackPageType,
} from "../../pure/siteFeedback";

// キャッシュ全削除（boatai: 接頭辞）で消えないよう boatai-user: にする（龍神ソナーの声と同じ決まり）
const CLIENT_KEY = "boatai-user:site-feedback-client";

/**
 * ご意見ボックスの入力と送信。書きかけはパネルを閉じても残し、送った後だけ消す。
 * status: "idle"（入力中）| "sending" | "sent"（お礼を出す）
 */
export function useSiteFeedbackForm({ pathname, lang }) {
  const [kind, setKind] = useState(null);
  const [comment, setComment] = useState("");
  const [rating, setRating] = useState(null);
  const [status, setStatus] = useState("idle");
  const [failed, setFailed] = useState(false);
  // 空のまま「送る」を押した（理由を出す）
  const [emptyTried, setEmptyTried] = useState(false);
  const key = useRef(null);

  const reset = () => {
    setKind(null);
    setComment("");
    setRating(null);
    setFailed(false);
    setEmptyTried(false);
    setStatus("idle");
  };

  const changeComment = (text) => {
    setComment(text);
    // 書き直し始めたら、前の「送れませんでした」は消す
    setFailed(false);
    if (emptyTried && canSendFeedback(text)) setEmptyTried(false);
  };

  const send = async () => {
    if (status === "sending") return;
    if (!canSendFeedback(comment)) {
      setEmptyTried(true);
      return;
    }
    setStatus("sending");
    setFailed(false);
    try {
      key.current ??= readOrCreateClientKey(
        CLIENT_KEY,
        () => localStorage,
        crypto,
      );
      await sendSiteFeedback(
        buildSiteFeedbackRow({
          kind,
          comment,
          rating,
          pathname,
          lang,
          clientKey: key.current,
        }),
      );
      setStatus("sent");
      trackEvent("site_feedback_send", {
        feedback_kind: kind ?? "none",
        feedback_rated: rating != null,
        feedback_page_type: feedbackPageType(pathname),
      });
    } catch (err) {
      // 入力は残す（もう一度押せば同じ内容で送れる）
      setStatus("idle");
      setFailed(true);
      // 失敗はどこにも残らない（連投の制限は INSERT ごと戻る）ので、種類だけを計測に送る。本文は送らない。
      // 表がまだ無い（PGRST205）・CHECK のずれ（23514）・制限（P0001）・通信の失敗（コードなし）を見分ける
      trackEvent("site_feedback_send_failed", {
        error_code: String(err?.code || "unknown").slice(0, 32),
        feedback_page_type: feedbackPageType(pathname),
      });
      console.error("ご意見を送れなかった", err);
    }
  };

  return {
    kind,
    setKind,
    comment,
    setComment: changeComment,
    rating,
    setRating,
    status,
    failed,
    emptyTried,
    send,
    reset,
  };
}
