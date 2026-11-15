// データ健全性レポートのMarkdown描画。data-health-report.js から移しただけ（出力は1字も変えない）。

import { ODDS_FULL_GRID_SINCE } from "../lib/dataHealth/coverageSpec.js";
import { DETECTION_LAG } from "../lib/scrapeJobs/expectedUnpublished.js";
import {
  OVERWRITTEN_ON_UPSERT,
  formatBytes,
  formatPct,
  tableHeader,
  tableRow,
} from "./dataHealthReportConfig.js";

export function renderTimingColumns(report) {
  const lines = [];
  lines.push("## 3. 取得時刻列の有無");
  lines.push("");
  lines.push(tableHeader(["テーブル", "時刻系の列", "タイミング計測"]));
  for (const t of report.timingColumns) {
    const label =
      t.quality === "measurable"
        ? `可（${t.strongColumns
            .map((c) =>
              OVERWRITTEN_ON_UPSERT.has(c)
                ? `${c}=最終書き込み時刻`
                : c === "created_at"
                  ? "created_at=初回保存時刻。追加前の行はNULL"
                  : c,
            )
            .join("/")}）`
        : t.quality === "weak"
          ? "不能（作成/更新時刻のみ。取得時刻ではない）"
          : t.quality === "none"
            ? "不能（時刻列なし）"
            : "テーブル不在";
    lines.push(tableRow([t.table, t.columns.join(", ") || "-", label]));
  }
  lines.push("");
  return lines;
}

export function renderScrapedTimestamps(report) {
  const lines = [];
  lines.push(
    `### 3-2. 取得時刻（created_at）の分布（${report.scrapedTimestamps.period.start}〜${report.scrapedTimestamps.period.end}、created_at が非NULLのレースのみ）`,
  );
  lines.push("");
  if (report.scrapedTimestamps.error) {
    lines.push(`**${report.scrapedTimestamps.error}**`);
    lines.push("");
  }
  const scrapedTables = report.scrapedTimestamps.tables;
  if (scrapedTables.every((t) => !t.applied)) {
    lines.push(
      "未適用のため計測不能: created_at・updated_at 列が無い（マイグレーション071が未適用）。適用後、新規に保存された行から計測できる（既存の行はNULLで、分母に含めない）。",
    );
  } else {
    lines.push(
      "「発走の何分前に保存されたか」は、レースごとに最も早い created_at で測る（正=発走前、負=発走後）。" +
        "分母は created_at が非NULLのレース数（マイグレーション071より前の行はNULLで含めない）。累積割合は「発走m分前までに保存されていたレース」の割合。",
    );
    lines.push("");
    lines.push(
      tableHeader([
        "テーブル",
        "期間内のレース",
        "行あり",
        "created_at非NULL(分母)",
        "発走の何分前に保存 p10/p50/p90",
        "発走後に保存",
        "発走m分前までに保存(累積)",
      ]),
    );
    const fmtDist = (d) =>
      d.p50 === null ? "-" : `${d.p10} / ${d.p50} / ${d.p90}`;
    for (const t of scrapedTables) {
      if (!t.applied) {
        lines.push(
          tableRow([t.table, "-", "-", "-", "未適用のため計測不能", "-", "-"]),
        );
        continue;
      }
      lines.push(
        tableRow([
          t.table,
          t.racesInPeriod,
          t.racesWithRows,
          t.racesWithCreatedAt,
          fmtDist(t.leadMinutes),
          t.savedAfterStart,
          t.savedBy.length === 0
            ? "-"
            : t.savedBy
                .map(
                  (w) =>
                    `${w.minutesBefore}分前: ${formatPct(w.rate)} (${w.hit}/${w.denominator})`,
                )
                .join(" / "),
        ]),
      );
    }
    for (const t of scrapedTables.filter((x) => x.applied && x.valueFilled)) {
      lines.push("");
      lines.push(
        `${t.table} の値が揃った時刻（展示タイムが入っている行の updated_at の最大値。値が変わった最後の時刻）: 対象${t.valueFilled.races}レース、発走の何分前 p10/p50/p90 = ${fmtDist(t.valueFilled.leadMinutes)}`,
      );
    }
  }
  lines.push("");
  return lines;
}

