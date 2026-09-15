/**
 * RaceTabs - レース詳細ページのタブ切り替え基盤（BOA-305）
 * 「ボートレース日和」風の8タブ構成のうち、データが揃っている3タブ
 * （基本情報/モータ情報/結果、BOA-306/308/312）を乗せる土台。
 * 残り5タブ（枠別情報/今節成績/直前情報/オッズ検索/オッズ一覧）はデータ未整備の
 * ため今回追加しない（`docs/design/scraping-full-coverage/`待ち、準備中タブも
 * 出さない）が、tabsに配列を足すだけで後から追加できる構成にしている。
 *
 * 非アクティブなタブのcontentはアンマウントする（EmbeddedAnalysisSectionと同じ
 * 遅延マウント方針）。裏側のデータ取得はwithCache（30分TTL）済みのため、
 * タブを行き来しても再取得コストは小さい
 */
import { useState, useEffect, useRef } from "react";
import "./RaceTabs.css";

function RaceTabs({ tabs, defaultTabId }) {
  const [activeId, setActiveId] = useState(defaultTabId ?? tabs[0]?.id);
  // レース遷移・結果確定でdefaultTabIdが変わった時だけ選択をリセットする
  // （タブを自分でクリックした後、無関係な再レンダーで勝手に戻らないようにする）
  const prevDefaultRef = useRef(defaultTabId);
  useEffect(() => {
    if (prevDefaultRef.current !== defaultTabId) {
      prevDefaultRef.current = defaultTabId;
      setActiveId(defaultTabId ?? tabs[0]?.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaultTabId]);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  return (
    <div className="race-tabs">
      <div className="race-tabs-bar" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={tab.id === activeTab?.id}
            className={`race-tabs-btn${tab.id === activeTab?.id ? " is-active" : ""}`}
            onClick={() => setActiveId(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>
      <div className="race-tabs-panel" role="tabpanel">
        {activeTab?.content}
      </div>
    </div>
  );
}

export default RaceTabs;
