import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  localizePath,
  parseLangFromPath,
  getHreflangAlternates,
  isSearchIndexed,
} from "../src/config/languages.js";
import { RACER_INDEX_ACTIVE_DAYS } from "../src/utils/racerIndexPolicy.js";
import { getDaysAgoJST } from "../src/utils/dateUtils.js";
import { blogPostsEn } from "../src/data/blogPostsEn.js";
import { blogPostsZhTw } from "../src/data/blogPostsZhTw.js";
import { blogPostsKo } from "../src/data/blogPostsKo.js";
import { blogPosts as blogPostsJa } from "../src/data/blogPosts.js";
import {
  gitLastCommitDate,
  laterDate,
  renderUrlEntry,
} from "./lib/sitemapLastmod.js";
import { isDirectRun } from "./lib/isDirectRun.js";
import { localizedPages } from "./lib/sitemapLanguagePages.js";
import { racerSitemapEntry } from "./lib/sitemapRacerPages.js";
import { staticPages } from "./lib/sitemapStaticPages.js";
import { BLOG_DIR, getBlogPosts } from "./lib/sitemapBlogPages.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const SITE_URL = "https://www.boat-ai.jp";
const PUBLIC_DIR = path.join(__dirname, "../public");

// 静的ページの表（scripts/lib/sitemapStaticPages.js）。verify が同じ名で読むので re-export する
export { staticPages };

const JA_POST_DATE = new Map(blogPostsJa.map((p) => [p.id, p.updated ?? p.date ?? null]));
const BLOG_MD_SUFFIX = { en: "-en", "zh-TW": "-zh-tw", ko: "-ko" };

// 記事の lastmod。md の最終コミット日（本文の修正を拾う）と、記事データの日付
// （更新日 updated、無ければ公開日 date）の新しいほう。md は frontmatter を持たず、以前は mtime を使っていたため、
// CI の checkout 時刻＝毎日の生成日になっていた（BOA-599）
function blogLastmod(id, mdSuffix) {
  return laterDate(
    gitLastCommitDate(path.join(BLOG_DIR, `${id}${mdSuffix}.md`)),
    JA_POST_DATE.get(id) ?? null,
  );
}

// 直近7日分のレースページをSupabaseから取得
// 過去の日別レースページ（/races/YYYY-MM-DD）は検索需要がほぼゼロで大半が未インデックスのまま
// クロールバジェットを消費していたため、直近7日分のみに限定する（BOA-84）
export async function getRacePages() {
  const racePages = [];

  try {
    const { supabase, isSupabaseEnabled } =
      await import("./lib/supabaseClient.js");
    if (!isSupabaseEnabled()) {
      console.warn("⚠️ Supabase未設定のため、レースページはスキップします");
      return racePages;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 7);
    const cutoffStr = cutoff.toISOString().split("T")[0];

    const { data, error } = await supabase
      .from("races")
      .select("race_date, venue_code")
      .gte("race_date", cutoffStr)
      .order("race_date", { ascending: false });
    if (error) throw new Error(error.message);

    const uniqueDates = [...new Set((data ?? []).map((r) => r.race_date))];

    for (const dateStr of uniqueDates) {
      racePages.push({
        loc: `/races/${dateStr}`,
        lastmod: dateStr,
        changefreq: "weekly",
        priority: "0.8",
      });
    }

    // 会場別レース一覧（過去日付、/races/:date/:venueCode）も日付と同じ
    // 直近7日ウィンドウで登録する（venue-list-redesign、docs/adr/0026参照）
    const dateVenuePairs = [
      ...new Set((data ?? []).map((r) => `${r.race_date}/${r.venue_code}`)),
    ];
    for (const pair of dateVenuePairs) {
      const [dateStr] = pair.split("/");
      racePages.push({
        loc: `/races/${pair}`,
        lastmod: dateStr,
        changefreq: "weekly",
        priority: "0.6",
      });
    }

    console.log(
      `📊 Supabase から直近7日分のレースデータを取得（${uniqueDates.length}日分・会場別${dateVenuePairs.length}件）`,
    );
  } catch (err) {
    throw new Error(`レースページ取得エラー: ${err.message}`, { cause: err });
  }

  return racePages;
}