export function renderMonthly(report) {
  const lines = [];
  lines.push("## 4. 月別の結果充足率（races全期間）");
  lines.push("");
  lines.push(
    tableHeader([
      "月",
      "日数",
      "総数",
      "中止除外",
      "分母",
      "結果あり",
      "充足率(全体)",
      "充足率(中止除外)",
      "resultsに行なし",
      "行あり・rank1なし",
      "全滅日",
      "一部欠落日",
    ]),
  );
  for (const m of report.monthlyResults) {
    lines.push(
      tableRow([
        m.month,
        m.days,
        m.total,
        m.excluded,
        m.denominator,
        m.withResult,
        formatPct(m.rateAll),
        `${formatPct(m.rateExcludingCancelled)}${m.belowThreshold ? " (未達)" : ""}`,
        m.noResultRow,
        m.rowWithoutRank1,
        m.zeroResultDays,
        m.partialDays,
      ]),
    );
  }
  lines.push("");
  return lines;
}

export function renderFreshness(report) {
  const lines = [];
  lines.push("## 5. 取得系テーブルの件数と鮮度");
  lines.push("");
  lines.push(tableHeader(["テーブル", "件数", "最新の取得時刻", "最新の日付"]));
  for (const f of report.freshness) {
    lines.push(
      tableRow([
        f.empty ? `**【空】${f.table}**` : f.table,
        f.count,
        f.latestTime ?? "-",
        f.latestDate ?? "-",
      ]),
    );
  }
  lines.push("");
  lines.push(tableHeader(["主要テーブルの最新位置", "値"]));
  for (const l of report.latest) lines.push(tableRow([l.key, l.value ?? "-"]));
  lines.push("");
  return lines;
}

export function renderWorkflows(report) {
  const lines = [];
  lines.push("## 6. 取得ジョブの鮮度（scrape-*ワークフロー）");
  lines.push("");
  if (report.workflows.skipped) {
    lines.push(`スキップ: ${report.workflows.reason}`);
  } else {
    lines.push(
      tableHeader([
        "ワークフロー",
        "最終実行",
        "最終実行の結果",
        "最終success",
        "successからの経過(時間)",
        "許容(時間)",
      ]),
    );
    for (const w of report.workflows.items) {
      if (w.error) {
        lines.push(
          tableRow([
            `**【取得失敗】${w.workflow}**`,
            w.error,
            "-",
            "-",
            "-",
            "-",
          ]),
        );
        continue;
      }
      lines.push(
        tableRow([
          w.noRunHistory ? `**【実行履歴0件】${w.workflow}**` : w.workflow,
          w.lastRunAt ?? "-",
          w.lastRunConclusion ?? "-",
          w.lastSuccessAt ?? "なし",
          w.hoursSinceLastSuccess ?? "-",
          w.expectedMaxSuccessHours ?? "-",
        ]),
      );
    }
  }
  lines.push("");
  return lines;
}

export function renderDbSize(report) {
  const lines = [];
  lines.push("## 7. DBサイズ");
  lines.push("");
  lines.push(`データベース全体: ${formatBytes(report.dbSize.databaseBytes)}`);
  lines.push("");
  lines.push(tableHeader(["テーブル（総サイズ上位10）", "サイズ"]));
  for (const t of report.dbSize.topTables)
    lines.push(tableRow([t.table, formatBytes(t.bytes)]));
  lines.push("");
  return lines;
}

