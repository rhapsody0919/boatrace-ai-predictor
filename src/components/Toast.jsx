import { useCallback, useRef, useState } from "react";

const DEFAULT_DURATION_MS = 2000;

/**
 * トーストの表示状態。showToast(message, type, options) で出す。
 * options.action（{label, onClick}）を渡すと押せる1行を足す。options.duration で表示の長さを変える。
 * 押せる1行があるトーストは、マウスを重ねている間・フォーカスがある間は消さない（hold / release）。
 * 2秒では読んで押す時間が足りない（BOA-832、WCAG 2.2.1 の考え方）
 */
export function useToast() {
  const [toast, setToast] = useState({
    visible: false,
    message: "",
    type: "success",
    action: null,
  });
  const timerRef = useRef(null);
  const durationRef = useRef(DEFAULT_DURATION_MS);
  const heldRef = useRef(false);

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  const hide = useCallback(() => {
    clearTimer();
    setToast((prev) => ({ ...prev, visible: false }));
  }, []);

  const startTimer = useCallback(() => {
    clearTimer();
    timerRef.current = setTimeout(() => {
      if (!heldRef.current) setToast((prev) => ({ ...prev, visible: false }));
    }, durationRef.current);
  }, []);

  const showToast = useCallback(
    (message, type = "success", { action = null, duration } = {}) => {
      durationRef.current = duration ?? DEFAULT_DURATION_MS;
      heldRef.current = false;
      setToast({ visible: true, message, type, action });
      startTimer();
    },
    [startTimer],
  );

  // マウスを重ねている間・フォーカスがある間は消さない。離れたら数え直す
  const hold = useCallback(() => {
    heldRef.current = true;
    clearTimer();
  }, []);

  const release = useCallback(() => {
    heldRef.current = false;
    startTimer();
  }, [startTimer]);

  return { toast, showToast, hide, hold, release };
}

export { default } from "./ToastView.jsx";
