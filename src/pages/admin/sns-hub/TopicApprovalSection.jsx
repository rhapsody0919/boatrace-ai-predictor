// 「ネタ承認」区画とネタ型設定（手動承認のページ）。SnsHubAdmin.jsx から切り出し
import { useState, useEffect } from "react";
import {
  triggerWeeklyProposer,
  triggerDailyAutoProposer,
} from "../../../services/snsHubService";
import {
  TOPIC_REJECTION_REASONS,
  PERMANENTLY_EXCLUDED_CATEGORY_KEYS,
  PLATFORM_LABELS,
} from "./constants.js";
import { formatDateTime, isTodayJST } from "./utils";
import {
  ApproverChips,
  RevisionPanel,
  TextDraftPreview,
  VideoPreview,
  ContentTypeBadge,
  ChannelTargetToggle,
} from "./DraftCard.jsx";

// PLATFORM_TABSと同じ表示順・ラベルを使う（sns_target_accounts.platformの語彙と一致）
const CATEGORY_CHANNEL_PLATFORMS = ["blog", "note", "x", "youtube"];
const CATEGORY_CHANNEL_LABELS = {
  blog: "Blog",
  note: "Note",
  x: "X",
  youtube: "YouTube",
};

// ネタの型（会場特性・選手調子・イン崩れ注意度等）×チャネルのON/OFF設定画面。
// 型ごとにチャネル可否を人間が直接編集できるようにする（各Routineの
// プロンプト文言に散在していた判断をデータに寄せる）
function TopicCategorySettingsTab({ categories, onToggleChannel }) {
  if (categories.length === 0) {
    return (
      <div className="empty-state">
        <p>登録されているネタの型はありません。</p>
      </div>
    );
  }

  return (
    <div className="topic-category-settings">
      <p className="topic-category-settings-hint">
        ネタの型ごとに、各チャネルへの生成対象可否を設定できます。プラットフォームのガイドライン上センシティブな型は、実績を見ながら個別に調整してください。廃止済みの型は行がグレーアウトします。
      </p>
      <p className="topic-category-settings-hint">
        例1: 「イン崩れ注意度」でYouTubeの投稿が制限を受けた
        →「イン崩れ注意度」行のYouTube列をOFFにする（他チャネルはそのまま）。
        例2: 「豆知識型」は成績・確率と無関係
        →全チャネルONのままでよい。ℹ️アイコンがある行は除外理由をホバーで確認できる。
      </p>
      <div className="topic-category-settings-scroll">
        <table className="topic-category-settings-table">
          <thead>
            <tr>
              <th>型</th>
              <th>頻度区分</th>
              {CATEGORY_CHANNEL_PLATFORMS.map((platform) => (
                <th key={platform}>{CATEGORY_CHANNEL_LABELS[platform]}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {categories.map((category) => (
              <tr
                key={category.id}
                className={
                  category.active
                    ? "topic-category-row"
                    : "topic-category-row topic-category-row-inactive"
                }
              >
                <td className="topic-category-label-cell">
                  <span className="topic-category-label">{category.label}</span>
                  {!category.active && (
                    <span className="topic-category-inactive-badge">
                      廃止済み
                    </span>
                  )}
                  {category.notes && (
                    <span
                      className="topic-category-notes"
                      title={category.notes}
                    >
                      ℹ️
                    </span>
                  )}
                </td>
                <td className="topic-category-cadence-cell">
                  {category.sns_content_types?.label || "未接続"}
                </td>
                {CATEGORY_CHANNEL_PLATFORMS.map((platform) => {
                  const channel = (
                    category.sns_topic_category_channels || []
                  ).find((c) => c.platform === platform);
                  const enabled = channel?.enabled ?? false;
                  return (
                    <td key={platform} className="topic-category-channel-cell">
                      <button
                        type="button"
                        className={`topic-category-channel-toggle${
                          enabled ? " on" : " off"
                        }`}
                        disabled={!category.active || !channel}
                        onClick={() =>
                          onToggleChannel(category.id, platform, !enabled)
                        }
                      >
                        {enabled ? "ON" : "OFF"}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// RevisionPanel（mode="topic-reject"）のreasonCodes/freeTextを、却下理由の
// 表示文字列に変換する共通関数（2026-09-04、コードレビューで指摘: TopicCard/
// TopicFanoutCardで一字一句同じロジックが重複しており、片方だけ修正されて
// もう一方に伝播しない不具合の温床になっていた。sns-content-generation.mdの
// 「片方のパイプラインだけ実装され他方に伝播しない」既知パターンと同種）
function buildTopicRejectionReason(reasonCodes, freeText) {
  const reasonLabels = reasonCodes
    .map((code) => TOPIC_REJECTION_REASONS.find((r) => r.code === code)?.label)
    .filter(Boolean);
  return [reasonLabels.join("、"), freeText.trim()].filter(Boolean).join(" / ");
}

// 「ネタ承認」タブの個別ネタカード（screens.md #3）。TextDraftPreview/VideoPreview
// とは別役割（動画・本文のプレビューでなく、ネタ本文＋メタ情報の確認）のため
// 軽量な新規実装とする
function TopicCard({
  topic,
  approvers,
  onApprove,
  onReject,
  onUpdateTargetLabel,
}) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers[0]?.id || null,
  );
  const targets = topic.sns_topic_targets || [];
  // 却下理由の入力パネル。即時却下ではなく、簡単な理由フィードバックを
  // 挟めるようにする（2026-09-04ユーザー要望）。draft revise/redoと同じ
  // RevisionPanel（チップ選択+自由記述）をTOPIC_REJECTION_REASONSで流用し、
  // タップだけで理由を選べるようにする（自由記述だけだと面倒との指摘）
  const [showRejectPanel, setShowRejectPanel] = useState(false);

  return (
    <div className="topic-card">
      <div className="topic-card-badges">
        {topic.sns_content_types && (
          <ContentTypeBadge contentType={topic.sns_content_types} />
        )}
      </div>
      <p className="topic-card-text">{topic.topic_text}</p>
      <p className="topic-card-meta">
        提案: {formatDateTime(topic.proposed_at)}
        {topic.source_insight_ids?.length > 0 &&
          ` ・根拠insight ${topic.source_insight_ids.length}件`}
      </p>
      <ChannelTargetToggle
        targets={targets}
        onToggle={(targetId, status) =>
          onUpdateTargetLabel(topic.id, targetId, status)
        }
      />
      <ApproverChips
        approvers={approvers}
        selectedId={selectedApproverId}
        onSelect={setSelectedApproverId}
      />
      {showRejectPanel ? (
        <RevisionPanel
          mode="topic-reject"
          reasons={TOPIC_REJECTION_REASONS}
          onCancel={() => setShowRejectPanel(false)}
          onSubmit={({ reasonCodes, freeText, saveAsInsight }) => {
            const reason = buildTopicRejectionReason(reasonCodes, freeText);
            onReject(topic.id, selectedApproverId, reason, saveAsInsight);
            setShowRejectPanel(false);
          }}
        />
      ) : (
        <div className="topic-card-actions">
          <button
            type="button"
            className="topic-approve-btn"
            onClick={() => onApprove(topic.id, selectedApproverId)}
          >
            ✅ 承認
          </button>
          <button
            type="button"
            className="topic-reject-btn"
            onClick={() => setShowRejectPanel(true)}
          >
            却下
          </button>
        </div>
      )}
    </div>
  );
}

// 承認済みネタ×アカウントの生成状況をカード形式で表示する（要件15、screens.md #6）
// 元はtable実装だったが、実データの長文topic_text（80〜100字の完全な文）で
// セルがoverflowし隣接セルと視覚的に重なる不具合が発生したため、
// カード（topic_textは通常のブロック要素として自然に折り返す）+
// チャネルステータスをchip群で並べる形に再設計した（2026-09-04）
// 承認済みネタ1件×アカウントのチャネル別生成状況チップ。sns-hub UI再設計
// （2026-09-04、要件26/27）で🌅当日の運用・📦ネタのストック管理どちらの
// ブロックでも同じカード構造を使う共通部品にした
function TargetChip({ target, topicId, onFireTarget, firingTargetId }) {
  const label = PLATFORM_LABELS[target.sns_target_accounts?.platform] || "?";
  if (target.status === "generated") {
    return <span className="ch-chip ch-chip-ready">✓ {label} 生成済み</span>;
  }
  if (target.status === "claimed") {
    return <span className="ch-chip ch-chip-wait">{label} 生成中</span>;
  }
  if (target.status === "skipped") {
    return (
      <span
        className="ch-chip ch-chip-dim"
        title={target.skip_reason || undefined}
      >
        {label} 対象外
      </span>
    );
  }
  // pending
  return (
    <span className="ch-chip ch-chip-wait">
      {label} 待機中
      <button
        type="button"
        className="ch-chip-fire"
        disabled={firingTargetId === target.id}
        title="対象チャネルのパイプラインを今すぐ起動します（放っておいても通常のポーリングでいずれ生成されます）"
        onClick={() => onFireTarget(topicId, target.id)}
      >
        {firingTargetId === target.id ? "⏳" : "⚡今すぐ"}
      </button>
    </span>
  );
}

// onReject/approversは「📦ネタのストック管理」（承認済みネタ）でのみ渡す。
// 「🌅当日の運用」（自動承認・即日消化）は却下UIを出さない（2026-09-04、
// 要件: 承認済みネタを却下できるようにする。生成済みターゲットに紐づく
// 下書きは連動して非表示にせず、運用者が下書きタブで個別にarchiveする
// 最小実装とする方針）
function TopicFanoutCard({
  topic,
  onFireTarget,
  firingTargetId,
  onReject,
  approvers,
}) {
  const [selectedApproverId, setSelectedApproverId] = useState(
    approvers?.[0]?.id || null,
  );
  const [showRejectPanel, setShowRejectPanel] = useState(false);
  // claimed（生成中）・generated（生成済み）のターゲットが既にある場合、
  // reject.jsのコメント通り却下してもバックグラウンドの生成は止まらない。
  // この既知の制約をUIで初めて明示する（2026-09-04、UI/UXレビュー指摘:
  // 後戻りしにくい操作なのに副作用が画面のどこにも表示されていなかった）
  const targets = topic.sns_topic_targets || [];
  const hasInFlightTarget = targets.some(
    (t) => t.status === "claimed" || t.status === "generated",
  );

  return (
    <div className="mini-card">
      <p className="mini-card-topic">{topic.topic_text}</p>
      <div className="chip-row">
        {targets.map((target) => (
          <TargetChip
            key={target.id}
            target={target}
            topicId={topic.id}
            onFireTarget={onFireTarget}
            firingTargetId={firingTargetId}
          />
        ))}
      </div>
      {onReject &&
        (showRejectPanel ? (
          <>
            <p className="topic-reject-warning">
              {hasInFlightTarget
                ? "⚠️ 生成中/生成済みのチャネルがあります。却下してもその生成は止まりません。生成済みの下書きは各プラットフォームタブで個別にarchiveしてください。"
                : "却下すると承認状態が取り消されます。まだ生成されていないチャネルは以後生成されなくなります。"}
            </p>
            <RevisionPanel
              mode="topic-reject"
              reasons={TOPIC_REJECTION_REASONS}
              onCancel={() => setShowRejectPanel(false)}
              onSubmit={({ reasonCodes, freeText, saveAsInsight }) => {
                const reason = buildTopicRejectionReason(reasonCodes, freeText);
                onReject(topic.id, selectedApproverId, reason, saveAsInsight);
                setShowRejectPanel(false);
              }}
            />
          </>
        ) : (
          <div className="mini-card-actions">
            <ApproverChips
              approvers={approvers}
              selectedId={selectedApproverId}
              onSelect={setSelectedApproverId}
            />
            <button
              type="button"
              className="topic-withdraw-btn"
              onClick={() => setShowRejectPanel(true)}
            >
              却下（承認取り消し）
            </button>
          </div>
        ))}
    </div>
  );
}

// 「ネタ承認」タブ本体（screens.md #2）。status='proposed'（承認要否の型のみ）を
// 一覧表示し、承認済みネタの進捗マトリクスも合わせて表示する
// タブではなく専用セクションとして、下書き承認タブ群(TABS)の上に常時表示する
// （2026-09-03ユーザー指摘: 「承認→各プラットフォームタブに生成される」という
// 流れが、同列の1タブに埋もれると分かりにくいため）
// ネタ提案Routine（週次・日次いずれも）の手動起動状態を管理する共通フック。
// 通常cronのみで動くRoutineを、承認済みストックが少ない・動作確認したい場面で
// 即時起動できるようにする（2026-09-04追加、週次で先に実装し日次追加時に
// フック化した）。この状態はTopicApprovalSection自身に閉じているため、他の
// 生成系ボタン（親コンポーネント側）と違い親のstateには持ち上げない
// expectedCount: このトリガーで何件の新規ネタ登録を待つか。週次(最大10件)は
// 「新規1件検知で即完了扱い」にすると9件を確認しないまま自動更新が止まって
// しまうため、日次自動提案(常に1件)と挙動を分けている（2026-09-05）。
// matchesTopic: topics配列は週次・日次両プロポーザーで共有しているため、
// 他方が同時に作成したネタを誤ってカウントしないよう、自分のcontent_type
// 由来のネタだけに絞り込むための述語（コードレビューで指摘、2026-09-05）。
// maxWaitMinutesは、想定件数に届かないまま（候補切れ・エラー等で）ポーリング
// し続けることを避けるための上限。quietMinutesは、複数件(expectedCount>1)を
// 待つ場合に、1件以上登録できた後にしばらく新規登録が無ければ「候補切れ等で
// 正常終了した」とみなして想定件数未達のままmaxWaitMinutesを待たずに確認を
// 打ち切るための閾値（週次ドキュメント上、候補切れで10件未満のまま終わるのが
// 正常挙動のため。コードレビューで指摘、2026-09-05）
function useTopicProposerTrigger({
  triggerFn,
  topics,
  showToast,
  label,
  expectedCount = 1,
  matchesTopic = () => true,
  quietMinutes = 4,
  maxWaitMinutes = 20,
}) {
  const [triggering, setTriggering] = useState(false);
  const [locked, setLocked] = useState(false);
  const [sessionUrl, setSessionUrl] = useState(null);
  const [firedAt, setFiredAt] = useState(null);
  const [lastActivityAt, setLastActivityAt] = useState(null);
  const [elapsedMinutes, setElapsedMinutes] = useState(0);
  const [idsAtFire, setIdsAtFire] = useState(null);
  const [registeredCount, setRegisteredCount] = useState(0);

  function reset() {
    setLocked(false);
    setSessionUrl(null);
    setFiredAt(null);
    setLastActivityAt(null);
    setIdsAtFire(null);
    setRegisteredCount(0);
  }

  async function trigger(arg) {
    setTriggering(true);
    try {
      const result = await triggerFn(arg);
      if (result?.routine?.fired === false) {
        showToast(
          `起動リクエストがRoutineに届いていません（${result.routine.reason}）。Vercel環境変数の設定を確認してください`,
          "error",
        );
      } else {
        showToast(
          result.routine.sessionUrl
            ? `${label}を起動しました。実行ログのリンクは下に表示されます`
            : `${label}を起動しました。数分後に更新ボタンで確認してください`,
          "success",
        );
        const now = Date.now();
        setLocked(true);
        setSessionUrl(result.routine.sessionUrl || null);
        setFiredAt(now);
        setLastActivityAt(now);
        setElapsedMinutes(0);
        setIdsAtFire(new Set(topics.filter(matchesTopic).map((t) => t.id)));
        setRegisteredCount(0);
      }
    } catch (err) {
      console.error(`${label}起動リクエストエラー:`, err);
      showToast(err.message || "起動リクエストに失敗しました", "error");
    } finally {
      setTriggering(false);
    }
  }

  // 経過時間の更新と、長時間・無音状態が続いた場合の打ち切り判定を30秒おきに行う
  useEffect(() => {
    if (!locked || !firedAt) return;
    const interval = setInterval(() => {
      const now = Date.now();
      setElapsedMinutes(Math.max(0, Math.round((now - firedAt) / 60000)));

      if (
        expectedCount > 1 &&
        registeredCount > 0 &&
        lastActivityAt &&
        (now - lastActivityAt) / 60000 >= quietMinutes
      ) {
        showToast(
          `✅ ${registeredCount}件のネタ登録を確認し、その後新規登録が無いため確認を終了しました`,
          "success",
        );
        reset();
        return;
      }

      if ((now - firedAt) / 60000 >= maxWaitMinutes) {
        showToast(
          registeredCount > 0
            ? `⏱ ${maxWaitMinutes}分経過したため自動確認を終了します（${registeredCount}件確認済み）。続きは更新ボタンで確認してください`
            : `⏱ ${maxWaitMinutes}分経過しても新しいネタを確認できませんでした。実行ログを確認してください`,
          registeredCount > 0 ? "success" : "error",
        );
        reset();
      }
    }, 30000);
    return () => clearInterval(interval);
  }, [
    locked,
    firedAt,
    lastActivityAt,
    registeredCount,
    expectedCount,
    quietMinutes,
    maxWaitMinutes,
    showToast,
  ]);

  // 新規ネタ検知（matchesTopicで自分のcontent_type由来のものだけに絞り込む）。
  // 目標件数に届くまでは「n/m件確認済み」を都度通知しつつポーリングを継続し、
  // 届いた時点で完了扱いにしてポーリングを止める
  useEffect(() => {
    if (!locked || !idsAtFire) return;
    const newTopics = topics.filter(
      (t) => matchesTopic(t) && !idsAtFire.has(t.id),
    );
    if (newTopics.length === 0) return;

    const nextIds = new Set(idsAtFire);
    newTopics.forEach((t) => nextIds.add(t.id));
    const nextCount = registeredCount + newTopics.length;
    setIdsAtFire(nextIds);
    setRegisteredCount(nextCount);
    setLastActivityAt(Date.now());

    if (nextCount >= expectedCount) {
      showToast(
        expectedCount > 1
          ? `✅ ${nextCount}件のネタが登録されました`
          : "✅ 新しいネタが登録されました",
        "success",
      );
      reset();
    } else {
      showToast(
        `✅ ${nextCount}/${expectedCount}件のネタが登録されました（続けて確認します）`,
        "success",
      );
    }
  }, [
    topics,
    locked,
    idsAtFire,
    registeredCount,
    expectedCount,
    matchesTopic,
    showToast,
  ]);

  return {
    triggering,
    locked,
    sessionUrl,
    elapsedMinutes,
    registeredCount,
    expectedCount,
    trigger,
  };
}

export default function TopicApprovalSection({
  topics,
  approvers,
  onApprove,
  onReject,
  onUpdateTargetLabel,
  onFireTarget,
  topicCategories,
  onToggleCategoryChannel,
  onReloadTopics,
  showToast,
}) {
  // 承認要否（sns_content_types.requires_topic_approval）で🌅当日の運用／
  // 📦ネタのストック管理の2ブロックに分ける（要件27、2026-09-04再設計）。
  // 裏側のデータはどちらも同じsns_topics/sns_topic_targetsで、分岐点は
  // この1フラグだけ。トピックはgetTopics()で全期間分取得されるため、期間・
  // 完了状態で絞らないと「本日」ラベルが嘘になり、両ブロックとも過去の
  // 完了済みネタが無期限に積み上がる（2026-09-04、コードレビューで発覚）
  const directTopics = topics.filter(
    (t) =>
      t.status === "approved" &&
      t.sns_content_types?.requires_topic_approval === false &&
      isTodayJST(t.approved_at || t.proposed_at),
  );
  const gateProposedTopics = topics.filter((t) => t.status === "proposed");
  // 「承認済み・生成中」を名乗る以上、全ターゲットがgenerated/skippedで
  // 完結したネタは表示対象から外す（下書き自体は各プラットフォームタブに
  // 残るため情報は失われない）
  const gateApprovedTopics = topics.filter(
    (t) =>
      t.status === "approved" &&
      t.sns_content_types?.requires_topic_approval === true &&
      (t.sns_topic_targets || []).some(
        (target) => target.status === "pending" || target.status === "claimed",
      ),
  );
  const directTargets = directTopics.flatMap((t) => t.sns_topic_targets || []);
  const directGeneratedCount = directTargets.filter(
    (t) => t.status === "generated",
  ).length;

  // 「ネタ型設定」は🌅/📦どちらのブロックからも開閉できるが、実体は
  // sns_topic_categories全体を扱う単一パネル（要件27の設計判断）
  const [showCategorySettings, setShowCategorySettings] = useState(false);
  // 「⚡今すぐ生成」の発火中状態。target.id単位で管理し、他のターゲットの
  // ボタン操作をブロックしないようにする。🌅/📦両ブロックのカードで共有する
  const [firingTargetId, setFiringTargetId] = useState(null);
  // 日次ネタ自動提案の型（カテゴリ）を人間が優先指定できるようにする
  // （2026-09-04、2026-09-02に一度実装された機能がsns-topic-gate移行時に
  // UIごと削除されていたため再接続。空文字はRoutine側の自動選定に委ねる
  // 「おまかせ」を意味する）。対象は🌅当日の運用（daily-auto/
  // race-time-critical型）のうちactiveなもののみ
  const [selectedDailyCategoryKey, setSelectedDailyCategoryKey] = useState("");
  const dailyAutoCategoryOptions = topicCategories.filter(
    (c) =>
      c.active &&
      ["daily-auto", "race-time-critical"].includes(
        c.sns_content_types?.type_key,
      ) &&
      !PERMANENTLY_EXCLUDED_CATEGORY_KEYS.includes(c.category_key),
  );
  // 週次ネタ提案の型（カテゴリ）を人間が優先指定できるようにする（2026-09-06、
  // ユーザー要望。日次ネタ自動提案の型指定と同じ仕組みをvenue-feature型にも
  // 展開した）。空文字はRoutine側の交互取り出し自動選定（従来通り）を意味する
  const [selectedWeeklyCategoryKey, setSelectedWeeklyCategoryKey] =
    useState("");
  const weeklyCategoryOptions = topicCategories.filter(
    (c) =>
      c.active &&
      c.sns_content_types?.type_key === "venue-feature" &&
      !PERMANENTLY_EXCLUDED_CATEGORY_KEYS.includes(c.category_key),
  );

  const weeklyProposer = useTopicProposerTrigger({
    triggerFn: triggerWeeklyProposer,
    topics,
    showToast,
    label: "週次ネタ提案",
    expectedCount: 10,
    // このRoutineは常にvenue-feature型のみを登録する（手順書参照）
    matchesTopic: (t) => t.sns_content_types?.type_key === "venue-feature",
  });
  const dailyAutoProposer = useTopicProposerTrigger({
    triggerFn: triggerDailyAutoProposer,
    topics,
    showToast,
    label: "日次ネタ自動提案",
    // trigger_mode='auto'のカテゴリ（racer-condition等）のみを登録する。
    // race-time-critical型（🌅ボタンとは別の手動発火、trigger_mode='manual'）
    // と区別するため type_key ではなく trigger_mode で絞り込む
    matchesTopic: (t) => t.sns_content_types?.trigger_mode === "auto",
  });

  // ロック中（Routine実行中）は30秒おきにネタ一覧をポーリングする。
  // triggerFn自体は完了検知しないため、新規ネタの出現有無で判定する
  // （useTopicProposerTrigger側の完了検知useEffectとセット）
  useEffect(() => {
    if (!weeklyProposer.locked && !dailyAutoProposer.locked) return;
    const interval = setInterval(() => {
      onReloadTopics();
    }, 30000);
    return () => clearInterval(interval);
  }, [weeklyProposer.locked, dailyAutoProposer.locked, onReloadTopics]);

  async function handleFire(topicId, targetId) {
    setFiringTargetId(targetId);
    try {
      await onFireTarget(topicId, targetId);
    } finally {
      setFiringTargetId(null);
    }
  }

  return (
    <div className="topic-approval-section">
      <div className="topic-section-card topic-section-direct">
        <div className="topic-section-title">🌅 当日の運用</div>
        <p className="topic-section-desc">
          選手調子・モーター調子・イン崩れ・予想数値フック・的中 —
          自動承認、朝すぐ投稿できる状態を目指す
        </p>
        <div className="topic-stat-row">
          <span className="topic-stat-chip">
            <b>{directTopics.length}件</b>本日ネタ登録済み（自動承認）
          </span>
          {directTargets.length > 0 && (
            <span className="topic-stat-chip">
              <b>
                {directGeneratedCount}/{directTargets.length}
              </b>
              チャネル生成完了
            </span>
          )}
        </div>
        {directTopics.length === 0 ? (
          <p className="topic-section-empty">
            本日はまだネタが登録されていません
          </p>
        ) : (
          <div className="mini-card-list">
            {directTopics.map((topic) => (
              <TopicFanoutCard
                key={topic.id}
                topic={topic}
                onFireTarget={handleFire}
                firingTargetId={firingTargetId}
              />
            ))}
          </div>
        )}
        <div className="topic-section-btn-row">
          {dailyAutoCategoryOptions.length > 0 && (
            <select
              className="topic-section-category-select"
              value={selectedDailyCategoryKey}
              onChange={(e) => setSelectedDailyCategoryKey(e.target.value)}
              disabled={
                dailyAutoProposer.triggering || dailyAutoProposer.locked
              }
              aria-label="日次ネタ自動提案の型を指定"
            >
              <option value="">おまかせ（自動選定）</option>
              {dailyAutoCategoryOptions.map((c) => (
                <option key={c.id} value={c.category_key}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="topic-section-trigger-btn topic-section-trigger-direct"
            disabled={dailyAutoProposer.triggering || dailyAutoProposer.locked}
            onClick={() =>
              dailyAutoProposer.trigger(selectedDailyCategoryKey || undefined)
            }
          >
            {dailyAutoProposer.triggering
              ? "⏳ リクエスト中..."
              : "🌅 日次ネタ自動提案を今すぐ実行"}
          </button>
          <button
            type="button"
            className="topic-section-settings-btn"
            onClick={() => setShowCategorySettings((v) => !v)}
          >
            ⚙️ ネタ型設定
          </button>
        </div>
        {dailyAutoProposer.locked && (
          <div className="topic-section-proposer-hint">
            ⏳ 日次ネタ自動提案を実行中...（{dailyAutoProposer.elapsedMinutes}
            分経過）30秒おきに自動で確認します
            {dailyAutoProposer.sessionUrl && (
              <>
                {" ・ "}
                <a
                  href={dailyAutoProposer.sessionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  実行ログを見る
                </a>
              </>
            )}
          </div>
        )}
      </div>

      <div className="topic-section-card topic-section-gate">
        <div className="topic-section-title">📦 ネタのストック管理</div>
        <p className="topic-section-desc">
          会場特性・一覧アピール型など —
          承認して在庫を積む、時間制約なし。承認すると対応するチャネルタブ
          （下）に下書きが生成されます
        </p>
        <div className="topic-stat-row">
          <span className="topic-stat-chip">
            <b>{gateProposedTopics.length}件</b>承認待ち
          </span>
          <span className="topic-stat-chip">
            <b>{gateApprovedTopics.length}件</b>承認済み・生成中
          </span>
        </div>
        {gateProposedTopics.length === 0 && gateApprovedTopics.length === 0 ? (
          <p className="topic-section-empty">
            承認待ち・生成中のネタはありません
          </p>
        ) : (
          <div className="mini-card-list">
            {gateProposedTopics.map((topic) => (
              <TopicCard
                key={topic.id}
                topic={topic}
                approvers={approvers}
                onApprove={onApprove}
                onReject={onReject}
                onUpdateTargetLabel={onUpdateTargetLabel}
              />
            ))}
            {gateApprovedTopics.map((topic) => (
              <TopicFanoutCard
                key={topic.id}
                topic={topic}
                onFireTarget={handleFire}
                firingTargetId={firingTargetId}
                onReject={onReject}
                approvers={approvers}
              />
            ))}
          </div>
        )}
        <div className="topic-section-btn-row">
          {weeklyCategoryOptions.length > 0 && (
            <select
              className="topic-section-category-select"
              value={selectedWeeklyCategoryKey}
              onChange={(e) => setSelectedWeeklyCategoryKey(e.target.value)}
              disabled={weeklyProposer.triggering || weeklyProposer.locked}
              aria-label="週次ネタ提案の型を指定"
            >
              <option value="">おまかせ（自動選定）</option>
              {weeklyCategoryOptions.map((c) => (
                <option key={c.id} value={c.category_key}>
                  {c.label}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            className="topic-section-trigger-btn topic-section-trigger-gate"
            disabled={weeklyProposer.triggering || weeklyProposer.locked}
            onClick={() =>
              weeklyProposer.trigger(selectedWeeklyCategoryKey || undefined)
            }
          >
            {weeklyProposer.triggering
              ? "⏳ リクエスト中..."
              : "📅 週次ネタ提案を今すぐ実行"}
          </button>
          <button
            type="button"
            className="topic-section-settings-btn"
            onClick={() => setShowCategorySettings((v) => !v)}
          >
            ⚙️ ネタ型設定
          </button>
        </div>
        {weeklyProposer.locked && (
          <div className="topic-section-proposer-hint">
            ⏳ 週次ネタ提案を実行中...（{weeklyProposer.elapsedMinutes}
            分経過・{weeklyProposer.registeredCount}/
            {weeklyProposer.expectedCount}件確認済み）30秒おきに自動で確認します
            {weeklyProposer.sessionUrl && (
              <>
                {" ・ "}
                <a
                  href={weeklyProposer.sessionUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  実行ログを見る
                </a>
              </>
            )}
          </div>
        )}
      </div>

      {showCategorySettings && (
        <div className="topic-category-settings-panel">
          <TopicCategorySettingsTab
            categories={topicCategories}
            onToggleChannel={onToggleCategoryChannel}
          />
        </div>
      )}
    </div>
  );
}
