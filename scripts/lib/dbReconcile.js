/**
 * 本番 DB の自動の適用（ADR-0097）で、次に当てるマイグレーションを選ぶための純粋関数。
 * 事実（git・GitHub API・台帳）の取得は scripts/db/db-reconcile.js が行い、ここは判定だけをする。
 *
 * 当てる対象は次の5点を全部満たすファイルだけ（ADR-0097「本番 SQL の適用」）:
 *   1. 切り替えのコミットより後に、master の first-parent のコミット（squash のマージ）で足された（A だけ）
 *   2. そのコミットを merge_commit_sha に持つ PR が merged・base master で、ファイルの blob が PR の head と今の master HEAD で同じ
 *   3. その PR の head SHA に審査の App の APPROVE がある
 *   4. 台帳 APPLIED.md の「適用状況」が「未適用」で始まり、その行も同じコミットで足されている
 *   5. 同じ番号の NNN-runbook.md が無い
 */
import { migrationNumber } from "./dbApplySql.js";

export const LEDGER_STATES = ["適用済み", "未適用", "不明", "廃止"];

/**
 * 台帳の行の「適用状況」の先頭の語。行が無い・4つのどれでもないときは null
 * @param {string} ledger
 * @param {string} fileName
 * @returns {string | null}
 */
export function ledgerState(ledger, fileName) {
  const row = ledger
    .split("\n")
    .find(
      (l) => l.startsWith("|") && (l.split("|")[2] ?? "").trim() === fileName,
    );
  if (!row) return null;
  const cell = (row.split("|")[3] ?? "").trim();
  return LEDGER_STATES.find((s) => cell.startsWith(s)) ?? null;
}

/**
 * コミットの APPLIED.md の差分（unified diff）に、そのファイルの「未適用」の行が足されているか
 * @param {string} diffText
 * @param {string} fileName
 */
export function ledgerRowAddedAsUnapplied(diffText, fileName) {
  return diffText
    .split("\n")
    .filter((l) => l.startsWith("+|"))
    .map((l) => l.slice(1))
    .some(
      (row) =>
        (row.split("|")[2] ?? "").trim() === fileName &&
        (row.split("|")[3] ?? "").trim().startsWith("未適用"),
    );
}

/** 番号の順（"013b" は 13 と 14 の間） */
export const byMigrationNumber = (a, b) =>
  migrationNumber(a).localeCompare(migrationNumber(b), "en", {
    numeric: true,
  }) || a.localeCompare(b);

/**
 * 1本のファイルが5点の検査を通るか
 *
 * @param {{
 *   file: string,                       // docs/db-migration/NNN_x.sql
 *   addCommits: string[],               // 切り替えより後の first-parent で、このファイルを A で足したコミット
 *   commitParents: number,              // そのコミットの親の数（squash なら 1）
 *   ledgerState: string | null,         // 今の master の台帳の状態
 *   ledgerRowAddedInCommit: boolean,    // 同じコミットで台帳に「未適用」の行が足されたか
 *   runbookExists: boolean,
 *   prs: { number: number, merged: boolean, baseRef: string, mergeCommitSha: string | null, headSha: string }[],
 *   headBlob: string | null,            // PR の head でのファイルの blob
 *   masterBlob: string | null,          // 今の master HEAD でのファイルの blob
 *   reviews: { userId: number, state: string, commitId: string }[],
 *   reviewerUserId: number,
 * }} facts
 * @returns {{ ok: boolean, reasons: string[], pr: number | null, headSha: string | null }}
 */
