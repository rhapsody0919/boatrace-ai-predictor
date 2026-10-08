import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { sendAnalogyFeedback } from "../../../services/analogyFeedback";
import { trackEvent } from "../../../utils/analytics";

/**
 * 画面の中の声（龍神ソナーの反応の計測、モック承認 2026-10-08、docs/design/analogy-reaction-measurement/mock/）。
 * 1段目「なった／物足りない」を押した時点で vote を保存し（2段目を送らない人も押下率に入れる）、
 * 2段目の「送る」で detail を保存する。匿名。送ったレースはお礼の1行だけにする。
 */
const REASONS = [
  "few_races",
  "no_filter",
  "hard_to_read",
  "how_to_use",
  "other",
];
const MAX_COMMENT = 200;
const LANGS = ["ja", "en", "zh-TW", "ko"];
// キャッシュ全削除（boatai: 接頭辞）で消えないよう boatai-user: にする
const CLIENT_KEY = "boatai-user:analogy-feedback-client";
const DONE_KEY = "boatai-user:analogy-feedback-done";
const DONE_LIMIT = 300;

// crypto.randomUUID が無い古いブラウザでも、DB の uuid 型に合う v4 の形で作る
const newUuid = () => {
  if (crypto.randomUUID) return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

/** ブラウザごとの乱数。保存できない環境では表示中だけの値になる（連投の制限が効きにくくなるだけ） */
function clientKey() {
  try {
    const saved = localStorage.getItem(CLIENT_KEY);
    if (saved) return saved;
    const key = newUuid();
    localStorage.setItem(CLIENT_KEY, key);
    return key;
  } catch {
    return newUuid();
  }
}

function readDone() {
  try {
    const list = JSON.parse(localStorage.getItem(DONE_KEY) ?? "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function markDone(raceId) {
  try {
    const list = [...readDone().filter((r) => r !== raceId), raceId];
    localStorage.setItem(DONE_KEY, JSON.stringify(list.slice(-DONE_LIMIT)));
  } catch {
    // 保存できなければ、次に開いたとき質問がもう一度出るだけ
  }
}

export default function AnalogyFeedback({ raceId, stage, tab }) {
  const { t, i18n } = useTranslation();
  const k = "aiPredictionTab.analogy.feedback";
  const qId = useId();
  const textId = useId();
  const [verdict, setVerdict] = useState(null);
  const [reasons, setReasons] = useState([]);
  const [comment, setComment] = useState("");
  const [status, setStatus] = useState(() =>
    readDone().includes(raceId) ? "sent" : "idle",
  );
  const [failed, setFailed] = useState(false);
  const voteSent = useRef(false);
  const key = useRef(null);
  const boxRef = useRef(null);

  // 見えたらレースごとに1回（押下率の分母）
  const viewed = useRef(false);
  useEffect(() => {
    const el = boxRef.current;
    if (!el || viewed.current || status === "sent") return;
    if (typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      viewed.current = true;
      trackEvent("analogy_feedback_view", { race_id: raceId });
    });
    io.observe(el);
    return () => io.disconnect();
  }, [raceId, status]);

  const base = () => {
    key.current ??= clientKey();
    return {
      race_id: raceId,
      analogy_stage: stage,
      analogy_tab: tab,
      lang: LANGS.includes(i18n.language) ? i18n.language : "ja",
      client_key: key.current,
    };
  };

  const vote = async (v) => {
    setVerdict(v);
    setFailed(false);
    trackEvent("analogy_feedback_vote", {
      race_id: raceId,
      analogy_verdict: v,
    });
    if (voteSent.current) return;
    voteSent.current = true;
    try {
      await sendAnalogyFeedback({
        ...base(),
        kind: "vote",
        verdict: v,
        reasons: null,
        comment: null,
      });
    } catch (err) {
      voteSent.current = false;
      setFailed(true);
      console.error("龍神ソナーの声（1段目）を送れなかった", err);
    }
  };

  const send = async () => {
    setStatus("sending");
    setFailed(false);
    const text = comment.trim();
    try {
      await sendAnalogyFeedback({
        ...base(),
        kind: "detail",
        verdict,
        reasons: verdict === "lacking" && reasons.length ? reasons : null,
        comment: text ? text.slice(0, MAX_COMMENT) : null,
      });
      markDone(raceId);
      setStatus("sent");
      trackEvent("analogy_feedback_send", {
        race_id: raceId,
        analogy_verdict: verdict,
      });
    } catch (err) {
      setStatus("idle");
      setFailed(true);
      console.error("龍神ソナーの声（2段目）を送れなかった", err);
    }
  };

  if (status === "sent")
    return (
      <div className="af-v16-box af-fb" data-testid="analogy-feedback">
        <p className="af-fb-thanks" role="status">
          {t(`${k}.thanks`)}
        </p>
      </div>
    );

  const toggleReason = (r) =>
    setReasons((list) =>
      list.includes(r) ? list.filter((x) => x !== r) : [...list, r],
    );

  return (
    <div
      className="af-v16-box af-fb"
      data-testid="analogy-feedback"
      ref={boxRef}
    >
      <p className="af-fb-q" id={qId}>
        {t(`${k}.question`)}
      </p>
      <div className="af-seg" role="group" aria-labelledby={qId}>
        {["useful", "lacking"].map((v) => (
          <button
            key={v}
            type="button"
            aria-pressed={verdict === v}
            onClick={() => vote(v)}
          >
            {t(`${k}.${v}`)}
          </button>
        ))}
      </div>
      {verdict === "lacking" && (
        <fieldset className="af-fb-reasons">
          <legend className="af-fb-sub">{t(`${k}.lackingAsk`)}</legend>
          {REASONS.map((r) => (
            <label key={r} className="af-fb-chk">
              <input
                type="checkbox"
                checked={reasons.includes(r)}
                onChange={() => toggleReason(r)}
              />
              {t(`${k}.reasons.${r}`)}
            </label>
          ))}
        </fieldset>
      )}
      {verdict === "useful" && (
        <label className="af-fb-sub" htmlFor={textId}>
          {t(`${k}.usefulAsk`)}
        </label>
      )}
      {verdict && (
        <>
          <textarea
            id={textId}
            className="af-fb-text"
            value={comment}
            maxLength={MAX_COMMENT}
            aria-label={
              verdict === "lacking" ? t(`${k}.commentLabel`) : undefined
            }
            placeholder={t(`${k}.${verdict}Example`)}
            onChange={(e) => setComment(e.target.value)}
          />
          <p className="af-fb-count" aria-live="polite">
            {t(`${k}.count`, { n: comment.length, max: MAX_COMMENT })}
          </p>
          <div>
            <button
              type="button"
              className="af-fb-send"
              disabled={status === "sending"}
              onClick={send}
            >
              {t(`${k}.send`)}
            </button>
          </div>
        </>
      )}
      {failed && (
        <p className="af-fb-error" role="alert">
          {t(`${k}.error`)}
        </p>
      )}
      <p className="af-fb-note">{t(`${k}.note`)}</p>
    </div>
  );
}
