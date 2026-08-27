// FR2: 公式ニュースアーカイブ（レーサーデータカテゴリ）からの節目記録取り込み
// docs/design/racer-news-auto-collect/spec.md FR2 / plan.md 2.2 参照
//
// 実HTML調査で判明した事実: レーサーデータカテゴリの記事見出しは
// 「登録第{racer_id}号 {氏名}選手（{支部}支部）{達成内容}達成」という定型で、
// 見出しに登録番号(racer_id)が直接含まれるため、一覧ページの見出し文字列だけで
// 完結する（記事本文の個別取得は不要）。

import * as cheerio from "cheerio";
import { supabase, isSupabaseEnabled } from "../supabaseClient.js";
import { getTodayDateJST } from "../dateUtils.js";
import { isAlreadyProcessed } from "./dedup.js";
import { addPendingItem } from "./pendingReview.js";
import { generateGradeAnnouncementNews } from "./templates.js";

const BASE_URL = "https://www.boatrace.jp";
const SOURCE_NAME = "BOAT RACEオフィシャルウェブサイト";
const FETCH_TIMEOUT_MS = 15000;
const USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";

const TITLE_PATTERN = {
  racerId: /登録第(\d+)号/,
  branch: /（(.+?)支部）/,
  achievement: /支部）\s*(.+?)達成/,
};

function buildCategoryUrl(year, month) {
  const mm = String(month).padStart(2, "0");
  return `${BASE_URL}/owpc/pc/site/news/racer/${year}/${mm}/`;
}

async function fetchCategoryArticles(year, month) {
  const url = buildCategoryUrl(year, month);
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
  if (!res.ok) {
    throw new Error(`カテゴリ一覧取得に失敗しました(${res.status}): ${url}`);
  }
  const html = await res.text();
  const $ = cheerio.load(html);
  const articles = [];
  $("ul.news4_newsList > li > a").each((_, el) => {
    const href = $(el).attr("href");
    const title = $(el).find(".news4_newsTitle").text().trim();
    const dateText = $(el).find(".news4_dateText").text().trim();
    if (href && title) {
      articles.push({
        url: new URL(href, BASE_URL).toString(),
        title,
        date: dateText.replace(/\//g, "-"),
      });
    }
  });
  return articles;
}

// 戻り値:
//   null                 → 個別選手の記録ではない見出し（「登録第◯号」を含まない）。対象外として静かにスキップしてよい
//   { racerId, branch: null | achievement: null 含む } → 登録番号はあるが支部/達成内容が抽出できない。
//                            見出しフォーマットが変化した兆候の可能性があるため、呼び出し側でpendingReviewに記録する
function parseTitle(title) {
  const idMatch = title.match(TITLE_PATTERN.racerId);
  if (!idMatch) return null;
  const branchMatch = title.match(TITLE_PATTERN.branch);
  const achievementMatch = title.match(TITLE_PATTERN.achievement);
  return {
    racerId: parseInt(idMatch[1], 10),
    branch: branchMatch ? branchMatch[1] : null,
    achievement: achievementMatch ? achievementMatch[1].trim() : null,
  };
}

function getPreviousMonth(year, month) {
  const d = new Date(Date.UTC(year, month - 2, 1));
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
}

/**
 * boatrace.jpの「レーサーデータ」カテゴリから節目記録ニュースを取り込む
 * @param {{ targetDate?: string }} [options] targetDate省略時は当日(JST)。当月＋前月を対象にする
 * @returns {Promise<{ generated: number, pending: number, skipped: number, errors: number }>}
 */
export async function collectGradeAnnouncementNews({ targetDate } = {}) {
  const date = targetDate || getTodayDateJST();
  const summary = { generated: 0, pending: 0, skipped: 0, errors: 0 };

  if (!isSupabaseEnabled()) {
    console.warn(
      "⚠️ Supabase未設定のためFR2（レーサーデータ節目記録）をスキップ",
    );
    return summary;
  }

  const [year, month] = date.split("-").map(Number);
  const { year: prevYear, month: prevMonth } = getPreviousMonth(year, month);

  const articles = [];
  for (const [y, m] of [
    [year, month],
    [prevYear, prevMonth],
  ]) {
    try {
      articles.push(...(await fetchCategoryArticles(y, m)));
    } catch (err) {
      console.error(
        `⚠️ ${y}年${m}月のレーサーデータ一覧取得に失敗しました:`,
        err.message,
      );
      summary.errors++;
    }
  }

  for (const article of articles) {
    try {
      if (await isAlreadyProcessed(article.url)) {
        summary.skipped++;
        continue;
      }

      const parsed = parseTitle(article.title);
      if (!parsed) {
        summary.skipped++;
        continue;
      }

      if (!parsed.branch || !parsed.achievement) {
        addPendingItem({
          id: `grade-announcement-${article.url}`,
          source: "grade-announcement",
          reason:
            "見出しから支部/達成内容を抽出できませんでした（見出しフォーマットが変化した可能性）",
          candidate: { racerId: parsed.racerId, title: article.title },
          sourceUrl: article.url,
          sourceName: SOURCE_NAME,
          detectedAt: date,
        });
        summary.pending++;
        continue;
      }

      const { data: profile, error: profileError } = await supabase
        .from("racer_profiles")
        .select("racer_id, name, branch")
        .eq("racer_id", parsed.racerId)
        .maybeSingle();
      if (profileError) {
        throw new Error(
          `racer_profiles取得に失敗しました: ${profileError.message}`,
        );
      }

      if (!profile || profile.branch !== parsed.branch) {
        addPendingItem({
          id: `grade-announcement-${article.url}`,
          source: "grade-announcement",
          reason: !profile
            ? `racer_profilesにracer_id=${parsed.racerId}が見つかりません`
            : `支部が一致しません（記事: ${parsed.branch} / DB: ${profile.branch}）`,
          candidate: {
            racerId: parsed.racerId,
            branch: parsed.branch,
            achievement: parsed.achievement,
            title: article.title,
          },
          sourceUrl: article.url,
          sourceName: SOURCE_NAME,
          detectedAt: date,
        });
        summary.pending++;
        continue;
      }

      const { title, summary: newsSummary } = generateGradeAnnouncementNews({
        racerName: profile.name.replace(/\s+/g, ""),
        branch: profile.branch,
        achievement: parsed.achievement,
      });

      const { error: insertError } = await supabase.from("racer_news").insert({
        racer_id: profile.racer_id,
        title,
        summary: newsSummary,
        source_url: article.url,
        source_name: SOURCE_NAME,
        published_at: article.date,
      });
      if (insertError) {
        throw new Error(`racer_news投入に失敗しました: ${insertError.message}`);
      }

      summary.generated++;
    } catch (err) {
      console.error(
        `⚠️ ${article.url} のレーサーデータニュース生成に失敗しました:`,
        err.message,
      );
      summary.errors++;
    }
  }

  return summary;
}
