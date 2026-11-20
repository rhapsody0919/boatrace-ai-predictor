/**
 * snsTodayPlanner.js の runTodayPlan から移した、決める側の段（時間の門・前の下書きの扱い・型の選び・本文の用意・画像）。
 * 振る舞いは元のまま。runTodayPlan がこの順に呼ぶ。
 */
import { pickTodayPost } from "./snsTodayVariants.js";
import { V3_BODY } from "./snsTodayDigestV3.js";
import {
  firstLine,
  sha256,
  todayCandidates,
  todayFeatured,
  typeAOf,
} from "./snsTodayPlannerParts.js";
import { shootCourseWinSheet } from "./snsTodayPlannerShots.js";

export const todayDone = (date, extra) => ({
  rowsWritten: extra.written ? 1 : 0,
  report: { items: [{ kind: "digest", date, ...extra }], alerts: [] },
});

/** 計画の時間より前は skipped。送る時刻を過ぎて、その日の下書きが無い（作れずに朝が終わった）。cron がその日1回だけ Slack に知らせる。該当しなければ null */
export async function windowOutcome(store, date, now, when, review) {
  if (now < new Date(when.plan_from))
    return { outcome: "skipped", reason: "outside_window" };
  if (!(now >= new Date(when.latest) && !review)) return null;
  const { draft } = await store.todayState(date);
  return draft
    ? { outcome: "skipped", reason: "outside_window" }
    : { outcome: "missed", reason: "no_draft_by_send_time" };
}

// 下書きを作った後に item の作成で落ちた（item が無い。返信の型なら返信の item も）ときは、同じ版でも作り直して item を作る
// 返信の型は、子の item が無い・親と状態が違う・親が自動で承認済み（notified）なのに子が親の job につながっていない
// （子の承認の前に関数が落ちた）ときも作り直す。「変化なし」で親だけが送られるのを防ぐ（system-architect の審査 P2-2）
function isReplyPending(existing) {
  if (existing.draft?.source_data?.content_type?.link_position !== "reply")
    return false;
  return !existing.reply?.item || replyOutOfSync(existing);
}

function replyOutOfSync(existing) {
  if (existing.reply.item.state !== existing.item?.state) return true;
  return (
    existing.item?.state === "notified" &&
    (!existing.reply.draft?.source_data?.deadline_queue?.parent_job_id ||
      // 子を親につないだ後、子の承認（job の作成）の前に落ちた（Codex の審査 P1）
      !["approved", "posted"].includes(existing.reply.draft?.status))
  );
}

// 型 v3 は材料を DB から読むので、一覧の版が同じでも本文が変われば（欠場・中止で選ぶ人やレースが変わる）作り直す。
// 比べるのは下書きを作ったときの送る時刻での本文（時刻が進んで締切の線が動いただけでは作り直さない）
// 送った・止めた item（manual・notified でない）は作り直さないので読まない。読んだ結果は下の本文に使い回す（/code-review の指摘）
async function checkV3Same(existing, { date, raceDb, t, api }) {
  const storedV3 = existing.draft?.source_data?.digest_v3;
  if (!storedV3 || !["manual", "notified"].includes(existing.item?.state))
    return { same: true, again: null };
  const again = await api.prepareTodayV3({
    date,
    sendAt: storedV3.send_at,
    raceDb,
    t,
    sent: existing.draft.source_data.content_type?.sent,
  });
  return {
    // 作れなくなった（載せたレースが全部中止など）ときは作り直さず、送る直前の検査（欠場・中止）に任せる
    same: !again.ok || sha256(again.text) === storedV3.text_sha256,
    again: { sendAt: storedV3.send_at, made: again },
  };
}

// held_manual（禁止表現）・止めた item は、版が変わっても作り直さない（オーナーの判断に回す）。
// 自動で承認した（notified）ものは作り直す（版が変わると送る直前の読み直しで止まるため。2026-10-18）。作り直すなら null
function stoppedOutcome(existing) {
  if (existing.item && !["manual", "notified"].includes(existing.item.state))
    return { outcome: "skipped", reason: `item_${existing.item.state}` };
  // 返信の子だけを止めた（stopped・held_manual）ときも、親を作り直さない（system-architect の審査 P3-1）
  if (
    existing.reply?.item &&
    !["manual", "notified"].includes(existing.reply.item.state)
  )
    return {
      outcome: "skipped",
      reason: `reply_item_${existing.reply.item.state}`,
    };
  return null;
}

