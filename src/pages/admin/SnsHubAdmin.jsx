/**
 * SnsHubAdmin - SNSマーケティングハブ管理画面の「手動承認」ページ
 * URL: /admin/sns-hub （middleware.jsでBasic認証保護）
 *
 * 人が承認するもの（ブログ・note、自動送信の対象外の X・YouTube の下書き）だけを置く。
 * ネタの承認・修正の依頼・制作仕様の変更要望の口は、直近30日の利用が0件のため撤去した（2026-10-24、hq SH01 R2）。
 * 戦略メモの採否は ADR-0030 の 2026-10-12 追記（オーナー決定: 手動の採用・却下ボタンは残す）があるので残した。
 * 自動送信の状況は /admin/sns-hub/auto、数字と戦略メモは /admin/sns-hub/metrics、
 * 資料は /admin/sns-hub/library に分けた（2026-10-18 オーナー決定。以前は1ページに全部あった）。
 * /today の個別承認の区画は、検査が通れば自動で送る決定に合わせて撤去した。
 */

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  getDrafts,
  getApprovers,
  approveDraft,
  publishYoutube,
  markDraftPosted,
  archiveDraft,
} from "../../services/snsHubService";
import { actionFeedback } from "./sns-hub/actionFeedback";
import Toast, { useToast } from "../../components/Toast";
import SnsHubLayout from "./sns-hub/SnsHubLayout.jsx";
import DraftCard from "./sns-hub/DraftCard.jsx";
import { errorMessageOf } from "../../utils/errorMessage.js";

// 2026-09-01、content-multi-channel-pipeline（spec.md FR6・screens.md）で
// プラットフォームを主タブ・ステータスを副フィルタにした。
// TikTok はアカウントが BAN されたためタブを外した（2026-10-18、Q2）。下書きのデータは DB に残る
const PLATFORM_TABS = [
  { id: "blog", label: "Blog" },
  { id: "note", label: "note" },
  { id: "x", label: "X" },
  { id: "youtube", label: "YouTube" },
];

const STATUS_FILTERS = [
  {
    id: "review",
    label: "承認待ち",
    statuses: ["pending_review", "revision_requested"],
  },
  {
    id: "readyToPost",
    label: "投稿準備完了",
    statuses: ["approved", "ready_to_post"],
  },
  { id: "posted", label: "投稿済み", statuses: ["posted"] },
];

const FULL_FETCH = {
  drafts: true,
  approvers: true,
};

