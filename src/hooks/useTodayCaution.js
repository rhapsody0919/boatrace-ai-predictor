import { isInCautionEnabled } from "../config/featureFlags";
import { useVisibleOnce } from "./useVisibleOnce";
import { trackEvent } from "../utils/analytics";
import { cautionClickEvent, cautionVisibleEvent } from "../utils/cautionEvents";

const sendEvent = (ev) => ev && trackEvent(ev.name, ev.params);

/**
 * /today のイン崩れ注意度（BOA-822 task 35、機能フラグの側）。朝の生成が写した in_caution_* を出すか。
 * 列の無い過去の行（156 の前・注意度を出さなかったレース）は欄を出さない（旧の指数にも戻さない）。
 * 計測: カードからレースへ移ったら caution_click（target=race、押したレースの段つき）
 *
 * @returns {{enabled: boolean, showLegacy: boolean, onClick: Function|undefined}}
 */
export function useTodayCaution(row) {
  const flag = isInCautionEnabled();
  const enabled =
    flag &&
    typeof row.in_caution_pct === "number" &&
    typeof row.in_caution_n === "number" &&
    ["low", "mid", "high"].includes(row.in_caution_level);
  const onClick = enabled
    ? () =>
        sendEvent(
          cautionClickEvent({
            surface: "today",
            target: "race",
            raceId: row.race_id,
            inCaution: { level: row.in_caution_level },
          }),
        )
    : undefined;
  return { enabled, showLegacy: !flag, onClick };
}

/** 注意度の欄が画面に入ったら、日ごとに1回 caution_visible（race_id・段なし）。欄を描く部品の中で呼ぶ */
export function useTodayCautionVisible(row) {
  return useVisibleOnce(`today|${row.digest_date}`, () =>
    sendEvent(cautionVisibleEvent({ surface: "today" })),
  );
}
