import { useEffect, useId, useState } from "react";
import { useTranslation } from "react-i18next";
import InCautionCardMain from "./InCautionCardMain";
import InCautionCardSide from "./InCautionCardSide";
import { boat1Rank } from "../../utils/inCautionLevel";
import { getRaceExhibitionBasics } from "../../services/raceQueries2.js";
import { trackEvent } from "../../utils/analytics";
import { useVisibleOnce } from "../../hooks/useVisibleOnce";
import {
  cautionClickEvent,
  cautionVisibleEvent,
} from "../../utils/cautionEvents";
import "./InCautionCard.css";

/**
 * 直前情報で1号艇が欠場になったか（朝の生成の後の欠場。一覧・ホームは朝の値のまま、詳細だけカードを隠す。plan §1）。
 * 取得に失敗したときは分からないので隠さない（カードの値自体は朝の時点で正しい）
 */
function useBoat1Absent(raceId) {
  const [state, setState] = useState({ raceId: null, absent: false });
  useEffect(() => {
    if (!raceId) return undefined;
    let alive = true;
    getRaceExhibitionBasics(raceId)
      .then((rows) => {
        if (alive)
          setState({
            raceId,
            absent: rows.some((r) => r.boat === 1 && r.absent),
          });
      })
      .catch((error) => {
        // 補助の信号なので画面の失敗にはしない。原因を追えるよう記録だけ残す
        console.warn(
          `直前情報の欠場の取得に失敗（${raceId}）: ${error?.message}`,
        );
      });
    return () => {
      alive = false;
    };
  }, [raceId]);
  return state.raceId === raceId && state.absent;
}

/**
 * イン崩れ注意度のカード（BOA-822、screens S-1、承認モック mock/1-ai-tab-375.png）。AI予想タブの先頭に置く。
 * 値（inCaution）は朝の生成が保存した値をそのまま出す（段・%を画面でかけ直さない）。
 *
 * @param {{inCaution: object|null, players: object[], result: object|null, raceId: string,
 *   onOpenSonar: (() => void)|null}} props
 */
export default function InCautionCard({
  inCaution,
  players,
  result,
  raceId,
  onOpenSonar,
}) {
  const { t } = useTranslation();
  const titleId = useId();
  const boat1Absent = useBoat1Absent(inCaution ? raceId : null);
  const shown = inCaution && !boat1Absent ? inCaution : null;
  // 注意度（値が無い空の表示も）が画面に入ったら、レースごとに1回 caution_visible（BOA-822 task 27）
  const visibleRef = useVisibleOnce(
    raceId ? `race_detail|${raceId}` : null,
    () => {
      const ev = cautionVisibleEvent({
        surface: "race_detail",
        raceId,
        inCaution: shown,
      });
      if (ev) trackEvent(ev.name, ev.params);
    },
  );
  /** 注意度から次へ（ソナー・思考アシスト・/accuracy）。押した時点の段で送る */
  const sendClick = (target) => {
    const ev = cautionClickEvent({
      surface: "race_detail",
      target,
      raceId,
      inCaution: shown,
    });
    if (ev) trackEvent(ev.name, ev.params);
  };

  if (!shown) {
    return (
      <p className="in-caution-empty" role="status" ref={visibleRef}>
        {t("inCaution.empty")}
      </p>
    );
  }

  const finished = Boolean(result?.finished);
  const rank = finished ? boat1Rank(result) : null;

  return (
    <section
      className="in-caution-card"
      aria-labelledby={titleId}
      ref={visibleRef}
    >
      {/* 左（数字・棒・範囲）と右（理由・導線・免責）。1200px 以上で左右に並べる（承認モック 1-ai-tab-1440.png） */}
      <InCautionCardMain
        ic={inCaution}
        titleId={titleId}
        result={result}
        finished={finished}
        rank={rank}
      />
      <InCautionCardSide
        ic={inCaution}
        players={players}
        raceId={raceId}
        onOpenSonar={onOpenSonar}
        sendClick={sendClick}
      />
    </section>
  );
}
