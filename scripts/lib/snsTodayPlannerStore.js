/**
 * snsTodayPlanner.js から移した、/today 計画の DB の道具（PostgREST の store）と朝の記録（nextTodayLog・finishTodayLog）。
 * 振る舞いは元のまま。snsTodayPlanner.js が同じ名前で再 export する。
 */
import { xSlotRoomVia } from "./snsXSlots.js";
import { TODAY_LATEST, firstLine, jstDate } from "./snsTodayPlannerParts.js";

// PostgREST の認証と、本文があるときの型の見出し
const restHeaders = (key, hasBody) => ({
  apikey: key,
  Authorization: `Bearer ${key}`,
  ...(hasBody
    ? { "Content-Type": "application/json", Prefer: "return=representation" }
    : {}),
});

/** PostgREST を呼ぶ関数（service_role）。失敗は握りつぶさず投げる */
function restCaller({ url, key, fetchImpl }) {
  return async function call(path, { method = "GET", body } = {}) {
    const hasBody = body !== undefined;
    const response = await fetchImpl(`${url}/rest/v1/${path}`, {
      method,
      headers: restHeaders(key, hasBody),
      body: hasBody ? JSON.stringify(body) : undefined,
    });
    if (!response.ok)
      throw new Error(
        `/today の計画の DB 操作に失敗: HTTP ${response.status} ${method} ${path.split("?")[0]}`,
      );
    const text = await response.text();
    return text ? JSON.parse(text) : null;
  };
}

const one = (rows, what) => {
  if (rows?.length !== 1)
    throw new Error(`${what}（条件に合う行が無い。他の操作と競合した）`);
  return rows[0];
};

// 親（本文）と返信（source_data.today_reply のある子、PD02）を分けて返す
const todayStateVia = (call) => async (date) => {
  const [drafts, items] = await Promise.all([
    call(
      `sns_drafts?send_lane=eq.A&format=eq.today_digest&source_data->digest->>date=eq.${date}&status=neq.archived&select=id,status,source_data&limit=4`,
    ),
    call(
      `sns_auto_send_items?kind=eq.digest&race_id=in.(${encodeURIComponent(`"today:${date}","today:${date}:reply"`)})&select=id,state,draft_id,race_id`,
    ),
  ]);
  const parents = drafts.filter((d) => !d.source_data?.today_reply);
  if (parents.length > 1) throw new Error(`/today の下書きが2件ある: ${date}`);
  const draft = parents[0] ?? null;
  const replies = drafts.filter(
    (d) => draft && d.source_data?.today_reply?.parent_draft_id === draft.id,
  );
  if (replies.length > 1)
    throw new Error(`/today の返信の下書きが2件ある: ${date}`);
  return {
    draft,
    item: items.find((i) => i.race_id === `today:${date}`) ?? null,
    reply: replies[0]
      ? {
          draft: replies[0],
          item: items.find((i) => i.race_id === `today:${date}:reply`) ?? null,
        }
      : null,
  };
};

/** PostgREST の読み書き（service_role）。失敗は握りつぶさず投げる */
export function createTodayStore({ url, key, fetchImpl = fetch }) {
  const call = restCaller({ url, key, fetchImpl });
  return {
    todayState: todayStateVia(call),
    // 型の列のその日の行（PD02、174）。無ければ null。表が無い（174 の適用前）は HTTP 404 で投げる（呼び出し側が config で送る）
    async typeSchedule(date) {
      const rows = await call(
        `sns_today_type_schedule?day=eq.${date}&select=day,type_id,post`,
      );
      return rows[0] ?? null;
    },
    insertDraft: async (row) =>
      one(
        await call("sns_drafts", { method: "POST", body: row }),
        "下書きを作れない",
      ),
    // 承認済みでも書き換える（148 のトリガーが承認を外し、待っている job を取り消す）。送信が始まったものは 148 が拒否する
    async updateTodayDraft(id, patch) {
      return one(
        await call(
          `sns_drafts?id=eq.${id}&status=in.(pending_review,approved)`,
          { method: "PATCH", body: patch },
        ),
        `下書き ${id} を書き換えられない`,
      );
    },
    insertItem: async (row) =>
      one(
        await call("sns_auto_send_items", { method: "POST", body: row }),
        "item を作れない",
      ),
    control: async () =>
      (
        await call(
          "sns_auto_send_control?channel=eq.x&select=mode,dry_run,auto_approver_id",
        )
      )[0] ?? null,
    approve: (args) =>
      call("rpc/approve_sns_x_send", { method: "POST", body: args }),
    // X の日の枠の取り置きの残り（182）
    xSlotRoom: xSlotRoomVia(call),
    async updateItem(id, fromState, patch) {
      return one(
        await call(`sns_auto_send_items?id=eq.${id}&state=eq.${fromState}`, {
          method: "PATCH",
          body: { ...patch, updated_at: new Date().toISOString() },
        }),
        `item ${id} を更新できない`,
      );
    },
  };
}

