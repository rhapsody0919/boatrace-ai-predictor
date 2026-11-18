/**
 * MotorConditionChart - モーター調子（BOA-151）
 * 本日開催中の会場・レースを選ぶと、そのレースの枠番別モーター調子
 * （2連率/3連率）を一覧表示する。「このレースのどの艇のモーターが
 * 調子いいか」を直接示すことで、賭ける判断にそのまま使えるようにする。
 * 気になるモーターは節ごとの推移グラフにドリルダウンできる。
 */
// 区画のファイルへ移す前と CSS の重なりの順を同じにする（元はこの2つの部品を先に import していた）
import "../common/HorizontalScrollHint.css";
import "../racer/RacerGradeBadge.css";
import { useTranslation } from "react-i18next";
import { useVenueRaceSelector } from "../../hooks/useVenueRaceSelector";
import { useHorizontalScrollHint } from "../../hooks/useHorizontalScrollHint";
import {
  useBreakdownLoad,
  useDrillLoad,
  useMotorStates,
  usePeriodAndWakuReset,
} from "./motorConditionLoad";
import { useMotorView } from "./motorConditionView";
import {
  MotorSelectors,
  MotorTitle,
  PeriodControls,
} from "./MotorConditionControls";
import { MotorFooterNotes, MotorMain } from "./MotorConditionDrill";
import "./MotorConditionChart.css";
import "../common/HorizontalScrollHint.css";

function MotorConditionChart({
  initialVenueCode = null,
  initialRaceId = null,
  initialMotorNumber = null,
  embedded = false,
  // レース詳細で「今どの艇を見ているか」をタブ間で共有する（BOA-492/BOA-494）。
  // /winning-technique は渡さないので、そちらの挙動は変わらない
  focusedBoat = null,
  onFocusBoat = null,
}) {
  const { t } = useTranslation();
  const selector = useVenueRaceSelector({ initialVenueCode, initialRaceId, embedded, t });
  const states = useMotorStates(initialMotorNumber);
  const m = { ...selector, ...states, t, embedded, focusedBoat, onFocusBoat };
  useBreakdownLoad(m);
  useDrillLoad(m);
  usePeriodAndWakuReset(m);
  const v = useMotorView(m);
  // 9列の表は390pxでは右が切れる。切れていることに気づけるようにする
  // 会場内順位の列は一覧の後から足される（BOA-428）。足されたときに測り直す
  const rankingScroll = useHorizontalScrollHint([
    m.breakdown.length,
    m.venueRanks?.state,
  ]);
  const scroll = {
    hasMore: rankingScroll.hasMore,
    hasLess: rankingScroll.hasLess,
    scrollRight: rankingScroll.scrollRight,
    scrollLeft: rankingScroll.scrollLeft,
    update: rankingScroll.update,
  };

  return (
    <div className="motor-condition-container">
      {!embedded && <MotorTitle />}
      {!embedded && <MotorSelectors m={m} venueOffToday={v.venueOffToday} />}
      <PeriodControls m={m} v={v} />
      <MotorMain m={m} v={v} scroll={scroll} scrollRef={rankingScroll.ref} />
      <MotorFooterNotes m={m} v={v} />
    </div>
  );
}

export default MotorConditionChart;
