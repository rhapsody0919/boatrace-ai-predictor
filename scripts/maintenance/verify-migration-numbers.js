/**
 * docs/db-migration/ 配下のマイグレーション番号（ファイル名先頭の数字）を機械検査する。
 * 複数セッション並行作業により、同じ番号のマイグレーションが繰り返し発生した実績があるため
 * （master上に008/009/020/021/022/029/030/035/039/047/048/050/054/059/064が重複）、
 * 新規マイグレーション作成時・実装完了後の自動レビューで機械的に確認できるようにする。
 * verify-adr-numbers.js と同じ流儀（CI連携はせず、手元で実行する）。
 *
 * 検査内容:
 *   1. 番号の重複。既存の重複は ALLOWED_DUPLICATES に理由つきで凍結し、
 *      許可リストに無い新たな重複、または許可済み番号への同番号ファイルの追加は失敗にする
 *   2. 欠番（警告のみ）
 *   3. --base=<ref>（既定はnpm scriptで origin/master）: baseの最大番号を git ls-tree で取得し、
 *      現在のブランチで新規追加されたファイルがbaseの最大番号より後（最大番号+1以降）であることを確認する。
 *      git fetch はしない。baseを取得できなければスキップして注意を出す。
 *      baseのコミット日時を表示し、24時間より古ければ fetch を促す警告を出す
 *   4. APPLIED.md（適用状況の台帳）に、新規追加ファイルの行があること（無ければ失敗）。
 *      既存ファイルの記載漏れは警告のみ
 *   5. NNN_*.sql の命名規則に合わない .sql（UNNUMBERED_ALLOWED を除く）は失敗
 *      （番号が付かないと上記の検査をすり抜けるため）
 *
 * 番号（id）の単位: ファイル名先頭の「3桁の数字 + 任意の英小文字1字」。013 と 013b は別のidとして扱う
 * （013b は 013 のRLSポリシー等の付随ファイルとして意図的に付けられたサブ番号）。
 * baseとの順序比較は id の文字列比較（"067" < "067b" < "068"）で行う。
 * 検査対象は NNN_*.sql のみ（002〜006 の NNN_*.md は設計資料でマイグレーションではない）。
 */

import { promises as fs } from "fs";
import path from "path";
import { execFileSync } from "child_process";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, "../..");
const MIGRATION_DIR_REL = "docs/db-migration";
const MIGRATION_DIR = path.join(REPO_ROOT, MIGRATION_DIR_REL);
const LEDGER_FILE = "APPLIED.md";

const SQL_FILE_RE = /^(\d{3}[a-z]?)_.+\.sql$/;
const NUMBERED_DOC_RE = /^(\d{3})_.+\.md$/;

/** 番号を付けない既存の .sql（初期の単発スクリプト。台帳には別枠で記載） */
const UNNUMBERED_ALLOWED = ["add-defense-distribution.sql"];

/** base の取得から何時間で「古い」とみなすか */
const STALE_BASE_HOURS = 24;

const FROZEN_REASON =
  "本番適用済み。リネームすると docs/design・ADR・コード内コメント・PR履歴からの参照が壊れるため凍結（適用状況は APPLIED.md）";

/**
 * 既存の重複（凍結）。番号 -> 同番号で許可するファイル名の一覧。
 * 新規の重複は、ここに追加せず、後から作った側を最大番号+1にリネームして解消すること。
 * この一覧を増やす変更は、レビューで理由を明示すること。
 */
const ALLOWED_DUPLICATES = {
  "008": [
    "008_ADD_EXHIBITION_TO_RPC.sql",
    "008_accuracy_rpc.sql",
    "008_venue_rules.sql",
  ],
  "009": ["009_RACE_HISTORY_RPC.sql", "009_add_first_boat_avg_st.sql"],
  "020": ["020_outcome_distribution.sql", "020_race_history_cache.sql"],
  "021": ["021_external_predictions.sql", "021_poirot_predictions.sql"],
  "022": ["022_moriarty_setup.sql", "022_race_odds_trifecta_all.sql"],
  "029": ["029_race_analysis_rpc.sql", "029_watson_predictions.sql"],
  "030": ["030_ai_model_redesign_schema.sql", "030_mycroft_predictions.sql"],
  "035": ["035_create_racer_profiles.sql", "035_sns_marketing_hub_schema.sql"],
  "039": [
    "039_fix_volatility_percentile_in_predictions_rpc.sql",
    "039_sns_strategy_insights.sql",
  ],
  "047": [
    "047_race_cancellation_status.sql",
    "047_sns_topic_categories_feature_intro_repurpose.sql",
  ],
  "048": [
    "048_add_cancellation_status_to_predictions_rpc.sql",
    "048_drop_venues_avg_volatility_score.sql",
  ],
  "050": [
    "050_race_entries_racer_id_index.sql",
    "050_race_results_full_order_and_payouts.sql",
    "050_sns_topic_categories_humor.sql",
  ],
  "054": ["054_racer_grade_cache_table.sql", "054_sns_campaigns_schema.sql"],
  "059": [
    "059_exhibition_data_weight_prev_result.sql",
    "059_venue_grade_boat_stats.sql",
  ],
  "064": ["064_racer_series_points.sql", "064_venue_entry_course_stats.sql"],
};