/** 前の下書きがあるとき、作り直さない結果（unchanged・skipped）を決める。返り値 { extra（作り直すなら null）, v3Again } */
export async function existingOutcome({
  date,
  existing,
  revision,
  raceDb,
  t,
  api,
}) {
  let v3Again = null;
  if (
    existing.item &&
    !isReplyPending(existing) &&
    existing.draft?.source_data?.digest?.revision === revision
  ) {
    const v3 = await checkV3Same(existing, { date, raceDb, t, api });
    v3Again = v3.again;
    if (v3.same)
      return {
        extra: { outcome: "unchanged", item_id: existing.item?.id ?? null },
        v3Again,
      };
  }
  return { extra: stoppedOutcome(existing), v3Again };
}

// その日の型（PD02）。下書きができた後は、その日の型を変えない（作り直しでも同じ型。途中で列が変わっても返信の下書きを取り残さない）
// 型 v3 は見出しを持たない（heading null）ので、本文の型（body）で見分ける（/code-review の指摘）
export function pickedType(existing, date, deps) {
  const stored = existing.draft?.source_data;
  return (stored?.content_type?.heading ||
    stored?.content_type?.body === V3_BODY) &&
    stored?.today_variant
    ? {
        ...stored.content_type,
        variant: stored.today_variant,
        content_type: stored.content_type,
      }
    : pickTodayType(date, deps);
}

/**
 * 型 v3・型 b の中身を用意する。v3 を作れない・検査を通らない日は送らない（型 a・b へ倒さない。オーナー 11/4「v3 が入ったら a・b は送らない」）。
 * 型 b は材料・機械の検査がそろわない日は型 a で送り、理由を残す（/today は機械の検査が通れば自動で送るので、検査を通らない b は送らない）。
 * 返り値 { v3, courseWin, bFallback } か、送らないときの { extra }
 */
export async function prepareBody(picked, env) {
  const { digest, date, sendAt, raceDb, t, v3Again, revision, api } = env;
  let v3 = null;
  if (picked.body === V3_BODY) {
    v3 =
      v3Again?.sendAt === sendAt
        ? v3Again.made
        : await api.prepareTodayV3({
            date,
            sendAt,
            raceDb,
            t,
            sent: picked.variant.id,
          });
    if (!v3.ok)
      return {
        extra: { outcome: "skipped", reason: `v3:${v3.reason}`, revision },
      };
  }
  let courseWin = null;
  let bFallback = null;
  if (picked.body === "course_win") {
    const made = await api.prepareCourseWin(digest, {
      date,
      sendAt,
      raceDb,
      t,
    });
    if (made.ok) courseWin = made;
    else bFallback = made.reason;
  }
  return { v3, courseWin, bFallback };
}

// 比べの a の日: その日に b を出せたか（DB を読まない分）
function pairFeasibility(
  picked,
  fallbackReason,
  { digest, date, sendAt, t, api },
) {
  if (
    fallbackReason ||
    picked.content_type?.side !== "a" ||
    picked.content_type?.pair == null
  )
    return {};
  const f = api.courseWinFeasible(digest, { date, sendAt, t });
  return { b_feasible: f.ok, ...(f.ok ? {} : { b_reason: f.reason }) };
}

// 型 a の本文（今の型）。b を作れなかった日・b が撮れなかった日もここに来る
async function buildTypeA(fallbackReason, picked, env) {
  const { digest, date, sendAt, raceDb, t, loadVariants, api } = env;
  const base = fallbackReason ? typeAOf(loadVariants()) : picked;
  const url = api.todayTrackingUrl(date, "a");
  // 欠場・中止・締切を確かめられない候補は除く（区分の上限までは後ろの rank から補う）
  const featuredRow = todayFeatured(digest.rows, sendAt);
  const statuses = await api.pickRaceStatus(raceDb, [
    ...(featuredRow ? [featuredRow] : []),
    ...todayCandidates(digest.rows, sendAt),
  ]);
  const excluded = new Set(
    statuses
      .filter((p) => p.reason)
      .map((p) => `${p.race_id}:${p.boat_number}`),
  );
  const contentType = {
    ...picked.content_type,
    ...(fallbackReason
      ? { id: base.type_id, fallback_reason: `course_win:${fallbackReason}` }
      : {}),
    heading: base.heading,
    link_lead: base.link_lead ?? null,
    link_position: base.link_position,
    body: null,
    sent: "a",
    ...pairFeasibility(picked, fallbackReason, env),
  };
  const post = api.buildTodayPost(digest, {
    date,
    t,
    url: api.todayPostUrl(date, "a"),
    sendAt,
    excluded,
    heading: base.heading,
    linkLead: contentType.link_lead,
    linkPosition: contentType.link_position,
  });
  return {
    post,
    contentType,
    trackingUrl: url,
    variant: fallbackReason ? base.variant : picked.variant,
  };
}

