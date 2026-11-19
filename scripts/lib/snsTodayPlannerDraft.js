/**
 * snsTodayPlanner.js の runTodayPlan から移した、書く側（下書き・tracking・返信・item・自動の承認・Slack の知らせ）。
 * 振る舞い・書く順は元のまま。入口は writeTodayDraft（結果の extra を返す）。
 */
import { jstHm, todayUtmContent } from "./snsTodayPlannerParts.js";
import { sourceDataOf } from "./snsTodayPlannerSource.js";
import { autoApprove } from "./snsTodayPlannerAuto.js";

const upsertDraft = (store, existing, fields, when) =>
  existing.draft
    ? store.updateTodayDraft(existing.draft.id, fields)
    : store.insertDraft({
        content_group_id: crypto.randomUUID(),
        platform: "x",
        language: "ja",
        status: "pending_review",
        format: "today_digest",
        title: "本日のデータ一覧",
        hashtags: [],
        publish_blocked: false,
        publication_hold_reasons: [],
        send_lane: "A",
        scheduled_at: when.scheduled_at,
        ...fields,
      });

/** tracking を保存する。案の札を入れられたか（variantSaved）を返す */
async function saveTracking(trackingStore, row, variant) {
  try {
    await trackingStore.save(row);
    return Boolean(variant.uuid);
  } catch (error) {
    // 案の uuid の行が sns_template_variants にまだ無い（設定の uuid を先に入れた）ときだけ、札なしで保存して投稿は止めない。
    // 外部キー違反（PostgREST は 409）に限る。一時的な失敗は投げて次の回にやり直す（札を null に固定しない）。札は source_data.today_variant に残る
    if (!variant.uuid || !/HTTP 409|foreign key/i.test(error.message))
      throw error;
    console.error(
      `/today の tracking に案の札（${variant.uuid}）を入れられない。札なしで保存する: ${error.message}`,
    );
    await trackingStore.save({ ...row, template_variant_id: null });
    return false;
  }
}

async function saveTrackingAndLabel(cx, draft, releaseEvidence) {
  const { store, trackingStore, variant, date, contentType, trackingUrl } = cx;
  const trackingRow = {
    draft_id: draft.id,
    template_variant_id: variant.uuid,
    race_url: cx.api.todayUrl,
    tracking_url: trackingUrl,
    utm_source: "x",
    utm_medium: "social",
    utm_campaign: "today_digest",
    utm_content: todayUtmContent(date, contentType.sent),
    release_evidence: releaseEvidence,
  };
  const variantSaved = await saveTracking(trackingStore, trackingRow, variant);
  // 案の比較（管理画面の観測の CSV・比較）は下書きの template_variant_id を読むので、下書きにも入れる（承認の前なので承認は外れない）。
  // tracking に入った（行がある）ときだけ。入れられなければ下書きは札なしのまま（source_data.today_variant には残る）
  if (!variantSaved) return draft;
  return store
    .updateTodayDraft(draft.id, { template_variant_id: variant.uuid })
    .catch((error) => {
      console.error(
        `/today の下書きに案の札（${variant.uuid}）を入れられない: ${error.message}`,
      );
      return draft;
    });
}

/**
 * 返信（link_position=reply）: リンクだけの子の下書き。親の job ができるまで公開保留（子だけ先に承認されて単独の投稿にならない）。
 * 親と同じ版・締切・表示の確認を持つので、送る直前の検査（readCurrent）は親と同じに通る。thread_index は 0 のまま
 * （X の月の予約は thread_index=0 を URL つきの額で引く。子は URL つきなので、こちらに合わせる）
 */
async function saveReplyDraft(cx, draft, sourceData, replyRisk) {
  const { store, existing, post, date, when } = cx;
  const current = existing.reply?.draft ?? null;
  if (!post.reply) return current;
  const { image_paths: _images, ...rest } = sourceData;
  const replyFields = {
    caption_text: post.reply,
    source_data: {
      ...rest,
      race_id: `${date}-today-reply`,
      today_reply: { parent_draft_id: draft.id },
    },
    risk_flags: replyRisk,
    publish_blocked: true,
  };
  return current
    ? store.updateTodayDraft(current.id, replyFields)
    : store.insertDraft({
        content_group_id: draft.content_group_id,
        platform: "x",
        language: "ja",
        status: "pending_review",
        format: "today_digest",
        title: "本日のデータ一覧（返信のリンク）",
        hashtags: [],
        cover_image_path: null,
        publication_hold_reasons: [],
        send_lane: "A",
        scheduled_at: when.scheduled_at,
        ...replyFields,
      });
}

