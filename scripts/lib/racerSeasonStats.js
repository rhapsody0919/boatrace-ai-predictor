// 選手「期別成績」ページ（boatrace.jp）のスクレイピング・パース共通ロジック
//
// BOA-321（docs/design/scraping-full-coverage/ FR-2）対応。
// scripts/maintenance/scrape-racer-profiles.js（DB保存側）と
// scripts/analysis/verify-racer-season-stats-accuracy.js（検算側）の両方から利用する。
//
// ページ実機確認（2026-09-15、A1/A2/B1/B2級の4選手で確認、構造は級別に依存せず共通）:
//   https://www.boatrace.jp/owpc/pc/data/racersearch/season?toban=<racer_id>
//   - div.text > p.h-alignR に「集計期間：YYYY/MM/DD-YYYY/MM/DD」
//   - div.table1 > table > tbody（7個、各tbodyに1行=th/td×2ペア）に以下の項目:
//     勝率 / 2連対率 / 3連対率 / 出走回数 / 優出回数 / 優勝回数 /
//     平均スタートタイミング / フライング回数 / 出遅れ回数（選手責任） / 能力指数 /
//     1着〜6着（勝率%（回数回）の複合表記）
//   - 集計期間内にデータがない項目は「-」表記（parseNumberOrNull がnullを返す）

import * as cheerio from "cheerio";

export const SEASON_STATS_USER_AGENT =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";

const FIELD_KEY_MAP = {
  勝率: "winRate",
  "2連対率": "rentai2Rate",
  "3連対率": "rentai3Rate",
  出走回数: "starts",
  優出回数: "finalistCount",
  優勝回数: "winCount",
  平均スタートタイミング: "avgStartTiming",
  フライング回数: "flyingCount",
  "出遅れ回数（選手責任）": "falseStartCount",
  能力指数: "abilityIndex",
};

// 公式サイトへのリクエストヘッダ（取得先への配慮としてUser-Agentを明示）。
// scripts/lib/racerProfileSync.js（タイムアウト・リトライ付きの定期取得）とも共有する
export const SEASON_STATS_REQUEST_HEADERS = {
  "User-Agent": SEASON_STATS_USER_AGENT,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "ja,en-US;q=0.7,en;q=0.3",
};

export function getSeasonStatsUrl(racerId) {
  return `https://www.boatrace.jp/owpc/pc/data/racersearch/season?toban=${racerId}`;
}

// "116回"→116, "54.30%"→54.3, "6.87"→6.87, "-"→null, ""→null
function parseNumberOrNull(text) {
  if (text == null) return null;
  const trimmed = text.trim();
  if (trimmed === "" || trimmed === "-") return null;
  const match = trimmed.match(/-?\d+(\.\d+)?/);
  return match ? parseFloat(match[0]) : null;
}

// 集計期間の終了日（YYYY-MM-DD）から集計期の識別子を導出する。
// 前期=5/1-10/31集計・翌年1/1-6/30適用、後期=11/1-4/30集計・7/1-12/31適用
// （docs/db-migration/061_racer_profiles_season_stats.sql参照）。
// 適用開始年を基準にラベル化する: 後期はendYearそのもの、前期はendYear+1。
export function derivePeriodLabel(periodEndIso) {
  if (!periodEndIso) return null;
  const parts = periodEndIso.split("-");
  if (parts.length !== 3) return null;
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  if (month === 4 && day === 30) return `${year}-second`;
  if (month === 10 && day === 31) return `${year + 1}-first`;
  return null; // 想定外の終了日（構造変化の可能性、呼び出し元でログすること）
}

// div.table1 のtbody行群をパースする。th/tdは document order で交互に並ぶため
// 2個ずつ組にして (ラベル, 値) を取り出す。
function parseStatsTable($) {
  const fields = {};
  const placeRates = {};
  const placeCounts = {};

  $(".table1 table tbody tr").each((_, tr) => {
    const cells = $(tr).find("th, td");
    for (let i = 0; i + 1 < cells.length; i += 2) {
      const label = $(cells[i]).text().trim();
      const valueText = $(cells[i + 1])
        .text()
        .trim();

      const mappedKey = FIELD_KEY_MAP[label];
      if (mappedKey) {
        fields[mappedKey] = valueText;
        continue;
      }

      const placeMatch = label.match(/^([1-6])着$/);
      if (placeMatch) {
        const place = Number(placeMatch[1]);
        // 例: "34.5%（40回）" / データ無しは "-"
        const detailMatch = valueText.match(/([\d.]+)%\s*[（(](\d+)回[）)]/);
        if (detailMatch) {
          placeRates[place] = parseFloat(detailMatch[1]);
          placeCounts[place] = parseInt(detailMatch[2], 10);
        } else if (valueText.trim() === "-") {
          placeRates[place] = null;
          placeCounts[place] = null;
        }
      }
    }
  });

  return { fields, placeRates, placeCounts };
}

// 期別成績ページのHTMLをパースする。ページ自体は存在するが集計期間データが
// 無いケース（新人選手等）や、構造変化でテーブルが見つからない場合は null を返す。
export function parseSeasonStatsHtml(html) {
  const $ = cheerio.load(html);

  if ($(".table1 table").length === 0) return null;

  const periodText = $(".text .h-alignR").first().text().trim();
  const periodMatch = periodText.match(
    /(\d{4})\/(\d{2})\/(\d{2})-(\d{4})\/(\d{2})\/(\d{2})/,
  );
  const periodStart = periodMatch
    ? `${periodMatch[1]}-${periodMatch[2]}-${periodMatch[3]}`
    : null;
  const periodEnd = periodMatch
    ? `${periodMatch[4]}-${periodMatch[5]}-${periodMatch[6]}`
    : null;

  const { fields, placeRates, placeCounts } = parseStatsTable($);

  return {
    periodStart,
    periodEnd,
    periodLabel: derivePeriodLabel(periodEnd),
    winRate: parseNumberOrNull(fields.winRate),
    rentai2Rate: parseNumberOrNull(fields.rentai2Rate),
    rentai3Rate: parseNumberOrNull(fields.rentai3Rate),
    starts: parseNumberOrNull(fields.starts),
    finalistCount: parseNumberOrNull(fields.finalistCount),
    winCount: parseNumberOrNull(fields.winCount),
    avgStartTiming: parseNumberOrNull(fields.avgStartTiming),
    flyingCount: parseNumberOrNull(fields.flyingCount),
    falseStartCount: parseNumberOrNull(fields.falseStartCount),
    abilityIndex: parseNumberOrNull(fields.abilityIndex),
    placeRates,
    placeCounts,
  };
}

// racer_idの期別成績ページを取得してパースする。
// ページ自体が存在しない（無効なtoban）、あるいはHTTPエラーの場合は null を返す。
export async function scrapeSeasonStats(racerId) {
  const response = await fetch(getSeasonStatsUrl(racerId), {
    headers: SEASON_STATS_REQUEST_HEADERS,
  });

  if (!response.ok) return null;

  const html = await response.text();
  return parseSeasonStatsHtml(html);
}