const numericPart = (id) => Number.parseInt(id, 10);
const pad3 = (n) => String(n).padStart(3, "0");

/** ファイル名一覧を、番号 -> ファイル名[] にまとめる（NNN_*.sql のみ） */
function groupSqlById(fileNames) {
  const byId = new Map();
  for (const f of fileNames) {
    const m = SQL_FILE_RE.exec(f);
    if (!m) continue;
    byId.set(m[1], [...(byId.get(m[1]) ?? []), f]);
  }
  return byId;
}

/** 連続する欠番を "024" / "002-006" のような範囲表記にまとめる */
function formatRanges(nums) {
  const ranges = [];
  for (const n of nums) {
    const last = ranges[ranges.length - 1];
    if (last && last.end + 1 === n) last.end = n;
    else ranges.push({ start: n, end: n });
  }
  return ranges.map((r) =>
    r.start === r.end ? pad3(r.start) : `${pad3(r.start)}-${pad3(r.end)}`,
  );
}

/** --base=<ref> の値を取り出す（最後の指定を優先。未指定ならnull） */
function parseBaseRef(argv) {
  const values = argv
    .filter((a) => a.startsWith("--base="))
    .map((a) => a.slice("--base=".length));
  return values.length > 0 ? values[values.length - 1] : null;
}

/** base ref 上の docs/db-migration/ のファイル名一覧。取得できなければ理由つきで null */
function listBaseFiles(ref) {
  if (ref === "" || ref.startsWith("-")) {
    return { files: null, reason: `不正な --base 指定です: "${ref}"` };
  }
  try {
    const out = execFileSync(
      "git",
      ["ls-tree", "--name-only", ref, "--", `${MIGRATION_DIR_REL}/`],
      { cwd: REPO_ROOT, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
    const files = out
      .split("\n")
      .filter(Boolean)
      .map((p) => path.posix.basename(p));
    if (files.length === 0) {
      return {
        files: null,
        reason: `${ref} に ${MIGRATION_DIR_REL}/ のファイルが見つかりません`,
      };
    }
    return { files, reason: null };
  } catch (err) {
    const detail = String(err.stderr ?? err.message)
      .trim()
      .split("\n")[0];
    return {
      files: null,
      reason: `${ref} を取得できません（git fetch origin master 済みか確認）: ${detail}`,
    };
  }
}

/** ref の最新コミット日時。取得できなければ null */
function getRefCommitTime(ref) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", ref, "--"], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const date = new Date(out);
    return Number.isNaN(date.getTime()) ? null : date;
  } catch {
    return null;
  }
}

