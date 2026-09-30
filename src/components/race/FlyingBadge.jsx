/**
 * FlyingBadge - 出走表に載っている今期のF（フライング）本数バッジ（phase a T5-3）
 *
 * 出所は `race_entries.f_count` に統一する。以前ST考察カードが出していた値は
 * `race_start_timings.is_flying` を「約296日の窓 × そのコース」で数えた回数で、
 * ツールチップの「今期のフライング」という説明と実際の数字が食い違っていた
 * （期のリセットが効かない）。基本情報タブのバッジと違う数字を出し続けるため、
 * 説明文だけを直す案は採らず出所ごと差し替えた（tasks.md T5-3）。
 *
 * 色は **F1が金・F2が赤**。F2は同じ期に2本目で合計90日のあっせん停止になり、
 * 1本目（30日）とは意味の重さが違うため（実測の分布は F0 74.4% / F1 23.9% /
 * F2 1.8%、2026-09-21以降3,246艇）。
 *
 * `f_count` はレース単位で all-or-none（2026-09以降で all 825レース /
 * none 2,943レース / partial 0件）。2026-09-20以前のレースでは値が無く
 * バッジも空欄も出さない。
 */
import { useTranslation } from "react-i18next";
import "./FlyingBadge.css";

/**
 * ## 今節の印とLバッジ（BOA-440）
 *
 * - `currentMeet`: 今期のFに**今節**（前日まで）で切ったものがある艇。
 *   「F1 今節」と続けて出す。F2のとき今節が1本でも2本でも印は1つ（本数の内訳は出さない）。
 *   判定は `getCurrentMeetFlyingBoats`。Fを切っても節の残りは出走するので、
 *   「今節はもう走らない」と読める言い方（「F休み」「帰郷」等）は使わない
 * - `lateCount`: 出走表の今期L（出遅れ）本数。1以上のときだけ出す
 *   （実測で `l_count >= 1` は11,366件中4件。screens.md §3.7）。色はFと別系統の灰。
 *   今節かどうかは見ない（件数が少なく、判定材料の出遅れフラグも持っていない）
 */
function FlyingBadge({ count, currentMeet = false, lateCount }) {
  const { t } = useTranslation();
  const hasF = Boolean(count) && count > 0;
  const hasL = Boolean(lateCount) && lateCount > 0;
  if (!hasF && !hasL) return null;
  return (
    <>
      {hasF && (
        <span
          className={`flying-badge${count >= 2 ? " is-f2" : ""}${currentMeet ? " has-meet" : ""}`}
          title={
            currentMeet
              ? t("flyingBadge.titleCurrentMeet", { n: count })
              : t("flyingBadge.title", { n: count })
          }
        >
          F{count}
          {currentMeet && (
            <span className="flying-badge-meet">
              {t("flyingBadge.currentMeet")}
            </span>
          )}
        </span>
      )}
      {hasL && (
        <span
          className="flying-badge is-late"
          title={t("flyingBadge.lateTitle", { n: lateCount })}
        >
          L{lateCount}
        </span>
      )}
    </>
  );
}

export default FlyingBadge;
