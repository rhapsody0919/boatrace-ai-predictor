/**
 * kb（公式の成績・番組のアーカイブ）の取得の計画の純粋関数（日付の列・取得の窓・応答の分類・計画と見積り）。
 * scripts/maintenance/kb-backfill-parts.js から字のまま移した（CLI 側は再 export。scripts/lib の archiveDownloader.js はここを読む）
 */

const JST_OFFSET_MS = 9 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// 純粋関数（verify-kb-backfill.js で単体検証する）
// ---------------------------------------------------------------------------

export function* dateRange(from, to) {
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    yield d.toISOString().slice(0, 10);
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
}

/** JSTの「今日」 YYYY-MM-DD */
export function jstToday(now = new Date()) {
  return new Date(now.getTime() + JST_OFFSET_MS).toISOString().slice(0, 10);
}

/** "22-06" → {start: 22, end: 6}。"any" は制限なし（null） */
export function parseWindow(spec) {
  if (spec === "any") return null;
  const m = /^(\d{1,2})-(\d{1,2})$/.exec(spec);
  if (!m)
    throw new Error(`--window の形式が不正です（例: 22-06 / any）: ${spec}`);
  const [start, end] = [Number(m[1]), Number(m[2])];
  if (start > 24 || end > 24 || start === end) {
    throw new Error(
      `--window は開始と終了が異なる0〜24の時刻で指定します: ${spec}`,
    );
  }
  return { start, end };
}

/** JSTの時刻が窓（日をまたぐ窓を含む）に入っているか */
export function inWindow(win, now = new Date()) {
  if (!win) return true;
  const h = new Date(now.getTime() + JST_OFFSET_MS).getUTCHours();
  return win.start < win.end
    ? h >= win.start && h < win.end
    : h >= win.start || h < win.end;
}

/**
 * 日次上限の集計キー。夜間窓（例: 22-06）は日をまたぐため、窓の終了時刻ぶん遡った
 * JST日付を「その夜の日付」とする（23:00と翌03:00が同じ夜に数えられる）。
 */
export function windowDayKey(win, at) {
  const shift = win && win.start > win.end ? win.end * 60 * 60 * 1000 : 0;
  return new Date(new Date(at).getTime() + JST_OFFSET_MS - shift)
    .toISOString()
    .slice(0, 10);
}

/** HTTP結果の分類。bad=サーキットブレーカーの連続カウント対象 */
export function classifyResponse(status) {
  if (status === 200) return { kind: "ok", bad: false };
  if (status === 404) return { kind: "absent", bad: false };
  if (status === 403)
    return { kind: "blocked", bad: true, threshold: 2, backoff: false };
  if (status === 429 || status === 503)
    return { kind: "throttled", bad: true, threshold: 3, backoff: true };
  if (status >= 500)
    return { kind: "server-error", bad: true, threshold: 3, backoff: true };
  return { kind: "unexpected", bad: true, threshold: 3, backoff: false };
}

/** マニフェスト（JSONL、追記のみ）から (date,kind) ごとの最新状態を作る */
export function latestManifest(entries) {
  const map = new Map();
  for (const e of entries) map.set(`${e.date}|${e.kind}`, e);
  return map;
}

const DONE_STATUSES = new Set(["ok", "absent", "skipped"]);

/**
 * 取得計画。K（成績）が無い日（404）はBの取得を省く（開催が無い日）。
 * @returns {Array<{date: string, kind: "K"|"B"}>}
 */
export function planDownload({ from, to, kinds, manifest }) {
  const todo = [];
  for (const date of dateRange(from, to)) {
    for (const kind of kinds) {
      const state = manifest.get(`${date}|${kind}`);
      if (state && DONE_STATUSES.has(state.status)) continue;
      todo.push({ date, kind });
    }
  }
  return todo;
}

/** 見積り。intervalは平均、latencyは1リクエストの応答時間（利用環境で異なる） */
export function estimatePlan({
  requests,
  dailyLimit,
  meanIntervalMs,
  latencyMs,
}) {
  const perRequestMs = meanIntervalMs + latencyMs;
  const nights = Math.ceil(requests / dailyLimit);
  return {
    requests,
    nights,
    totalHours: Math.round(((requests * perRequestMs) / 3600000) * 10) / 10,
    hoursPerFullNight:
      Math.round(
        ((Math.min(requests, dailyLimit) * perRequestMs) / 3600000) * 10,
      ) / 10,
  };
}
