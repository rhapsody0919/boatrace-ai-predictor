// race_results.rank4/5/6 バックフィルスクリプト（BOA-338）
//
// BOA-238でrank4/5/6列を新設した際、過去約4万件の再スクレイピングは高コストとして
// バックフィルを見送っていたが（BOA-287）、選手ページのレース一覧（BOA-159）実装を機に
// 方針転換し、本スクリプトで対応する。
//
// レース単位で公式raceresultページを再取得するとレース数（4万件超）分のリクエストが
// 必要になるが、公式の成績ファイル（Kファイル、BOA-257の進入コースバックフィルと同じ
// データソース）には着順そのものが1行ずつ含まれているため、日単位（1日1ファイル、
// 2026-09-16時点で対象284日）で全レース分の着順を取得できる。
//
// 安全策: Kファイルからパースした1〜3着が、既存のrace_results.rank1〜3と完全一致する
// 場合のみrank4〜6を更新する（パース異常・レース対応付けミスの検知）。不一致・
// Kファイル側に該当レースが無い場合は更新せずログに残す。
//
// 使用方法:
//   node --env-file=.env.local scripts/maintenance/backfill-rank456-from-kfile.js --from=2025-12-04 --to=2026-09-15
//   node --env-file=.env.local scripts/maintenance/backfill-rank456-from-kfile.js --from=2025-12-04 --to=2026-09-15 --dry-run
//
// 対象: 指定期間内で rank1 は入っているが rank4 が未取得のレース（レジューム可能。
// 既に更新済みの日は対象0件のためKファイルのダウンロード自体をスキップする）。

import { supabase } from "../lib/supabaseClient.js";
import { fetchKFileText, parseKFileRankings } from "../lib/kfileParser.js";

function parseArgs() {
  const args = process.argv.slice(2);
  const options = { from: null, to: null, dryRun: false, sleepMs: 300 };
  for (const arg of args) {
    if (arg.startsWith("--from=")) options.from = arg.replace("--from=", "");
    else if (arg.startsWith("--to=")) options.to = arg.replace("--to=", "");
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg.startsWith("--sleep-ms=")) {
      options.sleepMs = parseInt(arg.replace("--sleep-ms=", ""), 10);
    }
  }
  return options;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// この環境のネットワークは同時接続が増えると「TypeError: fetch failed」で
// 連鎖的に失敗することを実行時に確認したため、一時的な失敗は指数バックオフで
// リトライする（K・Supabase双方のfetchに共通の一過性エラーのため汎用化する）。
async function withRetry(fn, { retries = 3, baseDelayMs = 1000 } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e;
      if (attempt < retries) {
        await sleep(baseDelayMs * 2 ** attempt);
      }
    }
  }
  throw lastError;
}

function* dateRange(from, to) {
  let d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end) {
    yield d.toISOString().split("T")[0];
    d = new Date(d.getTime() + 24 * 60 * 60 * 1000);
  }
}

/** 指定日について rank1 ありrank4 無しのレースを取得する（0件ならその日はスキップ対象） */
async function fetchPendingRaces(dateStr) {
  return withRetry(async () => {
    const { data, error } = await supabase
      .from("race_results")
      .select("race_id, rank1, rank2, rank3")
      .gte("race_id", dateStr)
      .lt("race_id", `${dateStr}~`)
      .not("rank1", "is", null)
      .is("rank4", null);
    if (error) throw new Error(`対象確認エラー(${dateStr}): ${error.message}`);
    return data || [];
  });
}

// 同時接続数20で「TypeError: fetch failed」の連鎖（ソケット枯渇の疑い）が
// 実際に発生した（2025-12-11〜12分の本番実行で確認）ため、控えめな値にする。
const CONCURRENCY = 5;

async function chunkedForEach(items, worker, concurrency) {
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    await Promise.all(chunk.map(worker));
    if (i + concurrency < items.length) await sleep(100);
  }
}

