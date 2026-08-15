/**
 * i18n 需要計測レポート（BOA-128）
 *
 * GA4 Data API から各言語版（/{lng}/*）のトラフィックを集計し、
 * 次言語への投資判断材料を出力する。対象言語は src/config/languages.js に追従する。
 *
 * 使い方:
 *   node scripts/analysis/i18n-demand-report.js [--days=30]
 *
 * 必要な設定:
 *   GA4_PROPERTY_ID（.env.local）- GA4 プロパティID（数字のみ。GA4 管理 > プロパティ設定）
 *   サービスアカウント認証 - credentials/google-service-account.json
 *     （Google Sheets 連携と共用。GOOGLE_SERVICE_ACCOUNT_KEY_PATH で変更可能）
 *
 * セットアップ手順は docs/operation/i18n-demand-report.md を参照
 */
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { google } from "googleapis";
import { getGoogleAuthClient } from "../lib/googleServiceAuth.js";
import {
  SUPPORTED_LANGUAGES,
  DEFAULT_LANGUAGE,
  parseLangFromPath,
} from "../../src/config/languages.js";
import {
  findPreviousReport,
  perDay,
  formatDelta,
} from "../lib/reportComparison.js";

// .env.local を読み込む（プロジェクト共通パターン: scripts/lib/supabaseClient.js と同様）
const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env.local") });

const DAYS = parseInt(
  (process.argv.find((a) => a.startsWith("--days=")) || "--days=30").split(
    "=",
  )[1],
  10,
);
const PROPERTY_ID = process.env.GA4_PROPERTY_ID;

if (!PROPERTY_ID) {
  console.error(`❌ GA4_PROPERTY_ID が設定されていません。

.env.local に追加してください:
  GA4_PROPERTY_ID=123456789  # GA4 管理 > プロパティ設定 > プロパティID（数字のみ）

詳細: docs/operation/i18n-demand-report.md`);
  process.exit(1);
}

// サービスアカウント認証（update-google-sheets.js と同じ方式、BOA-139で共通化）
const auth = getGoogleAuthClient([
  "https://www.googleapis.com/auth/analytics.readonly",
]);

const analyticsdata = google.analyticsdata({ version: "v1beta", auth });
const property = `properties/${PROPERTY_ID}`;
const dateRanges = [{ startDate: `${DAYS}daysAgo`, endDate: "today" }];

async function runReport(request) {
  const res = await analyticsdata.properties.runReport({
    property,
    requestBody: { dateRanges, ...request },
  });
  return res.data.rows || [];
}

// デフォルト言語以外の言語（パスプレフィックスを持つ言語）
const PREFIXED_LANGUAGES = SUPPORTED_LANGUAGES.filter(
  ({ code }) => code !== DEFAULT_LANGUAGE,
);

// 1. 言語別（パスプレフィックス別）の PV / ユーザー数
async function reportByLanguagePath() {
  const rows = await runReport({
    dimensions: [{ name: "pagePath" }],
    metrics: [{ name: "screenPageViews" }, { name: "activeUsers" }],
    limit: 10000,
  });

  const agg = Object.fromEntries(
    SUPPORTED_LANGUAGES.map(({ code }) => [code, { pv: 0, users: 0 }]),
  );
  for (const row of rows) {
    const p = row.dimensionValues[0].value;
    const { lng } = parseLangFromPath(p);
    agg[lng].pv += parseInt(row.metricValues[0].value, 10);
    // activeUsers はパス横断で重複するため参考値
    agg[lng].users += parseInt(row.metricValues[1].value, 10);
  }
  return agg;
}

// 言語プレフィックスのパスに一致する GA4 フィルタ
// （BEGINS_WITH "/en" だと /end 等も一致するため、"/en" 完全一致 OR "/en/" 前方一致にする）
function langPathFilter(code) {
  return {
    orGroup: {
      expressions: [
        {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "EXACT", value: `/${code}` },
          },
        },
        {
          filter: {
            fieldName: "pagePath",
            stringFilter: { matchType: "BEGINS_WITH", value: `/${code}/` },
          },
        },
      ],
    },
  };
}

// 2. 言語ページの国別トラフィック（次言語判断の材料）
async function reportLangByCountry(code) {
  const rows = await runReport({
    dimensions: [{ name: "country" }],
    metrics: [{ name: "activeUsers" }, { name: "screenPageViews" }],
    dimensionFilter: langPathFilter(code),
    orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
    limit: 20,
  });
  return rows.map((r) => ({
    country: r.dimensionValues[0].value,
    users: parseInt(r.metricValues[0].value, 10),
    pv: parseInt(r.metricValues[1].value, 10),
  }));
}

// 3. 言語切替イベント
async function reportLanguageSwitches() {
  const rows = await runReport({
    dimensions: [{ name: "eventName" }],
    metrics: [{ name: "eventCount" }],
    dimensionFilter: {
      filter: {
        fieldName: "eventName",
        stringFilter: { matchType: "EXACT", value: "language_change" },
      },
    },
  });
  return rows.length > 0 ? parseInt(rows[0].metricValues[0].value, 10) : 0;
}