/** item の状態・検査・止めた理由 */
function itemStateOf({ risk, post, replyAllowed, revision, checkedAt }) {
  // 返信の型を引き継いだ作り直しで、自動でなくなっていたら（mode を manual に戻した等）送らない。親だけが承認されて
  // リンクの無い投稿が出るのを防ぐ（/code-review の指摘）
  const replyBlocked = Boolean(post.reply) && !replyAllowed;
  const state = risk.length || replyBlocked ? "held_manual" : "manual";
  const checks = {
    passed: risk.length === 0,
    risk: risk.map((r) => r.id),
    digest_revision: revision,
    display: { ok: true, checked_at: checkedAt },
    checked_at: checkedAt,
  };
  const heldReason = risk.length
    ? `禁止表現: ${checks.risk.join(",")}`
    : replyBlocked
      ? "返信の型は自動（mode=auto）の日だけ送れる"
      : null;
  return { state, checks, heldReason };
}

async function saveItems(cx, draft, replyDraft, { state, checks, heldReason }) {
  const { store, existing, post, date, when } = cx;
  const item = existing.item
    ? await store.updateItem(existing.item.id, existing.item.state, {
        state,
        checks,
        held_reason: heldReason,
      })
    : await store.insertItem({
        kind: "digest",
        draft_id: draft.id,
        channel: "x",
        race_id: `today:${date}`,
        deadline_at: when.deadline_at,
        notify_by: when.notify_by,
        veto_until: when.veto_until,
        state,
        checks,
        held_reason: heldReason,
      });
  const replyRow = {
    kind: "digest",
    channel: "x",
    race_id: `today:${date}:reply`,
    deadline_at: when.deadline_at,
    notify_by: when.notify_by,
    veto_until: when.veto_until,
  };
  let replyItem = existing.reply?.item ?? null;
  if (replyDraft && post.reply)
    replyItem = replyItem
      ? await store.updateItem(replyItem.id, replyItem.state, {
          state,
          checks,
          held_reason: heldReason,
        })
      : await store.insertItem({
          ...replyRow,
          draft_id: replyDraft.id,
          state,
          checks,
          held_reason: heldReason,
        });
  return { item, replyItem };
}

const DRY_RUN_NOTE = "。ただし試運転中なので claim の前で止まる";
const STOP_SQL =
  "止めるには: UPDATE public.sns_x_send_control SET paused = true WHERE id = true;";

// Slack の知らせの頭
function notifyHead({
  review,
  rebuilt,
  auto,
  autoError,
  state,
  control,
  when,
}) {
  if (review)
    return "確認用に今日の下書きを作り直した（送る時刻を過ぎているので、承認・送信はできない）";
  if (rebuilt)
    return "一覧がやり直されたので、画像と本文を作り直した（前の承認は外れた）。承認し直して";
  if (auto && !autoError)
    return `今日の投稿を ${jstHm(when.scheduled_at)} に自動で送る（承認なし${control.dry_run !== false ? DRY_RUN_NOTE : ""}）。${STOP_SQL}`;
  if (autoError)
    return `今日の投稿の自動の承認に失敗したので送らない: ${autoError}`;
  return state === "manual"
    ? "今日の投稿の下書きができたが、X は個別承認（mode=manual）なので送らない。自動で送るなら sns_auto_send_control の mode を auto にする"
    : "今日の投稿の下書きに禁止表現があり、止めた";
}

const notifyText = ({
  date,
  head,
  slotNote,
  bFallback,
  caption,
  post,
  images,
}) =>
  `SNS /today（${date}）: ${head}${slotNote ? `\n${slotNote}` : ""}${bFallback ? `\n（型 b の日だったが型 a で送る: ${bFallback}）` : ""}\n${caption}${post.reply ? `\n\n（自分への返信）${post.reply}` : ""}${images
    .filter(Boolean)
    .map((url, i) => `\n画像${i + 1}: ${url}`)
    .join("")}`;