// BOA-1186: 検索露出のある詳細を、日本語・JSTの本日を含む7日だけ追加。
// 結果の存在は画面と同じ rank1 で判定する（confirmed が残っていても結果を優先）。
// 最大24会場×12R×7日=2016 URL。失敗時は生成を止め、既存の sitemap を保つ。
export async function getRaceDetailPages() {
  const { isSupabaseEnabled, fetchAll } =
    await import("./lib/supabaseClient.js");
  if (!isSupabaseEnabled()) return [];
  const rows = await fetchAll(
    "races",
    "race_id, race_date, race_results!inner(rank1)",
    (q) =>
      q
        .gte("race_date", getDaysAgoJST(6))
        .lte("race_date", getDaysAgoJST(0))
        .not("race_results.rank1", "is", null)
        .order("race_id"),
  );
  return rows.map((row) => ({
    loc: `/race/${row.race_id}`,
    lastmod: row.race_date,
    changefreq: "weekly",
    priority: "0.6",
  }));
}

// 選手個別ページ（/racer/:racerId）を取得
// 対象はページ側の noindex 判定（RacerProfile.jsx）と同じ isRacerIndexable（src/utils/racerIndexPolicy.js）:
// ニュースがある選手、または現役の A1 選手（最新の出走が A1 で直近30日以内。集客レーン、2026-10-02）。
// lastmod は、ニュースの最新日と最新の出走日の新しい方（ページの中身が変わった日）
export async function getRacerPages() {
  const racerPages = [];

  try {
    const { supabase, isSupabaseEnabled } =
      await import("./lib/supabaseClient.js");
    if (!isSupabaseEnabled()) {
      console.warn("⚠️ Supabase未設定のため、選手ページはスキップします");
      return racerPages;
    }

    const { fetchAll } = await import("./lib/supabaseClient.js");
    const activeSince = getDaysAgoJST(RACER_INDEX_ACTIVE_DAYS);

    const { data, error } = await supabase
      .from("racer_news")
      .select("racer_id, created_at");
    if (error) throw new Error(error.message);
    const newsDateByRacerId = new Map();
    for (const row of data ?? []) {
      const date = row.created_at.slice(0, 10);
      const current = newsDateByRacerId.get(row.racer_id);
      if (!current || date > current) newsDateByRacerId.set(row.racer_id, date);
    }

    // 直近の出走（race_id は YYYY-MM-DD-VV-RR なので、文字列の比較で日付の範囲を絞れる）。
    // 選手ごとに最新の出走の級と開催日を取る（ページ側の getLatestEntry と同じ「最新の出走」）
    const entries = await fetchAll(
      "race_entries",
      "racer_id, grade, race_id",
      (q) =>
        q
          .gte("race_id", activeSince)
          .not("racer_id", "is", null)
          .order("race_id")
          .order("boat_number"),
    );
    const latestByRacerId = new Map();
    for (const row of entries) {
      const current = latestByRacerId.get(row.racer_id);
      if (!current || row.race_id > current.race_id) {
        latestByRacerId.set(row.racer_id, row);
      }
    }

    const racerIds = new Set([
      ...newsDateByRacerId.keys(),
      ...latestByRacerId.keys(),
    ]);
    let byNews = 0;
    let byGrade = 0;
    for (const racerId of racerIds) {
      const entry = racerSitemapEntry(racerId, newsDateByRacerId, latestByRacerId, activeSince);
      if (!entry) continue;
      if (entry.hasNews) byNews += 1;
      else byGrade += 1;
      racerPages.push(entry.page);
    }
    racerPages.sort((a, b) => a.loc.localeCompare(b.loc));

    console.log(
      `📊 Supabase から選手ページを取得（${racerPages.length}人: ニュース掲載 ${byNews}人・現役A1 ${byGrade}人）`,
    );
  } catch (err) {
    throw new Error(`選手ページ取得エラー: ${err.message}`, { cause: err });
  }

  return racerPages;
}

// 節ページ（/venue/:venueCode/meet/:startDate、BOA-682）。対象は SG/G1/G2 の節で、
// 出走表・結果がある 2025-12-02 以降（それより前の節は中身が出せず「見つからない」になる。
// 2019年以降の SG/G1/G2 は409節あり、下限が無いと約1,450 URL が空のページになる）から
// 今日+14日まで（開幕前の節を記事からのリンク先として先に載せる）。
// グランプリ・クイーンズクライマックス・トーナメントは節ページの対象外なので載せない。
// race_series は6,312行あるので fetchAll でページングする（1000行で黙って切れる）。
// **取得の失敗は握りつぶさない**（例外のまま main で終了コード1にする。節の URL が
// 黙って sitemap から落ちると、気づかないまま索引から消える。design-reviewer 指摘4）
const MEET_PAGE_DATA_FROM = "2025-12-02";