export function evaluateCandidate(facts) {
  const reasons = [];
  const name = facts.file.split("/").pop();

  // 1
  if (facts.addCommits.length !== 1) {
    reasons.push(
      `切り替えより後に足したコミットが1つでない（${facts.addCommits.length}件）`,
    );
  }
  const commit = facts.addCommits[0] ?? null;
  if (commit && facts.commitParents !== 1) {
    reasons.push(
      `足したコミット ${commit.slice(0, 9)} が squash のマージでない（親が ${facts.commitParents}）`,
    );
  }

  // 2
  const pr = facts.prs.find(
    (p) => p.merged && p.baseRef === "master" && p.mergeCommitSha === commit,
  );
  if (!pr) {
    reasons.push(
      `コミット ${commit?.slice(0, 9) ?? "?"} を merge_commit_sha に持つ、master へマージ済みの PR が無い`,
    );
  }
  if (
    !facts.masterBlob ||
    !facts.headBlob ||
    facts.masterBlob !== facts.headBlob
  ) {
    reasons.push(
      `ファイルの中身が PR の head と今の master で違う（head ${facts.headBlob?.slice(0, 9) ?? "なし"} / master ${facts.masterBlob?.slice(0, 9) ?? "なし"}）`,
    );
  }

  // 3
  if (pr) {
    const approved = facts.reviews.some(
      (r) =>
        r.userId === facts.reviewerUserId &&
        r.state === "APPROVED" &&
        r.commitId === pr.headSha,
    );
    if (!approved)
      reasons.push(
        `PR #${pr.number} の head ${pr.headSha.slice(0, 9)} に審査の App の承認が無い`,
      );
  }

  // 4
  if (facts.ledgerState !== "未適用") {
    reasons.push(
      `台帳の状態が「未適用」でない（${facts.ledgerState ?? "行が無いか、決まった語で始まらない"}）`,
    );
  }
  if (!facts.ledgerRowAddedInCommit) {
    reasons.push(
      `台帳の ${name} の「未適用」の行が、ファイルと同じコミットで足されていない`,
    );
  }

  // 5
  if (facts.runbookExists) {
    reasons.push(
      `${migrationNumber(name)}-runbook.md がある（自動では当てない）`,
    );
  }

  return {
    ok: reasons.length === 0,
    reasons,
    pr: pr?.number ?? null,
    headSha: pr?.headSha ?? null,
  };
}

/**
 * 切り替えより後に足されたファイルを番号の順に見て、次に当てる1本を決める。
 * 台帳で適用済み・不明・廃止のものと、今の master に無いもの（後で消した・改名した）は飛ばす。
 * 消したものを飛ばさないと、以後の番号が永久に当たらなくなる。飛ばしたものは removed に出す。
 * 最初に見つかった未処理のファイルが検査を通らなければ、そこで止める（番号の順を飛ばして後ろのファイルを当てない。
 * 後ろが前に依存しうるため）。
 *
 * @param {{ file: string, ledgerState: string | null, existsAtHead?: boolean, evaluation: ReturnType<typeof evaluateCandidate> | null }[]} candidates
 * @returns {{ status: "none", removed: string[] } | { status: "selected" | "blocked", file: string, pr: number | null, headSha: string | null, reasons: string[], removed: string[] }}
 */
export function pickNext(candidates) {
  const removed = candidates
    .filter((c) => c.existsAtHead === false)
    .map((c) => c.file);
  const pending = [...candidates]
    .sort((a, b) =>
      byMigrationNumber(a.file.split("/").pop(), b.file.split("/").pop()),
    )
    .filter((c) => c.existsAtHead !== false)
    .filter((c) => c.ledgerState === null || c.ledgerState === "未適用");
  const first = pending[0];
  if (!first) return { status: "none", removed };
  return {
    status: first.evaluation.ok ? "selected" : "blocked",
    file: first.file,
    pr: first.evaluation.pr,
    headSha: first.evaluation.headSha,
    reasons: first.evaluation.reasons,
    removed,
  };
}

/** db-apply の他の run が動いている・待っているか（自分の run は除く） */
export function isBusy(runs, currentRunId) {
  const active = new Set([
    "in_progress",
    "queued",
    "waiting",
    "requested",
    "pending",
  ]);
  return runs.some(
    (r) => String(r.id) !== String(currentRunId) && active.has(r.status),
  );
}

