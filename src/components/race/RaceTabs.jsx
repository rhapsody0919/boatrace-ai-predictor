/**
 * RaceTabs - レース詳細ページのタブ切り替え基盤（BOA-305）
 * 「ボートレース日和」風のタブ構成に、日和には無い龍神レーダー独自の
 * 「AI予想」タブ（BOA-346）を乗せる土台。どのタブをどの順で出すかは
 * 呼び出し側（`PredictionPanel.jsx`）が決める。並び順の根拠はそちらに書いてある。
 *
 * 非アクティブなタブのcontentはアンマウントする（EmbeddedAnalysisSectionと同じ
 * 遅延マウント方針）。裏側のデータ取得はwithCache（30分TTL）済みのため、
 * タブを行き来しても再取得コストは小さい
 *
 * onActiveTabChangeを渡すと、アクティブタブが変わるたび（初回マウント含む）に
 * 呼ばれる。PredictionPanel.jsxが「結果タブの時はDataRaceTable等の分析ツール群を
 * 隠す」ためにアクティブタブを外部で把握する目的で使う（BOA-305〜312フィードバック#7）
 *
 * ## 狭い画面での操作性（2026-09-26、ファン視点の指摘で追加）
 *
 * 390pxの画面で**完全に見えるタブは4つだけ**（実測: 可視334px / 全体613px）。
 * 「今節」を足して8タブになり、次の3つが実害として出たので対処した。
 *
 * 1. **押したタブが画面外のまま**だった（バーが自動スクロールしない）。
 *    アクティブの下線が見えず、今どのタブにいるか画面上の手がかりが無い
 *    → クリック時にそのタブをバーの中へ水平スクロールする
 * 2. **右に続くことを示す手がかりが無い**（フェードも矢印も無い）ので、
 *    5つ目以降のタブの存在に気づかれない
 *    → 右端にフェードを出す（スクロールしきったら消す）
 * 3. **タブを押しても内容が画面外**（タブバーはページ上から628px下にあり、
 *    切り替えても縦位置が変わらないため）
 *    → ユーザーの操作で切り替えたときだけ、タブバーの位置まで縦スクロールする
 *    （初回マウント・レース遷移では動かさない）
 */
import { useState, useEffect, useRef } from "react";
import { trackEvent } from "../../utils/analytics";
import "./RaceTabs.css";

function RaceTabs({ tabs, defaultTabId, onActiveTabChange }) {
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
  const barRef = useRef(null);
  const btnRefs = useRef({});
  // 右端の「›」（まだ右にタブがあることを示す）。スクロールしきったら消す
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    onActiveTabChange?.(activeTab?.id ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab?.id]);

  const updateHasMore = () => {
    const bar = barRef.current;
    if (!bar) return;
    setHasMore(bar.scrollWidth - bar.clientWidth - bar.scrollLeft > 4);
  };

  useEffect(() => {
    // マウント直後はまだレイアウトが確定しておらず scrollWidth が
    // clientWidth と同じに見えることがある（フェードが出ないまま固定される）。
    // 次のフレームでも測り直す
    updateHasMore();
    const raf = requestAnimationFrame(updateHasMore);
    window.addEventListener("resize", updateHasMore);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", updateHasMore);
    };
  }, [tabs.length]);

  // アクティブなタブをバーの中へ水平スクロールする（現在地を見せる）。
  // `scrollIntoView` はページ全体も動かしてしまうので、バーのscrollLeftだけ動かす
  useEffect(() => {
    const bar = barRef.current;
    const btn = btnRefs.current[activeTab?.id];
    if (!bar || !btn) return;
    const left = btn.offsetLeft;
    const right = left + btn.offsetWidth;
    // behavior は指定しない（＝即時）。動きを減らす設定の環境では
    // smooth 指定のスクロールが実行されないことがある
    if (left < bar.scrollLeft) {
      bar.scrollLeft = Math.max(0, left - 12);
    } else if (right > bar.scrollLeft + bar.clientWidth) {
      bar.scrollLeft = right - bar.clientWidth + 12;
    }
    updateHasMore();
  }, [activeTab?.id]);

  // 「›」を押したら1画面分ぶん右へ送る（指でスワイプできると気づかない人向け）
  const scrollRight = () => {
    const bar = barRef.current;
    if (!bar) return;
    bar.scrollLeft += Math.round(bar.clientWidth * 0.8);
    updateHasMore();
  };

  const handleSelect = (id) => {
    // どのタブが実際に押されているかを残す（BOA-454）。並び順を決めた根拠は
    // 8人パネルの仮説でしかなく、検証する手立てがこれまで何も無かった。
    // 初回マウント・レース遷移では送らない（ユーザーが選んだものだけ数える）。
    // `source` などGA4の予約語と衝突するパラメータ名は使わない
    // （PR #656 で、カスタムイベントの `source` がセッション流入元を汚染した）
    trackEvent("race_tab_select", {
      tab_id: id,
      from_tab_id: activeTab?.id ?? null,
      tab_count: tabs.length,
    });
    setActiveId(id);
    // タブバーはページ上から600px超の位置にあり、切り替えても縦位置が
    // 変わらないため「押した先が画面外」になる。**ユーザーの操作のときだけ**
    // バーの位置まで上げる（初回マウント・レース遷移では動かさない）
    const bar = barRef.current;
    if (bar && bar.getBoundingClientRect().top < 0) {
      window.scrollTo({
        top: bar.getBoundingClientRect().top + window.scrollY - 8,
      });
    }
  };

  return (
    <div className="race-tabs">
      <div className={`race-tabs-bar-wrap${hasMore ? " has-more" : ""}`}>
        <div
          className="race-tabs-bar"
          role="tablist"
          ref={barRef}
          onScroll={updateHasMore}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={tab.id === activeTab?.id}
              ref={(el) => {
                btnRefs.current[tab.id] = el;
              }}
              className={`race-tabs-btn${tab.id === activeTab?.id ? " is-active" : ""}`}
              onClick={() => handleSelect(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {hasMore && (
          <button
            type="button"
            className="race-tabs-more"
            onClick={scrollRight}
            /* 装飾兼ショートカット。タブ自体はキーボードのTabで辿れて
               ブラウザが勝手に可視域へ送るため、支援技術には出さない */
            aria-hidden="true"
            tabIndex={-1}
          >
            ›
          </button>
        )}
      </div>
      <div className="race-tabs-panel" role="tabpanel">
        {activeTab?.content}
      </div>
    </div>
  );
}

export default RaceTabs;
