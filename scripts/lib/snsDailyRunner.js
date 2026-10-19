/**
 * SNS の暦日の値の取り込み（sns-pdca-loop tasks 22、cron `sns_daily`、plan §5）。JST 10:00 に1日1回、sns_channel_daily へ入れる。
 *
 * - YouTube Analytics（太平洋時間の暦日）: チャネル全体の日次と、動画ごとの「投稿日＋翌日」の日次（版の判定に使う）。
 *   確定まで数日かかるので、毎日 D−3〜D−1（太平洋時間）を取り直す
 * - GA4（JST の暦日）: X・YouTube から来た人のチャネル全体の日次と、X の投稿の UTM（race-full・today_digest）ごとの日次。
 *   それぞれ「龍神ソナーのタブを開いた人」も。毎日 D−3〜D−1（JST）を取り直す。流入元のリストは scripts/lib/snsGa4.js
 * - 値が変わった行だけ書く（読み直して比べる。取得のたびに全行を UPDATE しない）
 * - チャネル全体の日次は行が無い日も埋める（YouTube は「行を返さない」の欠測、GA4 は0）。UTM ごとの日次は行がある分だけ
 * - 片方の取得に失敗しても、もう片方は書いてから失敗として返す（補足の起動がやり直す）
 * - GA4 の鍵が未設定の間は GA4 を飛ばし、report.alerts で知らせる
 * - shadow は取得と比較までで、書かない
 */
import {
  X_SOURCES,
  YOUTUBE_SOURCES,
  and,
  exact,
  hostFilter,
  inList,
  sonarTabFilter,
  SITE_HOST,
} from "./snsGa4.js";

export const SNS_DAILY_LOOKBACK_DAYS = 3;
export const UTM_CAMPAIGNS = ["race-full", "today_digest"];
const CHANNEL_METRICS = ["views", "engagedViews", "subscribersGained"];
const VIDEO_METRICS = [
  "views",
  "engagedViews",
  "averageViewPercentage",
  "subscribersGained",
];
const RACE_ID_RE = /^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/;
/** 時刻を JST の YYYY-MM-DD にする */
const toJstDay = (iso) =>
  new Date(Date.parse(iso) + 9 * 3600000).toISOString().slice(0, 10);
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPSERT_CHUNK = 500;
const YT_MISSING = "Analytics が行を返さない（未確定の可能性）";

const def = {
  ytChannel: (m) =>
    `YouTube Analytics reports dimensions=day・チャネル全体・${m}・太平洋時間の暦日・v1`,
  ytVideo: (m) =>
    `YouTube Analytics reports dimensions=day filters=video・${m}・太平洋時間の暦日・v1`,
  ga4Channel: (m) =>
    `GA4 ${m}・hostName=${SITE_HOST}・sessionSource は X・YouTube の完全一致のリスト・流入元ごとの和・JST の暦日・Cookie 同意者のみ・v1`,
  // 全貌（utm_content=race_id）は X・YouTube と utm_term（full・shorts）で分ける
  ga4FullPicture: (m, source, term) =>
    `GA4 ${m}・utm_source=${source}・utm_medium=social・utm_campaign=race-full・utm_content=race_id・utm_term=${term || "(なし)"}・JST の暦日・投稿日と翌日だけ・Cookie 同意者のみ・v1`,
  ga4Utm: (m, campaign) =>
    `GA4 ${m}・utm_source=x・utm_medium=social・utm_campaign=${campaign}・JST の暦日・Cookie 同意者のみ・v1`,
};

/** YYYY-MM-DD に日数を足す */
export const addDays = (day, n) =>
  new Date(Date.parse(`${day}T00:00:00Z`) + n * 86400000)
    .toISOString()
    .slice(0, 10);
export const ptDate = (date) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles" }).format(
    date,
  );
const range = (endExclusive) =>
  Array.from({ length: SNS_DAILY_LOOKBACK_DAYS }, (_, i) =>
    addDays(endExclusive, i - SNS_DAILY_LOOKBACK_DAYS),
  );

const rowKey = (r) =>
  [
    r.day,
    r.channel,
    r.draft_id ?? "",
    r.utm_content ?? "",
    r.source,
    r.metric_name,
    r.definition,
  ].join("|");

/**
 * @param {{mode: string, now: () => Date, targetDate: string}} ctx targetDate は JST の対象日（cron ラッパが解決する）
 * @param {{store, youtube: () => Promise<{report: Function}>, ga4: (() => Promise<Function>)|null}} deps
 * youtube().report(params) は YouTube Analytics の行を [{day, ...指標}] で返す。ga4() は runReport（snsGa4.js）。
 * ga4 が null なら鍵が未設定
 */