/**
 * /today の計画の各回の結果を、その日の分だけ残す（scrape_job_state.cursor.today）。report は5分ごとに上書きされ、
 * 送る時刻を過ぎると「時間外」だけになって朝の経過が読めなくなるため（2026-10-17、下書きができなかった朝に原因を追えなかった）。
 * 時間外の skip は残さない。日付が変わったら空から。最新の30件まで
 * @param {{date?: string, events?: object[]}|null|undefined} prev 前回の cursor.today
 * @param {{outcome?: string, reason?: string, item_id?: string}} item この回の report.items の /today の1件
 */
export function nextTodayLog(prev, item, now) {
  const date = jstDate(now);
  const events = prev?.date === date ? [...(prev.events ?? [])] : [];
  if (item && item.reason !== "outside_window" && item.outcome !== "missed")
    events.push({
      at: now.toISOString(),
      outcome: item.outcome ?? null,
      reason: item.reason
        ? String(item.reason)
            .split(" / ")
            .map(firstLine)
            .join(" / ")
            .slice(0, 600)
        : null,
    });
  const same = prev?.date === date;
  return {
    date,
    events: events.slice(-30),
    ...(same && prev.missed_notified ? { missed_notified: true } : {}),
    ...(same && prev.rebuild_failures
      ? { rebuild_failures: prev.rebuild_failures }
      : {}),
  };
}

// 確認用の作り直しが続けて失敗したら、この回数で Slack に知らせてやめる（5分ごとに夜まで繰り返さない）
export const REBUILD_MAX_FAILURES = 3;

/** その日の下書きを作れずに送る時刻を過ぎたときの Slack の文（朝の経過から最後の理由を添える） */
export function missedTodayText(log) {
  const last = [...(log?.events ?? [])]
    .reverse()
    .find((e) => e.reason || e.outcome);
  const at = (iso) =>
    new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(11, 16);
  return [
    `SNS /today（${log?.date}）: ${TODAY_LATEST} までに下書きを作れなかった。今日は送らない`,
    last
      ? `最後の結果（${at(last.at)}）: ${last.outcome}${last.reason ? ` ${last.reason}` : ""}（朝の記録 ${log.events.length}件）`
      : "朝の実行が一度も最後まで終わっていない（関数の時間切れなど。Vercel のログを確かめる）",
  ].join("\n");
}

// 確認用の作り直しが失敗した回の数を数える（呼び出し側の log を書き換える）
function countRebuildFailure(log, rebuilding, item) {
  if (rebuilding && item?.outcome === "error")
    log.rebuild_failures = (log.rebuild_failures ?? 0) + 1;
}

// Slack に出す文。作り直しをやめる回の1回だけ、または「作れなかった」をその日まだ知らせていないとき
function todayNotice(item, log, giveUp) {
  if (giveUp)
    return [
      `SNS /today（${log.date}）: 確認用の作り直しが${REBUILD_MAX_FAILURES}回続けて失敗したので、やめた（もう一度は today_rebuild を入れ直す）`,
      `最後の理由: ${log.events.at(-1)?.reason ?? "なし"}`,
    ].join("\n");
  return item?.outcome === "missed" && !log.missed_notified
    ? missedTodayText(log)
    : null;
}

/**
 * 1回の実行の後の朝の記録と、Slack に出す「作れなかった」の文（その日まだ知らせていないときだけ。知らせたら呼び出し側が
 * log.missed_notified=true にして cursor に保存する）
 */
export function finishTodayLog(prev, item, now, { rebuilding = false } = {}) {
  const log = nextTodayLog(prev, item, now);
  countRebuildFailure(log, rebuilding, item);
  // 作り直しをやめる（呼び出し側が cursor.today_rebuild を消す）。知らせるのはこのときの1回だけ
  const giveUp =
    rebuilding && (log.rebuild_failures ?? 0) >= REBUILD_MAX_FAILURES;
  if (giveUp) delete log.rebuild_failures;
  return { log, giveUp, notice: todayNotice(item, log, giveUp) };
}