async function backfillOneDay(dateStr, pendingRaces, dryRun) {
  const text = await withRetry(() => fetchKFileText(dateStr));
  if (!text) {
    return {
      status: "no_kfile",
      updated: 0,
      mismatched: 0,
      notInKfile: 0,
      mismatchDetails: [],
    };
  }

  const rows = parseKFileRankings(text, dateStr);
  const kfileByRaceId = new Map(rows.map((r) => [r.race_id, r]));

  const targets = [];
  let mismatched = 0;
  let notInKfile = 0;
  const mismatchDetails = [];

  for (const pending of pendingRaces) {
    const k = kfileByRaceId.get(pending.race_id);
    if (!k) {
      notInKfile++;
      continue;
    }
    if (
      !k.valid ||
      k.rank1 !== pending.rank1 ||
      k.rank2 !== pending.rank2 ||
      k.rank3 !== pending.rank3
    ) {
      mismatched++;
      mismatchDetails.push({
        race_id: pending.race_id,
        reason: !k.valid ? "duplicate_boat_in_kfile" : "rank1_3_mismatch",
        db: [pending.rank1, pending.rank2, pending.rank3],
        kfile: [k.rank1, k.rank2, k.rank3],
      });
      continue;
    }
    targets.push({
      race_id: pending.race_id,
      rank4: k.rank4,
      rank5: k.rank5,
      rank6: k.rank6,
    });
  }

  let updated = 0;
  if (dryRun) {
    updated = targets.length;
  } else if (targets.length > 0) {
    await chunkedForEach(
      targets,
      async (t) => {
        try {
          await withRetry(async () => {
            const { error } = await supabase
              .from("race_results")
              .update({ rank4: t.rank4, rank5: t.rank5, rank6: t.rank6 })
              .eq("race_id", t.race_id);
            if (error) throw new Error(error.message);
          });
          updated++;
        } catch (e) {
          console.error(`  ⚠️ 更新エラー(${t.race_id}): ${e.message}`);
        }
      },
      CONCURRENCY,
    );
  }

  return { status: "ok", updated, mismatched, notInKfile, mismatchDetails };
}

async function main() {
  const options = parseArgs();
  if (!options.from || !options.to) {
    console.log("使用方法:");
    console.log(
      "  node --env-file=.env.local scripts/maintenance/backfill-rank456-from-kfile.js --from=2025-12-04 --to=2026-09-15",
    );
    console.log("オプション:");
    console.log("  --dry-run       実際には更新しない（対象件数のみ集計）");
    console.log(
      "  --sleep-ms=N    1日ごとのKファイルダウンロード間隔(ms、デフォルト300)",
    );
    process.exit(1);
  }

  console.log("=== rank4/5/6バックフィル（Kファイル方式, BOA-338） ===");
  console.log(`期間: ${options.from} 〜 ${options.to}`);
  console.log(`モード: ${options.dryRun ? "ドライラン" : "本番実行"}`);
  console.log("");

  let daysProcessed = 0;
  let daysSkippedNoPending = 0;
  let daysNoKFile = 0;
  let daysError = 0;
  let totalUpdated = 0;
  let totalMismatched = 0;
  let totalNotInKfile = 0;
  const allMismatches = [];

  for (const dateStr of dateRange(options.from, options.to)) {
    try {
      const pending = await fetchPendingRaces(dateStr);
      if (pending.length === 0) {
        daysSkippedNoPending++;
        continue;
      }

      const result = await backfillOneDay(dateStr, pending, options.dryRun);
      if (result.status === "no_kfile") {
        daysNoKFile++;
        console.log(
          `[${dateStr}] Kファイルなし（対象${pending.length}件、スキップ）`,
        );
      } else {
        daysProcessed++;
        totalUpdated += result.updated;
        totalMismatched += result.mismatched;
        totalNotInKfile += result.notInKfile;
        if (result.mismatchDetails.length > 0) {
          allMismatches.push(...result.mismatchDetails);
        }
        console.log(
          `[${dateStr}] ${options.dryRun ? "(dry-run) " : ""}対象${pending.length}件 -> 更新${result.updated}件` +
            (result.mismatched > 0 ? `, 不一致${result.mismatched}件` : "") +
            (result.notInKfile > 0
              ? `, Kファイル未検出${result.notInKfile}件`
              : ""),
        );
      }
    } catch (e) {
      daysError++;
      console.error(`[${dateStr}] ❌ ${e.message}`);
    }
    await sleep(options.sleepMs);
  }

  console.log("");
  console.log("=== 完了 ===");
  console.log(`処理日数: ${daysProcessed}`);
  console.log(`対象なしでスキップ: ${daysSkippedNoPending}日`);
  console.log(`Kファイル無し: ${daysNoKFile}日`);
  console.log(`エラー: ${daysError}日`);
  console.log(`更新レース数合計: ${totalUpdated}件`);
  if (totalMismatched > 0) {
    console.log(`⚠️ rank1〜3不一致等で更新スキップ: ${totalMismatched}件`);
    console.log(JSON.stringify(allMismatches, null, 2));
  }
  if (totalNotInKfile > 0) {
    console.log(`⚠️ Kファイルに該当レースなし: ${totalNotInKfile}件`);
  }
}

main().catch((e) => {
  console.error("致命的エラー:", e);
  process.exit(1);
});