export async function runSnsDaily(ctx, { store, youtube, ga4 }) {
  const now = ctx.now();
  const observedAt = now.toISOString();
  const jstDays = range(ctx.targetDate);
  const ptDays = range(ptDate(now));
  const rows = [];
  const errors = [];
  const alerts = [];
  const push = (row) =>
    rows.push({
      draft_id: null,
      utm_content: null,
      observed_at: observedAt,
      ...row,
    });
  let expected = 0;

  try {
    const yt = await youtube();
    expected += ptDays.length * CHANNEL_METRICS.length;
    await collectYoutube({ yt, store, ptDays, now, push });
  } catch (error) {
    errors.push(`YouTube Analytics: ${error.message}`);
  }

  if (!ga4) {
    alerts.push({
      key: "ga4_unconfigured",
      text: "SNS の日次の取り込み: GA4 の鍵（GOOGLE_SERVICE_ACCOUNT_KEY・GA4_PROPERTY_ID）が Vercel に無いので、GA4 の流入を取っていない",
    });
  } else {
    try {
      const runReport = await ga4();
      expected += jstDays.length * 2 * 3;
      await collectGa4({ runReport, store, jstDays, push });
    } catch (error) {
      errors.push(`GA4: ${error.message}`);
    }
  }

  const from = [...jstDays, ...ptDays].sort()[0];
  const to = [...jstDays, ...ptDays].sort().at(-1);
  const existing = new Map(
    (await store.existing(from, to)).map((r) => [rowKey(r), r]),
  );
  const changed = rows.filter((r) => {
    const old = existing.get(rowKey(r));
    return (
      !old ||
      (old.metric_value === null ? null : Number(old.metric_value)) !==
        r.metric_value ||
      (old.missing_reason ?? null) !== (r.missing_reason ?? null)
    );
  });
  const live = ctx.mode === "live";
  if (live)
    for (let i = 0; i < changed.length; i += UPSERT_CHUNK)
      await store.upsert(changed.slice(i, i + UPSERT_CHUNK));

  const report = {
    jstDays,
    ptDays,
    parsed: rows.length,
    changed: changed.length,
    alerts,
  };
  return {
    rowsParsed: rows.length,
    rowsExpected: expected,
    rowsWritten: live ? changed.length : 0,
    report,
    body: { parsed: rows.length, changed: changed.length, errors },
    ...(errors.length
      ? { outcome: "error", error: errors.join(" / ").slice(0, 500) }
      : {}),
  };
}

async function collectYoutube({ yt, store, ptDays, now, push }) {
  const channelRows = await yt.report({
    startDate: ptDays[0],
    endDate: ptDays.at(-1),
    dimensions: "day",
    metrics: CHANNEL_METRICS.join(","),
  });
  const byDay = new Map(channelRows.map((r) => [r.day, r]));
  for (const day of ptDays)
    for (const metric of CHANNEL_METRICS)
      push(
        ytRow({
          day,
          metric,
          row: byDay.get(day),
          definition: def.ytChannel(metric),
        }),
      );

  // 投稿日が D−4 以降の動画（翌日が取り直しの範囲に入る）。動画ごとに1回（クォータ1）
  const since = new Date(now.getTime() - 6 * 86400000).toISOString();
  for (const video of await store.youtubeVideos(since)) {
    const posted = ptDate(new Date(video.posted_at));
    const days = [posted, addDays(posted, 1)].filter((d) => ptDays.includes(d));
    if (!days.length || !video.external_post_id) continue;
    const videoRows = await yt.report({
      startDate: days[0],
      endDate: days.at(-1),
      dimensions: "day",
      metrics: VIDEO_METRICS.join(","),
      filters: `video==${video.external_post_id}`,
    });
    const videoByDay = new Map(videoRows.map((r) => [r.day, r]));
    for (const day of days)
      for (const metric of VIDEO_METRICS)
        push(
          ytRow({
            day,
            metric,
            row: videoByDay.get(day),
            definition: def.ytVideo(metric),
            draft_id: video.draft_id,
          }),
        );
  }
}

function ytRow({ day, metric, row, definition, draft_id = null }) {
  const value = row?.[metric];
  const ok = Number.isFinite(value) && value >= 0;
  return {
    day,
    channel: "youtube",
    draft_id,
    source: "youtube-analytics",
    metric_name: metric,
    metric_value: ok ? value : null,
    missing_reason: ok ? null : YT_MISSING,
    definition,
  };
}

const ga4Day = (yyyymmdd) =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;