async function sendNotice({ cx, parts, imagePaths }) {
  const { date, review, state, control, when, bFallback, post, notify } = cx;
  const { auto, autoError, slotNote } = parts;
  const images = await Promise.all(
    imagePaths.map((path) => cx.signImage(path).catch(() => null)),
  );
  // 承認を外したのは、item があった（＝前に Slack で知らせた）ときだけ
  const rebuilt = Boolean(cx.existing.draft && cx.existing.item);
  const head = notifyHead({
    review,
    rebuilt,
    auto,
    autoError,
    state,
    control,
    when,
  });
  try {
    await notify(
      notifyText({
        date,
        head,
        slotNote,
        bFallback,
        caption: post.text,
        post,
        images,
      }),
    );
  } catch (error) {
    console.error(`Slack に通知できません: ${error.message}`);
  }
  return rebuilt;
}

function resultExtra({ cx, rows, parts, rebuilt, draft }) {
  const { review, post, contentType, revision } = cx;
  const { auto, autoError } = parts;
  return {
    outcome: rebuilt ? "rebuilt" : auto && !autoError ? "notified" : cx.state,
    ...(autoError ? { reason: `auto_failed: ${autoError}` } : {}),
    ...(review ? { review: true } : {}),
    item_id: rows.item.id,
    draft_id: draft.id,
    ...(rows.replyDraft && post.reply
      ? { reply_draft_id: rows.replyDraft.id }
      : {}),
    content_type: contentType.id,
    ...(contentType.fallback_reason
      ? { type_fallback: contentType.fallback_reason }
      : {}),
    revision,
    written: true,
  };
}

/**
 * 画像を保存し、下書き・tracking・返信・item を書き、自動なら承認し、Slack に知らせる。結果の extra を返す。
 * cx: runTodayPlan が決めた物（store・existing・when・chosen の中身・shots・risk など）
 */
export async function writeTodayDraft(cx) {
  const { store, existing, date, when, now, revision, post } = cx;
  const caption = post.text;
  const replyRisk = cx.replyRisk;
  const risk = [...cx.riskOf(caption), ...replyRisk];
  const checkedAt = now.toISOString();
  const imagePaths = cx.courseWin
    ? [`today/${date}/${revision}-sheet.png`]
    : cx.shots.map((_, i) => `today/${date}/${revision}-${i + 1}.png`);
  for (const [i, png] of cx.shots.entries())
    await cx.saveImage(imagePaths[i], png);
  const sourceData = sourceDataOf({
    ...cx,
    imagePaths,
    checkedAt,
    raceCount: cx.digest.day.race_count ?? 0,
  });
  const fields = {
    caption_text: caption,
    cover_image_path: imagePaths[0] ?? null,
    source_data: sourceData,
    risk_flags: risk,
  };
  const releaseEvidence = sourceData.release_evidence;
  let draft = await upsertDraft(store, existing, fields, when);
  draft = await saveTrackingAndLabel(cx, draft, releaseEvidence);
  const replyDraft = await saveReplyDraft(cx, draft, sourceData, replyRisk);
  const stateOf = itemStateOf({
    risk,
    post,
    replyAllowed: cx.replyAllowed,
    revision,
    checkedAt,
  });
  const saved = await saveItems(cx, draft, replyDraft, stateOf);
  const auto = stateOf.state === "manual" && cx.replyAllowed;
  const acx = { ...cx, imagePaths, checkedAt };
  const rows = auto
    ? await autoApprove(acx, draft, { ...saved, replyDraft })
    : { ...saved, replyDraft, slotNote: null, autoError: null };
  const full = { ...cx, state: stateOf.state };
  const parts = { auto, autoError: rows.autoError, slotNote: rows.slotNote };
  const rebuilt = await sendNotice({ cx: full, parts, imagePaths });
  return resultExtra({ cx: full, rows, parts, rebuilt, draft });
}