export function renderNotes() {
  const lines = [];
  lines.push("## 注記（解釈上の注意）");
  lines.push("");
  for (const note of [
    "着順4位以降（rank4〜6）は、欠場・失格・転覆等で6艇が完走しないレースでは、公式が最後の順位を付けないため、欠損ではない。完走艇数を艇別の着欄（finish_mark）で確定できるレースは、完走艇数まで順位が付いているかで判定する。確定できずrank4〜6に欠けがあるレースは「判定不能」として分母外に件数を別に出す（欠損に混ぜない）。判定不能は、着欄の取得（結果ページの再取得・K/Bの取り込み）が進むほど減る。「判定不能を全て欠損とした場合」の下限も併記する（1-2節）。",
    `全券種オッズ（trio・exacta・quinella・wideと、5種すべて）は、全通り取得の開始日（${ODDS_FULL_GRID_SINCE}）以降のレースのみを期待件数の対象とする（ユーザー承認済み、2026-09-21。それ以前は時系列で取り直せない）。それ以前の日は「対象外(取得開始前)」として分母から外す。trifecta_all は、2026-07-12以降に保存があり、対象外を設けない。`,
    "開催中止の除外は races.cancellation_status='confirmed' のみ。中止検知の導入前の期間は除外できず、月別の未充足に中止レースが含まれうる。",
    "全券種オッズ・窓内取得率は、取得方式の変更（ADR-0057の窓構成・全券種の保存）の前後で値が大きく変わりうる。日別表で変化点を確認する。",
    "race_results.result_at は scrape-results の実行（upsert）ごとに更新される最終書き込み時刻。predictions.predicted_at も買い目オッズ更新で更新される。",
    "窓は隣り合うものが重なる（例: 10分前=7〜13分前、5分前=2〜8分前）ため、1回の取得が複数の窓を満たしうる。窓別の取得率は過大評価側に出る。",
    "取りこぼしの一因はGitHub Actionsのキャンセル起因（BOA-342/344の実測では、取りこぼしの81〜94%が、キャンセルされた実行が前後5分以内にあった）。この指標自体は原因を区別しない。",
    "展示・STは「行の有無」と「値の有無」を分けて出す。展示タイムより先にSTだけの行が書かれる会場があり、行の有無だけでは欠落を過小評価する（BOA-356）。展示の判定基準は check-exhibition-gap-rate.js に合わせ、1艇でも展示タイムが入っていれば取得済みとする。",
    "窓内取得率の分母は結果確定済み（rank1あり）・中止除外のレース。土日を含まない期間は完了の定義Bの根拠にならない。第1レースの60分前の窓は、公式の発売・公開が窓の後に始まることがあるため、後の窓で公開が確認できたもの（想定内の未公開）だけを閾値判定の分母から外す（件数は別に出す。BOA-386）。",
    "取得時刻の分布（3-2）は exhibition_data・race_entries・race_start_timings の created_at（行が最初に保存された時刻、マイグレーション071）を使う。追加前の行はNULLで分母に含まれないため、適用直後は対象レースが少ない（適用から数日で、土日を含む7日分が溜まるまで完了の定義Bの根拠にならない）。過去日のバックフィル（手動スクリプト）で作られた行は、バックフィル時刻が created_at になり「発走後に保存」に数えられる。 3-2は「最初に保存された時刻」で測るため、公式の窓（中心±3分）に取得が入ったかどうか（2の窓内取得率の定義）とは別の指標で、変更の無い取得は行に痕跡を残さない（WS8(b)）。分母は created_at が非NULLのレースで、行が1件も無いレース（取得できなかったレース）は含まれない（「行あり」との差で確認する）。3-2の「値が揃った時刻」は、展示タイム以外の列の変更でも遅く出る上限の近似。exhibition_data は、発走60分前の体重だけの窓（BOA-500）が当日体重・調整重量だけの行を先に作るため、最初の保存時刻は体重の取得時刻を表す。展示の取得時刻は「値が揃った時刻」で見る。",
  ]) {
    lines.push(`- ${note}`);
  }
  lines.push("");
  return lines;
}