// 4. 言語ページの流入元
async function reportLangBySource(code) {
  const rows = await runReport({
    dimensions: [{ name: "sessionDefaultChannelGroup" }],
    metrics: [{ name: "sessions" }],
    dimensionFilter: langPathFilter(code),
    orderBys: [{ metric: { metricName: "sessions" }, desc: true }],
    limit: 10,
  });
  return rows.map((r) => ({
    channel: r.dimensionValues[0].value,
    sessions: parseInt(r.metricValues[0].value, 10),
  }));
}

async function main() {
  console.log(
    `\n📊 i18n 需要計測レポート（直近${DAYS}日間）\n${"=".repeat(50)}`,
  );

  const [byLang, switches, byCountryList, bySourceList] = await Promise.all([
    reportByLanguagePath(),
    reportLanguageSwitches(),
    Promise.all(
      PREFIXED_LANGUAGES.map(({ code }) => reportLangByCountry(code)),
    ),
    Promise.all(PREFIXED_LANGUAGES.map(({ code }) => reportLangBySource(code))),
  ]);
  const byCountry = Object.fromEntries(
    PREFIXED_LANGUAGES.map(({ code }, i) => [code, byCountryList[i]]),
  );
  const bySource = Object.fromEntries(
    PREFIXED_LANGUAGES.map(({ code }, i) => [code, bySourceList[i]]),
  );

  const totalPv = Object.values(byLang).reduce((sum, v) => sum + v.pv, 0);
  const shareOf = (code) =>
    totalPv > 0 ? ((byLang[code].pv / totalPv) * 100).toFixed(2) : "0.00";

  console.log(`\n## 言語別トラフィック`);
  for (const { code, label } of SUPPORTED_LANGUAGES) {
    const share =
      code === DEFAULT_LANGUAGE ? "" : `（全体の ${shareOf(code)}%）`;
    console.log(
      `  ${label.padEnd(8)}: ${byLang[code].pv.toLocaleString()} PV${share}`,
    );
  }
  console.log(`  言語切替イベント: ${switches.toLocaleString()} 回`);

  for (const { code, label } of PREFIXED_LANGUAGES) {
    console.log(`\n## ${label}ページの国別ユーザー（上位）`);
    if (byCountry[code].length === 0) {
      console.log("  （データなし）");
    } else {
      for (const c of byCountry[code].slice(0, 10)) {
        console.log(
          `  ${c.country.padEnd(20)} ${String(c.users).padStart(6)} users / ${String(c.pv).padStart(7)} PV`,
        );
      }
    }

    console.log(`\n## ${label}ページの流入チャネル`);
    if (bySource[code].length === 0) {
      console.log("  （データなし）");
    } else {
      for (const s of bySource[code]) {
        console.log(
          `  ${s.channel.padEnd(20)} ${String(s.sessions).padStart(6)} sessions`,
        );
      }
    }
  }

  // 前回レポートとの比較（日割りPV・シェア%の推移）
  const outDir = path.join(process.cwd(), "data", "analysis", "i18n-demand");
  const today = new Date().toISOString().split("T")[0];
  const previous = findPreviousReport(outDir, today);

  if (previous) {
    const prevDays = previous.data.days ?? 1;
    console.log(
      `\n## 前回レポート（${previous.date}、${prevDays}日間）との比較`,
    );
    for (const { code, label } of SUPPORTED_LANGUAGES) {
      const prevLang = previous.data.byLanguage?.[code];
      if (!prevLang) {
        console.log(`  ${label.padEnd(8)}: （前回データなし）`);
        continue;
      }
      const currPerDay = perDay(byLang[code].pv, DAYS);
      const prevPerDay = perDay(prevLang.pv, prevDays);
      const pctDelta =
        prevPerDay > 0
          ? formatDelta(((currPerDay - prevPerDay) / prevPerDay) * 100)
          : "N/A";
      console.log(
        `  ${label.padEnd(8)}: PV/日 ${currPerDay.toFixed(1)} (前回 ${prevPerDay.toFixed(1)}、${pctDelta}%)`,
      );
    }
  } else {
    console.log(
      `\n## 前回レポートとの比較\n  （比較対象となる過去レポートが見つかりません。次回実行時から比較が有効になります）`,
    );
  }

  // JSON 保存（推移比較用）
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, `report-${today}.json`);
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        days: DAYS,
        byLanguage: byLang,
        shareOfPv: Object.fromEntries(
          PREFIXED_LANGUAGES.map(({ code }) => [
            code,
            parseFloat(shareOf(code)),
          ]),
        ),
        languageSwitches: switches,
        byCountry,
        bySource,
      },
      null,
      2,
    ),
  );

  console.log(`\n💾 保存: ${outPath}`);
  console.log(
    `\n判断の目安（3ヶ月後）: 英語PVシェア・国別分布から次言語（中国語/韓国語/東南アジア）の優先度を決定`,
  );
}

main().catch((err) => {
  if (err.code === 403 || /permission/i.test(err.message)) {
    console.error(`❌ GA4 へのアクセス権限がありません。

GA4 管理 > プロパティのアクセス管理 で以下を「閲覧者」に追加してください:
  ${auth.email}`);
  } else {
    console.error("❌ レポート生成エラー:", err.message);
  }
  process.exit(1);
});
