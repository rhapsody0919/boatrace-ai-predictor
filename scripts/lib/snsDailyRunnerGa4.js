/**
 * SNS の暦日の取り込みの GA4 側。snsDailyRunner.js から、collectGa4（割った）・collectSetsuShort・setsuShortLink を移した（振る舞いは同じ）。
 */
import twitterText from "twitter-text";
import {
  X_SOURCES,
  YOUTUBE_SOURCES,
  and,
  exact,
  hostFilter,
  inList,
  sonarTabFilter,
  assistPageFilter,
  SITE_HOST,
} from "./snsGa4.js";
import {
  RACE_ID_RE,
  UTM_CAMPAIGNS,
  UUID_RE,
  addDays,
  def,
  toJstDay,
} from "./snsDailyRunnerParts.js";

/** 説明欄のリンクの utm_* と GA4 のセッションの次元。required は無ければ結びつけない（同じ会場のページへの別の投稿の流入を拾わないため） */
const SETSU_UTM_DIMS = [
  { param: "utm_source", dim: "sessionSource", required: true },
  { param: "utm_medium", dim: "sessionMedium", required: true },
  { param: "utm_campaign", dim: "sessionCampaignName", required: false },
  { param: "utm_content", dim: "sessionManualAdContent", required: true },
];
const VENUE_PATH = /^\/venue\/(\d{1,2})\/?$/i;

