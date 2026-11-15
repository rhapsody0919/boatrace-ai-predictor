/**
 * RecentRunsBar - 直近10走の帯（phase a FR-1 / T3-4）
 *
 * 設計: docs/design/analysis-visualization-upgrade/screens.md §3.1.3
 *
 * 日和は表（枠・ST・モーター2連・着順の4列×10行）。龍神レーダーは
 * 1走＝1本の帯にして10走の流れを一目で見せる。
 *
 * ## モーター2連対率は出さない / ST順位を括弧で併記する
 *
 * 2026-09-23ユーザー決定。モーター2連対率は「その走のモーターの成績」であって
 * 選手の走りの情報ではなく、帯が読みにくくなるだけ。代わりに
 * **そのレース内でのST順位を「(1位)」の形で併記**する。STの絶対値だけだと
 * 「速いのか遅いのか」がレースの水面・風で変わるため、順位のほうが読める。
 *
 * Fの走はST順位を付けず「F」と出す（順位づけの対象外にしているため）。
 *
 * ## 各走がいつ・どこか（BOA-604、ユーザー承認の案 A＋D）
 *
 * タイルのいちばん上に月日（9/27）を出す。会場・R・種別はタイルに入れると
 * 375px（1枚 46px）で読めないので、タイルを押したとき帯の下に1行で出す。
 * 開いたときは最新の走を選んだ状態にする（以前は title 属性に raceId があるだけで、
 * タッチ端末では何も出なかった）。
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { RecentRunsTile, RecentRunsDetail } from "./RecentRunsBarParts";
import "./RecentRunsBar.css";

function RecentRunsBar({ runs }) {
  const { t } = useTranslation();
  const list = Array.isArray(runs) ? runs : [];
  // 選んでいる走（帯の下に会場・R・種別を出す）。既定は最新（右端）
  const [selectedId, setSelectedId] = useState(null);
  const selected =
    list.find((r) => r.raceId === selectedId) ?? list[list.length - 1] ?? null;
  // 古い順（左が古い）に並ぶので、横に収まらない幅では開いたときに右端（最新）を
  // 見せる。左端から見せると、いちばん知りたい直近の走が画面の外になる（BOA-601）
  const stripRef = useRef(null);
  const lastId = list[list.length - 1]?.raceId ?? null;
  // 左に隠れている（見えていない古い）走の本数。375pxでは10走のうち5〜6本しか
  // 見えず、「古い」の下が一番古い走だと読まれた（ファン評価3周目）ので、
  // 軸に「左にあと◯走」と出す
  const [hiddenOlder, setHiddenOlder] = useState(0);
  const measureHidden = useCallback(() => {
    const el = stripRef.current;
    if (!el) return;
    const left = el.getBoundingClientRect().left;
    const hidden = [...el.children].filter(
      (c) => c.getBoundingClientRect().left < left - 1,
    ).length;
    setHiddenOlder(hidden);
  }, []);
  useLayoutEffect(() => {
    const el = stripRef.current;
    if (el) el.scrollLeft = el.scrollWidth;
    measureHidden();
  }, [list.length, lastId, measureHidden]);
  if (list.length === 0) return null;

  return (
    <div className="rrb">
      <div className="rrb-axis">
        <span>
          {t("recentRuns.older")}
          {hiddenOlder > 0 && (
            <span className="rrb-hidden-older">
              {t("recentRuns.hiddenOlder", { n: hiddenOlder })}
            </span>
          )}
        </span>
        <span>{t("recentRuns.newer")}</span>
      </div>
      <div className="rrb-strip" ref={stripRef} onScroll={measureHidden}>
        {list.map((r) => (
          <RecentRunsTile
            key={r.raceId}
            r={r}
            isSelected={r.raceId === selected?.raceId}
            onSelect={setSelectedId}
          />
        ))}
      </div>
      {selected && <RecentRunsDetail selected={selected} />}
      <p className="rrb-legend">{t("recentRuns.legend")}</p>
    </div>
  );
}

export default RecentRunsBar;