/**
 * 判定のラベルから、当て方を決める。試運転の間は当てない
 * @param {{ dryRun: boolean, label: "light" | "heavy" | "stop" }} args
 * @returns {"dry-run" | "auto" | "gated" | "stop"}
 */
export function decideMode({ dryRun, label }) {
  if (label === "stop") return "stop";
  if (dryRun) return "dry-run";
  if (label === "light") return "auto";
  if (label === "heavy") return "gated";
  return "stop";
}

/**
 * 重いものの承認待ちが6時間を超えた run。定期の起動（1時間ごと）で1回だけ知らせるため、6〜7時間の窓に入ったものだけを返す
 * @param {{ id: number, status: string, run_started_at?: string, created_at: string, html_url: string }[]} runs
 * @param {Date} now
 */
export function staleWaitingRuns(runs, now, { minHours = 6, maxHours = 7 } = {}) {
  return runs
    .filter((r) => r.status === "waiting")
    .filter((r) => {
      const hours = (now.getTime() - Date.parse(r.run_started_at ?? r.created_at)) / 3_600_000;
      return hours >= minHours && hours < maxHours;
    })
    .map((r) => r.html_url);
}

/**
 * 前回の定期の起動より後に起きたことか（通知を1回だけにするため。状態を持たずに、時刻の窓で重複を避ける）
 * @param {string | null} iso
 * @param {Date} now
 */
export function isRecent(iso, now, minutes = 65) {
  if (!iso) return false;
  const age = now.getTime() - Date.parse(iso);
  return age >= 0 && age < minutes * 60_000;
}

const LABEL_JA = { light: "軽い", heavy: "重い", stop: "止める" };

/**
 * 定期の起動の結果を、Slack と元の PR に出す1つの文にする。出すものが無ければ null
 * @param {{ dryRun: boolean, status: string, file: string, pr: string, addedAt: string | null, label: string,
 *           reasons: string[], applyResult: string, stale: string[], now: Date }} args
 */
export function buildNotifyMessage({ dryRun, status, file, pr, addedAt, label, reasons, applyResult, stale, now }) {
  const lines = [];
  const name = file ? file.split("/").pop() : "";
  // 自動では当てずに止まっている SQL（blocked・止める）は、以後の番号も止める。足した直後の1回に加え、毎朝（UTC 0時台の
  // 起動、JST 9時台）にも念を押す
  const remind = now.getUTCHours() === 0;
  const prRef = pr ? `（PR #${pr}）` : "";
  if (status === "blocked" && (isRecent(addedAt, now) || remind)) {
    lines.push(`本番 SQL の自動の適用: ${name}${prRef} は自動では当てない（5点の検査を通らない）`);
    for (const r of reasons) lines.push(`- ${r}`);
  }
  if (status === "selected") {
    const ja = LABEL_JA[label] ?? label;
    if (dryRun && isRecent(addedAt, now)) {
      lines.push(`本番 SQL の自動の適用（試運転、当てていない）: ${name}${prRef} は「${ja}」。本番なら${label === "light" ? "承認なしで当てた" : label === "heavy" ? "オーナーの1タップを待った" : "当てずに止めた"}`);
      for (const r of reasons) lines.push(`- ${r}`);
    } else if (!dryRun && label === "stop" && (isRecent(addedAt, now) || remind)) {
      lines.push(`本番 SQL の自動の適用: ${name}${prRef} は「止める」。当てていない`);
      for (const r of reasons) lines.push(`- ${r}`);
    } else if (!dryRun && (applyResult === "success" || applyResult === "failure")) {
      lines.push(
        applyResult === "success"
          ? `本番 SQL の自動の適用: ${name}${prRef} を当てた（${ja}）`
          : `本番 SQL の自動の適用: ${name}${prRef} の適用に失敗した（${ja}）。変更は全て戻っている。以後の番号は当てずに止まる`,
      );
    }
  }
  for (const url of stale) lines.push(`本番 SQL の重い適用が、6時間以上オーナーの承認を待っている: ${url}`);
  return lines.length > 0 ? lines.join("\n") : null;
}