// 型ごとの本文・追跡 URL・札・型の記録
export function chooseBody({ v3, courseWin, bFallback }, picked, env) {
  if (v3)
    return {
      post: { text: v3.text, reply: null, races: [], picks: v3.picks },
      trackingUrl: env.api.todayTrackingUrl(env.date, picked.variant.id),
      variant: picked.variant,
      contentType: {
        ...picked.content_type,
        heading: null,
        link_lead: null,
        link_position: "after_heading",
        body: V3_BODY,
        sent: picked.variant.id,
      },
    };
  if (courseWin)
    return {
      post: courseWin.post,
      trackingUrl: courseWin.url,
      variant: picked.variant,
      contentType: {
        ...picked.content_type,
        heading: picked.heading,
        link_lead: null,
        link_position: "end",
        body: "course_win",
        sent: "b",
      },
    };
  return buildTypeA(bFallback, picked, env);
}

/**
 * 画像を撮る。型 v3 は文だけ（画像なし）。型 b の撮影が失敗したら、図を待つのと同じ 7:30 までは次の回にやり直し、
 * 過ぎたら型 a で送る（その日を落とさない）。返り値 { shots, courseWin, bFallback, chosen } か、送らないときの { extra }
 */
export async function captureImages(state, picked, env) {
  const { headless, info, waitOver, revision } = env;
  let { courseWin, chosen, bFallback } = state;
  let shots = [];
  if (courseWin) {
    try {
      shots = await shootCourseWinSheet(headless, courseWin);
    } catch (error) {
      if (!waitOver)
        throw new Error(
          `course_win_sheet_not_ready（${firstLine(error.message)}${info()}）`,
        );
      bFallback = `sheet_capture_failed: ${firstLine(error.message)}`;
      courseWin = null;
      chosen = await buildTypeA(bFallback, picked, env);
      if (!chosen.post)
        return {
          extra: { outcome: "skipped", reason: "no_candidates", revision },
        };
    }
  }
  if (!courseWin && !state.v3) shots = await env.shootSonar(chosen.post, env);
  return { shots, courseWin, bFallback, chosen };
}

/**
 * その日の型を選ぶ（PD02）。型の列（store.typeSchedule）を読み、読めなければ config の案で送る（止めない。理由は fallback_reason）。
 * 返信（reply）は自動（mode=auto・自動送信の承認者あり）で、確認用の作り直しでないときだけ選べる（親から順につなぐのが自動の道だけのため）
 */
export async function pickTodayType(
  date,
  { store, loadVariants, replyAllowed },
) {
  const config = loadVariants();
  // 今の型（v3）の日は型の列を使わないので読まない（読めないときの誤った「config の案で送る」も出さない）
  const fixed = pickTodayPost(config, date, { allowReply: replyAllowed });
  if (fixed.body === V3_BODY) return fixed;
  let row = null;
  let scheduleError = null;
  if (store.typeSchedule) {
    try {
      row = await store.typeSchedule(date);
    } catch (error) {
      // 表がまだ無い（174 の適用前、PostgREST は 404）と、それ以外の読み取りの失敗を分ける
      scheduleError = /HTTP 404/.test(error.message)
        ? "schedule_unavailable"
        : "schedule_read_failed";
      console.error(
        `/today の型の列を読めない（config の案で送る）: ${error.message}`,
      );
    }
  }
  return pickTodayPost(config, date, {
    row,
    scheduleError,
    allowReply: replyAllowed,
  });
}