function SnsHubAdmin() {
  const [actionMessages, setActionMessages] = useState([]);
  const [activeTab, setActiveTab] = useState("blog");
  const [activeStatusFilter, setActiveStatusFilter] = useState("review");
  const [drafts, setDrafts] = useState([]);
  const [approvers, setApprovers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const { toast, showToast } = useToast();
  // 下書きの読み込みの番号。操作の後の読み直しと「更新」等が重なったとき、後から届いた古い応答で
  // 新しい一覧を上書きしない（最後に始めた読み込みの結果だけを使う）
  const draftReadEpoch = useRef(0);

  // 同じネタ（content_group_id）から派生したYouTube下書きの公開URLの逆引き。
  // note下書きの投稿導線で「YouTube動画URLをコピー」ボタンを出すために使う（2026-09-03）
  const youtubeUrlByGroupId = useMemo(() => {
    const map = {};
    for (const d of drafts) {
      if (
        d.platform === "youtube" &&
        d.content_group_id &&
        d.source_data?.youtube_url
      ) {
        map[d.content_group_id] = d.source_data.youtube_url;
      }
    }
    return map;
  }, [drafts]);

  // silent=trueの場合、全画面ローディング表示を出さずに裏側でデータだけ更新する
  // （2026-08-31）。fetchで指定した種類だけを再取得する（2026-09-01）
  const loadDrafts = useCallback(
    async ({ silent = false, fetch: fetchScope = FULL_FETCH } = {}) => {
      if (!silent) {
        setLoading(true);
        setError(null);
      }
      const readEpoch = fetchScope.drafts ? ++draftReadEpoch.current : null;
      try {
        await Promise.all([
          fetchScope.drafts
            ? getDrafts().then((data) => {
                if (readEpoch === draftReadEpoch.current) setDrafts(data);
              })
            : null,
          fetchScope.approvers ? getApprovers().then(setApprovers) : null,
        ]);
      } catch (err) {
        console.error("下書き取得エラー:", err);
        // silent時は全画面エラー表示に切り替えず、アクション自体は成功して
        // いる可能性があるためトースト通知に留める
        if (silent) {
          showToast(`最新状態の取得に失敗しました: ${err.message}`, "error");
        } else {
          setError(errorMessageOf(err));
        }
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [showToast],
  );

  useEffect(() => {
    loadDrafts();
  }, [loadDrafts]);

  // reloadScope: このアクション後にloadDraftsへ渡すfetch指定。省略時はdraftsのみ
  async function handleAction(actionFn, args, reloadScope = { drafts: true }) {
    try {
      const result = await actionFn(...args);
      const messages = actionFeedback(result);
      setActionMessages((previous) => [...previous, ...messages]);
      showToast(
        messages.length ? "操作結果に警告があります" : "操作を反映しました",
        messages.length ? "error" : "success",
      );
      await loadDrafts({ silent: true, fetch: reloadScope });
    } catch (err) {
      console.error("アクションエラー:", err);
      setActionMessages((previous) => [
        ...previous,
        "操作に失敗しました。最新状態を確認してください。",
      ]);
      await loadDrafts({ silent: true, fetch: reloadScope });
      showToast("操作に失敗しました。最新状態を確認してください。", "error");
    }
  }

  if (loading) {
    return (
      <SnsHubLayout counts={{ manual: null }}>
        <div className="sns-hub-loading-state">
          <div className="spinner" />
          <p>データを読み込み中...</p>
        </div>
      </SnsHubLayout>
    );
  }

  if (error) {
    return (
      <SnsHubLayout counts={{ manual: null }}>
        <div className="sns-hub-error-state">
          <p>エラーが発生しました: {error}</p>
          <button onClick={() => loadDrafts()}>再読み込み</button>
        </div>
      </SnsHubLayout>
    );
  }

  const activeStatusDef = STATUS_FILTERS.find(
    (f) => f.id === activeStatusFilter,
  );
  const visibleDrafts = drafts.filter(
    (d) =>
      d.platform === activeTab && activeStatusDef.statuses.includes(d.status),
  );

  // ナビの「手動承認」の件数は、この画面が持つ最新の一覧から出す（操作のたびに追従させる）
  const manualCount = drafts.filter(
    (d) =>
      PLATFORM_TABS.some((tab) => tab.id === d.platform) &&
      STATUS_FILTERS[0].statuses.includes(d.status),
  ).length;

  return (
    <SnsHubLayout counts={{ manual: manualCount }}>
      {actionMessages.length > 0 && (
        <div className="sns-hub-error-state" role="alert">
          {actionMessages.map((message, index) => (
            <p key={index}>{message}</p>
          ))}
          <button onClick={() => setActionMessages([])}>通知を閉じる</button>
        </div>
      )}

      <div className="tab-navigation-row">
        <div className="sns-hub-tab-navigation">
          {PLATFORM_TABS.map((tab) => {
            // 件数は「承認待ち」だけ（対応が必要な件数という意味を保つため）
            const count = drafts.filter(
              (d) =>
                d.platform === tab.id &&
                STATUS_FILTERS[0].statuses.includes(d.status),
            ).length;
            return (
              <button
                key={tab.id}
                className={`sns-hub-tab-btn ${activeTab === tab.id ? "active" : ""}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label} ({count})
              </button>
            );
          })}
        </div>
        <button className="refresh-btn" onClick={() => loadDrafts()}>
          🔄 更新
        </button>
      </div>

      <div className="status-filter-row">
        {STATUS_FILTERS.map((filter) => {
          const count = drafts.filter(
            (d) =>
              d.platform === activeTab && filter.statuses.includes(d.status),
          ).length;
          return (
            <button
              key={filter.id}
              className={`status-filter-btn ${activeStatusFilter === filter.id ? "active" : ""}`}
              onClick={() => setActiveStatusFilter(filter.id)}
            >
              {filter.label} ({count})
            </button>
          );
        })}
      </div>

      <div className="sns-hub-tab-content">
        {visibleDrafts.length === 0 ? (
          <div className="empty-state">
            <p>該当する下書きはありません。</p>
          </div>
        ) : (
          <div className="draft-list">
            {visibleDrafts.map((draft) => (
              <DraftCard
                key={draft.id}
                draft={draft}
                youtubeUrl={youtubeUrlByGroupId[draft.content_group_id]}
                approvers={approvers}
                onXChanged={() =>
                  loadDrafts({ silent: true, fetch: { drafts: true } })
                }
                onApprove={(approverId) =>
                  handleAction(approveDraft, [draft.id, approverId])
                }
                onPublishYoutube={(approverId) =>
                  handleAction(publishYoutube, [draft.id, approverId])
                }
                onMarkPosted={() => handleAction(markDraftPosted, [draft.id])}
                onArchive={() => handleAction(archiveDraft, [draft.id])}
              />
            ))}
          </div>
        )}
      </div>

      <Toast
        message={toast.message}
        type={toast.type}
        visible={toast.visible}
      />
    </SnsHubLayout>
  );
}

export default SnsHubAdmin;