const ga4Day = (yyyymmdd) =>
  `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;


/** チャネル全体: 流入元ごとの行をチャネルに足し、行の無い日は0 */
async function collectChannelTotals({ runReport, jstDays, push, dateRanges }) {
  const snsSources = inList("sessionSource", [
    ...X_SOURCES,
    ...YOUTUBE_SOURCES,
  ]);
  const channelOf = (source) =>
    YOUTUBE_SOURCES.includes(source) ? "youtube" : "x";

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
}

/** 投稿の UTM ごとの訪問・ソナー・導線の3つのレポート（visits・sonar・assist の順） */
async function readUtmReports(runReport, dateRanges) {
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
  return Promise.all([
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
    runReport({
      dateRanges,
      dimensions: utmDims,
      metrics: [{ name: "totalUsers" }],
      dimensionFilter: and(utmFilter, assistPageFilter),
    }),
  ]);
}

// 全貌の完全版の機能への導線は utm_content が「レース ID/sonar」「レース ID/assist」（hq 契約 10/24 C1）。下書きの結びつけはレース ID で
const raceKey = (c) => String(c).split("/")[0];

/** UTM の utm_content から、既知の下書きの ID（knownIds）と、全貌の下書き（fpDraft、レース・チャネルごと）を引く */
async function loadUtmDrafts(store, [utmVisits, utmSonar, utmAssist]) {
  const contents = [...utmVisits, ...utmSonar, ...utmAssist].map(([, , , content]) =>
    String(content),
  );
  const candidates = [
    ...new Set(
      contents.map((c) => c.split("/")[0]).filter((id) => UUID_RE.test(id)),
    ),
  ];
  const raceIds = [
    ...new Set(contents.map(raceKey).filter((c) => RACE_ID_RE.test(c))),
  ];
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
  return { knownIds, fpDraft };
}

/** 合意している utm_term は full・shorts だけ。未設定は空、それ以外は「その他」に寄せる */
const normalizeTerm = (rawTerm) =>
  rawTerm === "(not set)" || !rawTerm
    ? ""
    : ["full", "shorts"].includes(String(rawTerm).toLowerCase())
      ? String(rawTerm).toLowerCase()
      : "その他";

/** 全貌動画（utm_content=レース ID）の行。投稿日と翌日だけを残す */
function pushFullPicture({ push, fpDraft, day, source, term, campaign, content, metric, value }) {
  if (campaign !== "race-full") return;
  const channel = source === "youtube" ? "youtube" : "x";
  const draft = fpDraft.get(`${raceKey(content)}|${channel}`);
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
    definition: def.ga4FullPicture(metric, source, term),
  });
}

/** UTM の1行を、全貌動画か下書きの ID の行として push する関数を作る */
function makeUtmRow({ push, knownIds, fpDraft }) {
  return (date, rawSource, campaign, content, rawTerm, metric, value) => {
    const day = ga4Day(date);
    // GA4 の inList は大文字小文字を区別しないので、比べる前にそろえる
    const source = String(rawSource).toLowerCase();
    const term = normalizeTerm(rawTerm);
    if (RACE_ID_RE.test(raceKey(content))) {
      pushFullPicture({ push, fpDraft, day, source, term, campaign, content, metric, value });
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
}

export async function collectGa4({ runReport, store, jstDays, push }) {
  const dateRanges = [{ startDate: jstDays[0], endDate: jstDays.at(-1) }];
  await collectChannelTotals({ runReport, jstDays, push, dateRanges });

  // 投稿の UTM ごと（行がある分だけ）。
  // - utm_content の先頭が下書きの ID（auto-plan の race-full・today_digest、X だけ）: draft_id に結びつける
  // - utm_content がレース ID（全貌動画。hq の作り手が X の本文と YouTube の概要欄に付ける、2026-10-19 合意）:
  //   X・YouTube を utm_term（full・shorts）ごとに分け、その全貌の下書きの実際の投稿日（JST）と翌日の2日分だけを残す
  //   （GA4 の反映は最大48時間遅れるが、毎日 D−3〜D−1 を取り直すので両日とも58時間後まで読み直す。2026-10-19 オーナー決定）
  const reports = await readUtmReports(runReport, dateRanges);
  const { knownIds, fpDraft } = await loadUtmDrafts(store, reports);
  const [utmVisits, utmSonar, utmAssist] = reports;
  const utmRow = makeUtmRow({ push, knownIds, fpDraft });
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
  for (const [date, source, campaign, content, term, users] of utmAssist)
    utmRow(date, source, campaign, String(content), term, "assist_users", users);
}

/**
 * 説明欄の会場のページのリンク（push-setsu-kiryoku-short.js の descriptionLink と同じ twitter-text の取り出し）から、
 * 会場の番号と utm_*（小文字）を出す。会場のページのリンクが無い・必須の utm_* が欠けていれば null
 */
export function setsuShortLink(caption) {
  for (const raw of twitterText.extractUrls(caption ?? "")) {
    let u;
    try {
      u = new URL(raw);
    } catch {
      continue;
    }
    const m = VENUE_PATH.exec(u.pathname);
    if (u.hostname !== SITE_HOST || !m) continue;
    const utm = {};
    for (const { param, dim, required } of SETSU_UTM_DIMS) {
      const v = u.searchParams.get(param);
      if (v) utm[dim] = v.toLowerCase();
      else if (required) return null;
    }
    return { venue: Number(m[1]), utm };
  }
  return null;
}

/**
 * 節の機力の Shorts の流入（users・sessions）。取り直しの範囲に投稿日か翌日が入る投稿済みの下書きだけ。下書きが無ければ GA4 を呼ばない。
 * リンク（会場と utm_*）ごとに1回読み、次元は日付だけにする（照合の条件を GA4 のフィルタに入れ、totalUsers を GA4 の側で重複なしに数える。
 * campaign・大文字小文字・末尾の / で行を分けて足すと人数が重なるため。Codex の審査 P1）。
 * その日の値は、同じリンクの下書きのうち投稿日（JST）が同じ日のもの、無ければ前の日のものに付ける。
 * 同じ会場・同じ utm の投稿が続く日は、その日の流入を当日の投稿に付ける（GA4 では前の日の投稿の翌日の分と見分けられない）
 */
export async function collectSetsuShort({ runReport, store, jstDays, push }) {
  const since = `${addDays(jstDays[0], -1)}T00:00:00+09:00`;
  const groups = new Map();
  for (const d of await store.setsuShortDrafts(since)) {
    const link = d.posted_at ? setsuShortLink(d.caption_text) : null;
    if (!link) continue;
    const key = JSON.stringify(link);
    groups.set(key, [...(groups.get(key) ?? []), { ...d, link }]);
  }
  const results = await Promise.all(
    [...groups.values()].map((drafts) => {
      const { venue, utm } = drafts[0].link;
      return runReport({
        dateRanges: [{ startDate: jstDays[0], endDate: jstDays.at(-1) }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "totalUsers" }, { name: "sessions" }],
        dimensionFilter: and(
          hostFilter,
          {
            filter: {
              fieldName: "landingPage",
              stringFilter: {
                matchType: "FULL_REGEXP",
                value: `^/venue/0?${venue}/?$`,
              },
            },
          },
          // GA4 の文字列のフィルタは既定で大文字小文字を区別しない
          ...Object.entries(utm).map(([dim, v]) => exact(dim, v)),
        ),
      });
    }),
  );
  [...groups.values()].forEach((drafts, g) => {
    for (const [date, users, sessions] of results[g]) {
      const day = ga4Day(date);
      const draft =
        drafts.find((d) => toJstDay(d.posted_at) === day) ??
        drafts.find((d) => addDays(toJstDay(d.posted_at), 1) === day);
      if (!draft) continue;
      for (const [metric, value] of [
        ["users", users],
        ["sessions", sessions],
      ])
        push({
          day,
          channel: "youtube",
          draft_id: draft.id,
          utm_content: draft.link.utm.sessionManualAdContent,
          source: "site-analytics",
          metric_name: metric,
          metric_value: value,
          missing_reason: null,
          definition: def.ga4SetsuShort(metric),
        });
    }
  });
}