export async function getMeetPages(latest) {
  const { supabase, isSupabaseEnabled, fetchAll } =
    await import("./lib/supabaseClient.js");
  if (!isSupabaseEnabled()) {
    console.warn("⚠️ Supabase未設定のため、節ページはスキップします");
    return [];
  }
  const { isOutOfScopeMeetTitle, MEET_PAGE_GRADES, meetDaysOf, meetPageState } =
    await import("../src/utils/meetPageModel.js");
  const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000);
  const until = new Date(todayJst);
  until.setUTCDate(until.getUTCDate() + 14);
  const rows = await fetchAll(
    "race_series",
    "venue_code, start_date, end_date, title, grade",
    (q) =>
      q
        .in("grade", MEET_PAGE_GRADES)
        .gte("start_date", MEET_PAGE_DATA_FROM)
        .lte("start_date", until.toISOString().slice(0, 10))
        .order("venue_code")
        .order("start_date"),
    { client: supabase },
  );
  const meets = rows.filter((r) => !isOutOfScopeMeetTitle(r.title));
  const pages = [];
  for (const m of meets) {
    // ページと同じ初日〜+7日の窓・節の区切りを使う。結果の有無は index 判定に影響しない。
    const end = new Date(`${m.start_date}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() + 7);
    const vv = String(m.venue_code).padStart(2, "0");
    const inWindow = (q) =>
      q
        .gte("race_id", m.start_date)
        .lte("race_id", `${end.toISOString().slice(0, 10)}-zz`)
        .like("race_id", `__________-${vv}-__`)
        .order("race_id");
    const [windowConditions, windowEntries, windowRaces] = await Promise.all([
      fetchAll(
        "race_conditions",
        "race_id, series_day, is_final_day, race_stage",
        inWindow,
        { client: supabase },
      ),
      fetchAll(
        "race_entries",
        "race_id, boat_number",
        (q) => inWindow(q).order("boat_number"),
        { client: supabase },
      ),
      fetchAll("races", "race_id, race_grade", inWindow, { client: supabase }),
    ]);
    const meetDays = meetDaysOf(m.start_date, windowConditions, windowEntries);
    const inMeet = (r) => meetDays.includes(r.race_id.slice(0, 10));
    const conditions = windowConditions.filter(inMeet);
    const entries = windowEntries.filter(inMeet);
    const state = meetPageState({
      today: todayJst.toISOString().slice(0, 10),
      startDate: m.start_date,
      meetDays,
      hasEntries: entries.length > 0,
      startDateGrade:
        windowRaces.find(
          (r) => r.race_id.startsWith(`${m.start_date}-`) && r.race_grade,
        )?.race_grade ?? null,
      grade: m.grade,
      title: m.title,
      conditions,
      // 終了後の各状態も掲載対象なので、結果を取得する必要は無い。
      doneRaceIds: new Set(),
      raceIds: [...new Set([...conditions, ...entries].map((r) => r.race_id))],
      windowHasRaces: [...windowConditions, ...windowEntries].some((r) =>
        r.race_id.startsWith(m.start_date),
      ),
    });
    if (["preOpen", "notFound", "outOfScope"].includes(state)) continue;
    const venueLatest = latest.byVenue.get(m.venue_code) ?? null;
    // 掲載する節の lastmod は、節の最終日と最新の開催日の早いほう
    const lastmod =
      venueLatest && venueLatest >= m.start_date
        ? venueLatest < m.end_date
          ? venueLatest
          : m.end_date
        : null;
    const basePath = `/venue/${m.venue_code}/meet/${m.start_date}`;
    for (const { code } of SUPPORTED_LANGUAGES) {
      pages.push({
        loc: localizePath(basePath, code),
        lastmod,
        changefreq: "daily",
        priority: code === DEFAULT_LANGUAGE ? "0.7" : "0.6",
      });
    }
  }
  console.log(`📊 節ページ: ${meets.length}節（${pages.length} URL）`);
  return pages;
}

// 開催日（JSTの今日以前で最新）。全体と会場別。取れなければ null（lastmod を出さない）
export async function getLatestRaceDates() {
  const result = { overall: null, byVenue: new Map() };
  try {
    const { supabase, isSupabaseEnabled } =
      await import("./lib/supabaseClient.js");
    if (!isSupabaseEnabled()) return result;
    const todayJst = new Date(Date.now() + 9 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    // 会場は24。1会場1行だけ取る（全行を取ると1000行の上限に当たる）
    const rows = await Promise.all(
      Array.from({ length: 24 }, (_, i) =>
        supabase
          .from("races")
          .select("race_date")
          .eq("venue_code", i + 1)
          .lte("race_date", todayJst)
          .order("race_date", { ascending: false })
          .limit(1)
          .then(({ data, error }) => {
            if (error) throw new Error(error.message);
            return [i + 1, data?.[0]?.race_date ?? null];
          }),
      ),
    );
    for (const [venue, date] of rows) {
      result.byVenue.set(venue, date);
      result.overall = laterDate(result.overall, date);
    }
  } catch (err) {
    throw new Error(`開催日の取得エラー: ${err.message}`, { cause: err });
  }
  return result;
}

// 言語版の組（hreflang）。画面の HreflangTags と同じ getHreflangAlternates で決める。
// 画面の hreflang は JS 実行後にしか無く、日本語の検索に /en/・/ko/ が出ていた（BOA-560）。
// 1言語しか無いページは出さない（画面も出さない）
function alternatesFor(loc) {
  return getHreflangAlternates(parseLangFromPath(loc).basePath, SITE_URL);
}

// 検索に出さない URL（isSearchIndexed）が混じっていたら黙って落とさず止める（BOA-1701）
function assertSearchIndexed(pages) {
  const bad = pages.filter(({ loc }) => {
    const { lng, basePath } = parseLangFromPath(loc);
    return !isSearchIndexed(basePath, lng);
  });
  if (bad.length > 0) {
    throw new Error(
      `sitemap に検索に出さない URL が混じった（${bad.length}件、先頭: ${bad
        .slice(0, 3)
        .map((p) => p.loc)
        .join(", ")}）。src/config/languages.js の NOINDEX_LOCALIZED_PREFIXES を見る`,
    );
  }
}

// sitemap.xmlの生成
export async function generateSitemap() {
  const blogPosts = getBlogPosts(blogLastmod);
  const racePages = await getRacePages();
  const raceDetailPages = await getRaceDetailPages();
  const racerPages = await getRacerPages();
  const latest = await getLatestRaceDates();
  const meetPages = await getMeetPages(latest);
  const blogIndexLastmod = (lang) => {
    const posts =
      lang === "en"
        ? blogPostsEn
        : lang === "zh-TW"
          ? blogPostsZhTw
          : lang === "ko"
            ? blogPostsKo
            : blogPostsJa;
    return posts.reduce(
      (acc, post) =>
        laterDate(acc, blogLastmod(post.id, BLOG_MD_SUFFIX[lang] ?? "")),
      null,
    );
  };
  const resolveLastmod = (page) => {
    switch (page.lastmodFrom) {
      case "raceData":
        return latest.overall;
      case "venueRaceData":
        return latest.byVenue.get(page.venueCode) ?? null;
      case "blogIndex":
        return blogIndexLastmod(page.lang);
      case "blogPost":
        return blogLastmod(page.postId, BLOG_MD_SUFFIX[page.lang] ?? "");
      default:
        return page.lastmod ?? null;
    }
  };

  // レース詳細の言語版は載せない（検索に出さない、BOA-1701・ADR 0107）。ja の /race/<id> だけ
  const allPages = [
    ...staticPages,
    ...localizedPages,
    ...blogPosts,
    ...racePages,
    ...raceDetailPages,
    ...racerPages,
    ...meetPages,
  ];

  assertSearchIndexed(allPages);

  // 単一 sitemap の上限。超過した XML は書き出さない。
  if (allPages.length > 50000) {
    throw new Error(`sitemap URL 上限超過: ${allPages.length}`);
  }

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml +=
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n';

  allPages.forEach((page) => {
    xml += renderUrlEntry(SITE_URL, {
      ...page,
      lastmod: resolveLastmod(page),
      alternates: alternatesFor(page.loc),
    });
  });

  xml += "</urlset>\n";

  return xml;
}

// メイン処理
async function main() {
  try {
    console.log("Generating sitemap.xml...");

    const sitemap = await generateSitemap();
    const sitemapPath = path.join(PUBLIC_DIR, "sitemap.xml");

    fs.writeFileSync(sitemapPath, sitemap, "utf-8");

    // URL数をカウント
    const urlCount = sitemap.split("<url>").length - 1;
    console.log(`✅ Sitemap generated: ${sitemapPath} (${urlCount} URLs)`);
  } catch (error) {
    console.error("❌ Error generating sitemap:", error);
    process.exit(1);
  }
}

// 直接起動のときだけ main を回す（import されただけなら DB の読み・sitemap.xml の書きは走らない。verify が生成の関数を偽の DB で呼ぶため）
if (isDirectRun(import.meta.url)) main();