async function collectGa4({ runReport, store, jstDays, push }) {
  const dateRanges = [{ startDate: jstDays[0], endDate: jstDays.at(-1) }];
  const snsSources = inList("sessionSource", [
    ...X_SOURCES,
    ...YOUTUBE_SOURCES,
  ]);
  const channelOf = (source) =>
    YOUTUBE_SOURCES.includes(source) ? "youtube" : "x";

  // チャネル全体: 流入元ごとの行をチャネルに足し、行の無い日は0
  const [visits, sonar] = await Promise.all([
    runReport({
      dateRanges,
      dimensions: [{ name: "date" }, { name: "sessionSource" }],
      metrics: [{ name: "totalUsers" }, { name: "sessions" }],
      dimensionFilter: and(hostFilter, snsSources),
    }),
    runReport({
      dateRanges,
      dimensions: [{ name: "date" }, { name: "sessionSource" }],
      metrics: [{ name: "totalUsers" }],
      dimensionFilter: and(hostFilter, snsSources, sonarTabFilter),
    }),
  ]);
  const totals = new Map();
  const add = (day, channel, metric, value) => {
    const key = `${day}|${channel}|${metric}`;
    totals.set(key, (totals.get(key) ?? 0) + value);
  };
  for (const [date, source, users, sessions] of visits) {
    add(ga4Day(date), channelOf(source), "users", users);
    add(ga4Day(date), channelOf(source), "sessions", sessions);
  }
  for (const [date, source, users] of sonar)
    add(ga4Day(date), channelOf(source), "sonar_users", users);
  for (const day of jstDays)
    for (const channel of ["x", "youtube"])
      for (const metric of ["users", "sessions", "sonar_users"])
        push({
          day,
          channel,
          source: "site-analytics",
          metric_name: metric,
          metric_value: totals.get(`${day}|${channel}|${metric}`) ?? 0,
          missing_reason: null,
          definition: def.ga4Channel(metric),
        });

  // 投稿の UTM ごと（行がある分だけ）。
  // - utm_content の先頭が下書きの ID（auto-plan の race-full・today_digest、X だけ）: draft_id に結びつける
  // - utm_content がレース ID（全貌動画。hq の作り手が X の本文と YouTube の概要欄に付ける、2026-10-19 合意）:
  //   X・YouTube を utm_term（full・shorts）ごとに分け、その全貌の下書きの実際の投稿日（JST）と翌日の2日分だけを残す
  //   （GA4 の反映は最大48時間遅れるが、毎日 D−3〜D−1 を取り直すので両日とも58時間後まで読み直す。2026-10-19 オーナー決定）
  const utmFilter = and(
    hostFilter,
    inList("sessionSource", ["x", "youtube"]),
    exact("sessionMedium", "social"),
    inList("sessionCampaignName", UTM_CAMPAIGNS),
  );
  const utmDims = [
    { name: "date" },
    { name: "sessionSource" },
    { name: "sessionCampaignName" },
    { name: "sessionManualAdContent" },
    { name: "sessionManualTerm" },
  ];
  const [utmVisits, utmSonar] = await Promise.all([
    runReport({
      dateRanges,
      dimensions: utmDims,
      metrics: [{ name: "totalUsers" }, { name: "sessions" }],
      dimensionFilter: utmFilter,
    }),
    runReport({
      dateRanges,
      dimensions: utmDims,
      metrics: [{ name: "totalUsers" }],
      dimensionFilter: and(utmFilter, sonarTabFilter),
    }),
  ]);
  const contents = [...utmVisits, ...utmSonar].map(([, , , content]) =>
    String(content),
  );
  const candidates = [
    ...new Set(
      contents.map((c) => c.split("/")[0]).filter((id) => UUID_RE.test(id)),
    ),
  ];
  const raceIds = [...new Set(contents.filter((c) => RACE_ID_RE.test(c)))];
  const [known, fullPicture] = await Promise.all([
    candidates.length ? store.existingDrafts(candidates) : [],
    raceIds.length ? store.fullPictureDrafts(raceIds) : [],
  ]);
  const knownIds = new Set(known);
  // 同じレース・チャネルに下書きが複数ある（作り直して push した等）ときは、投稿された中で最初のものを使う
  const fpDraft = new Map();
  for (const d of fullPicture.filter((d) => d.posted_at)) {
    const key = `${d.race_id}|${d.platform}`;
    if (
      !fpDraft.has(key) ||
      Date.parse(d.posted_at) < Date.parse(fpDraft.get(key).posted_at)
    )
      fpDraft.set(key, d);
  }
  const utmRow = (date, source, campaign, content, term, metric, value) => {
    const day = ga4Day(date);
    if (RACE_ID_RE.test(content)) {
      if (campaign !== "race-full") return;
      const channel = source === "youtube" ? "youtube" : "x";
      const draft = fpDraft.get(`${content}|${channel}`);
      // 投稿された全貌の下書きが無い（まだ送っていない・手で出した）ときは、投稿日が分からないので数えない
      if (!draft?.posted_at) return;
      const postedDay = toJstDay(draft.posted_at);
      if (day !== postedDay && day !== addDays(postedDay, 1)) return;
      push({
        day,
        channel,
        draft_id: draft.id,
        utm_content: content,
        source: "site-analytics",
        metric_name: metric,
        metric_value: value,
        missing_reason: null,
        definition: def.ga4FullPicture(
          metric,
          source,
          term === "(not set)" ? "" : term,
        ),
      });
      return;
    }
    // 下書きの ID の UTM は X だけ（今までどおり）
    if (source !== "x") return;
    const id = content.split("/")[0];
    push({
      day,
      channel: "x",
      draft_id: knownIds.has(id) ? id : null,
      utm_content: content,
      source: "site-analytics",
      metric_name: metric,
      metric_value: value,
      missing_reason: null,
      definition: def.ga4Utm(metric, campaign),
    });
  };
  for (const [
    date,
    source,
    campaign,
    content,
    term,
    users,
    sessions,
  ] of utmVisits) {
    utmRow(date, source, campaign, String(content), term, "users", users);
    utmRow(date, source, campaign, String(content), term, "sessions", sessions);
  }
  for (const [date, source, campaign, content, term, users] of utmSonar)
    utmRow(date, source, campaign, String(content), term, "sonar_users", users);
}