async function main() {
  const errors = [];
  const warnings = [];
  const notices = [];

  const localFiles = await fs.readdir(MIGRATION_DIR);
  const byId = groupSqlById(localFiles);
  const sqlFiles = [...byId.values()].flat();

  // 1. 重複
  let frozenCount = 0;
  for (const [id, files] of byId) {
    if (files.length < 2) continue;
    const allowed = ALLOWED_DUPLICATES[id];
    if (!allowed) {
      errors.push(
        `新たな番号重複: ${id} が${files.length}件（${files.join(", ")}）`,
      );
      continue;
    }
    frozenCount += 1;
    const unexpected = files.filter((f) => !allowed.includes(f));
    if (unexpected.length > 0) {
      errors.push(
        `許可済みの重複番号 ${id} に、許可リスト外のファイルが同番号で存在: ${unexpected.join(", ")}`,
      );
    }
  }
  for (const [id, allowed] of Object.entries(ALLOWED_DUPLICATES)) {
    const actual = byId.get(id) ?? [];
    const missing = allowed.filter((f) => !actual.includes(f));
    if (missing.length > 0) {
      warnings.push(
        `許可リストに残っているが存在しないファイル（ALLOWED_DUPLICATES から削除可）: ${missing.join(", ")}`,
      );
    }
  }

  // 2. 欠番（番号付きの設計資料 NNN_*.md も「使用済み」として扱う）
  const usedNumbers = new Set([
    ...[...byId.keys()].map(numericPart),
    ...localFiles
      .map((f) => NUMBERED_DOC_RE.exec(f)?.[1])
      .filter(Boolean)
      .map(numericPart),
  ]);
  if (usedNumbers.size > 0) {
    const maxLocal = Math.max(...usedNumbers);
    const gaps = [];
    for (let n = 1; n <= maxLocal; n += 1) {
      if (!usedNumbers.has(n)) gaps.push(n);
    }
    if (gaps.length > 0) {
      warnings.push(`欠番: ${formatRanges(gaps).join(", ")}（失敗にはしない）`);
    }
  }

  // 3. base の最大番号との比較。新規ファイル = ローカルにあり base に無いファイル
  let newFiles = null;
  const baseRef = parseBaseRef(process.argv.slice(2));
  if (baseRef === null) {
    notices.push(
      "--base 未指定のため、baseの最大番号との比較はスキップしました（npm run verify:migration-numbers は origin/master を指定済み）。",
    );
  } else {
    const { files: baseFiles, reason } = listBaseFiles(baseRef);
    const baseIds =
      baseFiles === null ? [] : [...groupSqlById(baseFiles).keys()];
    if (baseFiles === null) {
      notices.push(`baseの最大番号との比較をスキップしました: ${reason}`);
    } else if (baseIds.length === 0) {
      notices.push(
        `baseの最大番号との比較をスキップしました: ${baseRef} の ${MIGRATION_DIR_REL}/ に NNN_*.sql が1件もありません`,
      );
    } else {
      const baseSet = new Set(baseFiles);
      const baseMaxId = [...baseIds].sort().at(-1);
      newFiles = sqlFiles.filter((f) => !baseSet.has(f));
      for (const f of newFiles) {
        const id = SQL_FILE_RE.exec(f)[1];
        if (id <= baseMaxId) {
          errors.push(
            `新規ファイル ${f} の番号 ${id} が ${baseRef} の最大番号 ${baseMaxId} 以下です。${pad3(numericPart(baseMaxId) + 1)} 以降にリネームしてください`,
          );
        }
      }
      notices.push(
        `${baseRef} の最大番号は ${baseMaxId}、このブランチの新規ファイル ${newFiles.length}件。次の新規マイグレーションは ${pad3(numericPart(baseMaxId) + 1)} 以降を使う（着手時とPR作成前に fetch して再確認）。`,
      );
      const commitTime = getRefCommitTime(baseRef);
      if (commitTime !== null) {
        const ageHours = (Date.now() - commitTime.getTime()) / 3_600_000;
        notices.push(
          `${baseRef} の最新コミット日時: ${commitTime.toISOString()}（${Math.floor(ageHours)}時間前）`,
        );
        if (ageHours > STALE_BASE_HOURS) {
          warnings.push(
            `${baseRef} が${STALE_BASE_HOURS}時間以上前の状態です。他セッションが新しい番号をmasterに入れている可能性があるため、git fetch origin master してから再実行してください`,
          );
        }
      }
    }
  }

  // 4. 台帳（APPLIED.md）に、ファイル名の行（表の行）があること
  try {
    const ledger = await fs.readFile(
      path.join(MIGRATION_DIR, LEDGER_FILE),
      "utf8",
    );
    const unlisted = sqlFiles.filter((f) => !ledger.includes(`| ${f} |`));
    const newSet = new Set(newFiles ?? []);
    const unlistedNew = unlisted.filter((f) => newSet.has(f));
    const unlistedOld = unlisted.filter((f) => !newSet.has(f));
    if (unlistedNew.length > 0) {
      errors.push(
        `新規マイグレーションの行が ${LEDGER_FILE} の表にありません（適用状況を追記すること）: ${unlistedNew.join(", ")}`,
      );
    }
    if (unlistedOld.length > 0) {
      warnings.push(
        `${LEDGER_FILE} の表に未記載のマイグレーション${newFiles === null ? "（--base 未指定のため新規/既存を区別できません）" : ""}: ${unlistedOld.join(", ")}`,
      );
    }
  } catch (err) {
    warnings.push(
      `${LEDGER_FILE} を読めませんでした（台帳との突合をスキップ）: ${err.message}`,
    );
  }

  // 5. NNN_*.sql の命名規則に合わない .sql
  const misnamed = localFiles.filter(
    (f) =>
      f.endsWith(".sql") &&
      !SQL_FILE_RE.test(f) &&
      !UNNUMBERED_ALLOWED.includes(f),
  );
  if (misnamed.length > 0) {
    errors.push(
      `番号付きの命名規則（NNN_名前.sql、NNNは3桁ゼロ埋め、サブ番号は英小文字1字）に合わない .sql（番号検査をすり抜けるため）: ${misnamed.join(", ")}`,
    );
  }

  for (const w of warnings) console.warn(`WARN: ${w}`);
  for (const n of notices) console.log(`INFO: ${n}`);

  if (errors.length === 0) {
    console.log(
      `OK: マイグレーション番号の新たな重複なし（${sqlFiles.length}件、凍結済みの既存重複 ${frozenCount}番号）。\n  凍結の理由: ${FROZEN_REASON}`,
    );
    return;
  }

  console.error(
    `NG: マイグレーション番号の問題が${errors.length}件見つかりました。\n`,
  );
  for (const e of errors) console.error(`  - ${e}`);
  console.error(
    "\n解消するには、より新しい方（git logで作成日時が新しい方）を origin/master の最大番号+1以降にリネームし、" +
      "そのマイグレーションを参照している docs/design/ 配下のドキュメント・コード内コメント・APPLIED.md も合わせて更新すること。" +
      "既存の（適用済みの）重複を許容する場合のみ ALLOWED_DUPLICATES に理由つきで追加する。",
  );
  process.exit(1);
}

main().catch((err) => {
  console.error(`NG: 検査を実行できませんでした: ${err.message}`);
  process.exit(1);
});
