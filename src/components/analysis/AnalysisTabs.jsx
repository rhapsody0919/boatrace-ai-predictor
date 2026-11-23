import { useEffect, useRef } from "react";
import { isInCautionEnabled } from "../../config/featureFlags";
import { TAB_GROUPS } from "./analysisTabGroups";


// BOA-822（機能フラグの側）: volatility タブのラベルは新しいキー。analysisPage.tabs.volatility を上書きすると
// ボット向けの静的ページ（generate-ai-snapshots.js）が公開前に変わる（plan「URL」、design-reviewer 指摘9）
const tabLabelKey = (key) =>
  key === "volatility" && isInCautionEnabled() ? "volatilityInCaution" : key;

const groupOfTab = (key) =>
  TAB_GROUPS.find((group) => group.tabs.includes(key))?.key ?? TAB_GROUPS[0].key;

// 選んだ項目が横の行の真ん中に来るように行だけを動かす（scrollIntoView はページも縦に動かすので使わない）。
// 位置は行からの差で測る（offsetLeft は行が position を持たないとページの左端からになる）
function centerIn(row, item) {
  if (!row || !item) return;
  const offset = item.getBoundingClientRect().left - row.getBoundingClientRect().left + row.scrollLeft;
  row.scrollLeft = offset - (row.clientWidth - item.offsetWidth) / 2;
}

function useCenterActive(chipsRef, rowRef, activeTab) {
  useEffect(() => {
    centerIn(rowRef.current, rowRef.current?.querySelector(".analysis-tab-btn.active"));
    centerIn(chipsRef.current, chipsRef.current?.querySelector(".analysis-group-chip.active"));
  }, [chipsRef, rowRef, activeTab]);
}

export default function AnalysisTabs({ t, activeTab, setActiveTab }) {
  const rowRef = useRef(null);
  const chipsRef = useRef(null);
  const activeGroup = groupOfTab(activeTab);
  useCenterActive(chipsRef, rowRef, activeTab);
  return (
    <nav className="analysis-tab-nav" aria-label={t("analysisPage.groupsLabel")}>
      <div className="analysis-group-chips" ref={chipsRef}>
        {TAB_GROUPS.map((group) => (
          <button
            key={group.key}
            type="button"
            className={`analysis-group-chip ${group.key === activeGroup ? "active" : ""}`}
            aria-pressed={group.key === activeGroup}
            onClick={() => {
              if (group.key !== activeGroup) setActiveTab(group.tabs[0]);
            }}
          >
            {t(`analysisPage.groups.${group.key}`)}
          </button>
        ))}
      </div>
      <div className="analysis-tabs" ref={rowRef}>
        {TAB_GROUPS.flatMap((group) =>
          group.tabs.map((key, index) => (
            <button
              key={key}
              type="button"
              className={[
                "analysis-tab-btn",
                activeTab === key ? "active" : "",
                group.key === activeGroup ? "" : "is-other-group",
                index === 0 ? "is-group-start" : "",
              ].join(" ")}
              onClick={() => setActiveTab(key)}
            >
              {t(`analysisPage.tabs.${tabLabelKey(key)}`)}
            </button>
          )),
        )}
      </div>
    </nav>
  );
}