/** YouTube Analytics の reports（channel==MINE）。行を {day, 指標...} にする */
export function createYoutubeAnalyticsClient({
  accessToken,
  fetchImpl = fetch,
}) {
  if (!accessToken)
    throw new Error("YouTube Analytics の access token がありません");
  return {
    async report(params) {
      const query = new URLSearchParams({ ids: "channel==MINE", ...params });
      const response = await fetchImpl(
        `https://youtubeanalytics.googleapis.com/v2/reports?${query}`,
        {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(30000),
        },
      );
      const body = await response.json().catch(() => null);
      if (!response.ok || !body)
        throw new Error(
          `YouTube Analytics reports が失敗: HTTP ${response.status}`,
        );
      const names = (body.columnHeaders ?? []).map((h) => h.name);
      return (body.rows ?? []).map((row) =>
        Object.fromEntries(row.map((value, i) => [names[i], value])),
      );
    },
  };
}

const COLUMNS =
  "day,channel,draft_id,utm_content,source,metric_name,metric_value,missing_reason,definition";

/** PostgREST の読み書き（service_role）。失敗は握りつぶさず投げる */
export function createSnsDailyStore({ url, key, fetchImpl = fetch }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function get(path) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, { headers });
    if (!response.ok)
      throw new Error(
        `日次の取り込みの DB の読み取りに失敗: HTTP ${response.status} ${path.split("?")[0]}`,
      );
    return response.json();
  }
  return {
    youtubeVideos: (since) =>
      get(
        `sns_x_send_jobs?channel=eq.youtube&state=eq.posted&posted_at=gte.${encodeURIComponent(since)}&select=draft_id,external_post_id,posted_at`,
      ),
    // 全貌（format=full_picture）の下書きを race_id から引く（push-full-picture が source_data.full_picture.race_id に入れる）
    fullPictureDrafts: (raceIds) =>
      get(
        `sns_drafts?format=eq.full_picture&source_data->full_picture->>race_id=in.(${raceIds.join(",")})&select=id,platform,posted_at,race_id:source_data->full_picture->>race_id`,
      ),
    async existingDrafts(ids) {
      return (await get(`sns_drafts?id=in.(${ids.join(",")})&select=id`)).map(
        (d) => d.id,
      );
    },
    // max-rows（1000）で切れないように 1000 行ずつ読む
    async existing(from, to) {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await get(
          `sns_channel_daily?day=gte.${from}&day=lte.${to}&select=${COLUMNS}&order=id.asc&limit=1000&offset=${offset}`,
        );
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },
    async upsert(rows) {
      const response = await fetchImpl(
        `${url}/rest/v1/sns_channel_daily?on_conflict=day,channel,draft_id,utm_content,source,metric_name,definition`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(rows),
        },
      );
      if (!response.ok)
        throw new Error(`日次の取り込みの保存に失敗: HTTP ${response.status}`);
    },
  };
}
