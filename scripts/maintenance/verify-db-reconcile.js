#!/usr/bin/env node
/**
 * verify-db-reconcile.js - 本番 DB の自動の適用の突き合わせ（scripts/lib/dbReconcile.js、ADR-0097）の検証。
 *
 * 確認する観点:
 *   1. 台帳の状態を先頭の語で読む（決まった4語以外・行が無いものは null）
 *   2. 台帳の「未適用」の行が同じコミットで足されたかを差分から読む
 *   3. 5点の検査がそれぞれ単独で落とす（足したコミットが1つでない・squash でない・PR が無い／未マージ／base が違う／
 *      merge_commit_sha が違う・blob が違う・審査の App の承認が無い／別人／古い head・台帳・runbook）
 *   4. 次の1本の選び方（番号の順、適用済み・不明・廃止は飛ばす、通らなければそこで止めて後ろを当てない）
 *   5. db-apply の他の run が動いている・待っているときは何もしない（自分の run は除く）
 *   6. 当て方（試運転は当てない、止めるは止める）、6時間の承認待ち、通知を1回だけにする時刻の窓、通知の文
 */
import {
  buildNotifyMessage,
  byMigrationNumber,
  decideMode,
  isRecent,
  staleWaitingRuns,
  evaluateCandidate,
  isBusy,
  ledgerRowAddedAsUnapplied,
  ledgerState,
  pickNext,
} from "../lib/dbReconcile.js";

let failures = 0;
function check(label, pass, detail = "") {
  if (pass) {
    console.log(`✅ ${label}`);
  } else {
    failures += 1;
    console.error(`❌ ${label}${detail ? ` (${detail})` : ""}`);
  }
}

// 1. 台帳の状態
{
  const ledger = [
    "| 番号 | ファイル | 適用状況 | 確認した根拠 |",
    "|---|---|---|---|",
    "| 170 | 170_a.sql | 未適用（適用はオーナー） | x |",
    "| 171 | 171_b.sql | 適用済み（2026-10-20） | x |",
    "| 172 | 172_c.sql | 2026-09-24 に確認 | x |",
    "| 173 | 173_d.sql | 不明 | x |",
    "| 174 | 174_e.sql | 廃止（適用しない） | x |",
  ].join("\n");
  check("未適用で始まる", ledgerState(ledger, "170_a.sql") === "未適用");
  check("適用済みで始まる", ledgerState(ledger, "171_b.sql") === "適用済み");
  check("日付で始まる行は null", ledgerState(ledger, "172_c.sql") === null);
  check("不明", ledgerState(ledger, "173_d.sql") === "不明");
  check("廃止", ledgerState(ledger, "174_e.sql") === "廃止");
  check("行が無ければ null", ledgerState(ledger, "175_f.sql") === null);
  check(
    "別のファイル名の部分一致で拾わない",
    ledgerState(ledger, "70_a.sql") === null,
  );
}

// 2. 台帳の差分
{
  const diff = [
    "@@ -200,3 +200,4 @@",
    " | 169 | 169_z.sql | 適用済み | x |",
    "+| 170 | 170_a.sql | 未適用（適用はオーナー） | x |",
    "-| 171 | 171_b.sql | 未適用 | x |",
    "+| 171 | 171_b.sql | 適用済み | x |",
  ].join("\n");
  check("足した未適用の行を読む", ledgerRowAddedAsUnapplied(diff, "170_a.sql"));
  check(
    "消した行（-）は数えない",
    !ledgerRowAddedAsUnapplied(diff, "171_b.sql"),
  );
  check(
    "未変更の行（ ）は数えない",
    !ledgerRowAddedAsUnapplied(diff, "169_z.sql"),
  );
}

// 3. 5点の検査
const REVIEWER = 9001;
const base = () => ({
  file: "docs/db-migration/170_a.sql",
  addCommits: ["c".repeat(40)],
  commitParents: 1,
  ledgerState: "未適用",
  ledgerRowAddedInCommit: true,
  runbookExists: false,
  prs: [
    {
      number: 1700,
      merged: true,
      baseRef: "master",
      mergeCommitSha: "c".repeat(40),
      headSha: "h".repeat(40),
    },
  ],
  headBlob: "b".repeat(40),
  masterBlob: "b".repeat(40),
  reviews: [{ userId: REVIEWER, state: "APPROVED", commitId: "h".repeat(40) }],
  reviewerUserId: REVIEWER,
});
{
  const ok = evaluateCandidate(base());
  check(
    "全部そろえば通る",
    ok.ok && ok.pr === 1700 && ok.headSha === "h".repeat(40),
    JSON.stringify(ok),
  );

  const cases = {
    "1: 足したコミットが2つ（消して足し直した）": (f) => ({
      ...f,
      addCommits: ["c".repeat(40), "d".repeat(40)],
    }),
    "1: 足したコミットが無い": (f) => ({ ...f, addCommits: [] }),
    "1: マージコミット（親が2つ）": (f) => ({ ...f, commitParents: 2 }),
    "2: PR が無い（直接の push）": (f) => ({ ...f, prs: [] }),
    "2: 未マージの PR だけ": (f) => ({
      ...f,
      prs: [{ ...f.prs[0], merged: false }],
    }),
    "2: base が master でない": (f) => ({
      ...f,
      prs: [{ ...f.prs[0], baseRef: "develop" }],
    }),
    "2: merge_commit_sha が別（commits/{sha}/pulls が返す無関係な PR）": (
      f,
    ) => ({
      ...f,
      prs: [{ ...f.prs[0], mergeCommitSha: "e".repeat(40) }],
    }),
    "2: マージ後に master で直された（blob が違う）": (f) => ({
      ...f,
      masterBlob: "x".repeat(40),
    }),
    "2: master から消された": (f) => ({ ...f, masterBlob: null }),
    "2: head の blob が取れない": (f) => ({ ...f, headBlob: null }),
    "3: 承認が無い": (f) => ({ ...f, reviews: [] }),
    "3: 審査の App 以外の承認": (f) => ({
      ...f,
      reviews: [{ ...f.reviews[0], userId: 1234 }],
    }),
    "3: 古い head への承認": (f) => ({
      ...f,
      reviews: [{ ...f.reviews[0], commitId: "o".repeat(40) }],
    }),
    "3: 承認でなく COMMENTED": (f) => ({
      ...f,
      reviews: [{ ...f.reviews[0], state: "COMMENTED" }],
    }),
    "3: DISMISSED": (f) => ({
      ...f,
      reviews: [{ ...f.reviews[0], state: "DISMISSED" }],
    }),
    "4: 台帳が適用済み": (f) => ({ ...f, ledgerState: "適用済み" }),
    "4: 台帳に行が無い": (f) => ({ ...f, ledgerState: null }),
    "4: 台帳の行が別のコミットで足された": (f) => ({
      ...f,
      ledgerRowAddedInCommit: false,
    }),
    "5: runbook がある": (f) => ({ ...f, runbookExists: true }),
  };
  for (const [name, mutate] of Object.entries(cases)) {
    const r = evaluateCandidate(mutate(base()));
    check(
      `落とす: ${name}`,
      !r.ok && r.reasons.length > 0,
      JSON.stringify(r.reasons),
    );
  }
  const many = evaluateCandidate({
    ...base(),
    runbookExists: true,
    ledgerRowAddedInCommit: false,
  });
  check(
    "理由は全部出す（最初の1つで止めない）",
    many.reasons.length === 2,
    JSON.stringify(many.reasons),
  );
}

// 4. 次の1本
{
  const ok = (file) => ({
    file,
    ledgerState: "未適用",
    evaluation: evaluateCandidate({ ...base(), file }),
  });
  const ng = (file) => ({
    file,
    ledgerState: "未適用",
    evaluation: evaluateCandidate({ ...base(), file, reviews: [] }),
  });
  const done = (file, state = "適用済み") => ({
    file,
    ledgerState: state,
    evaluation: null,
  });
  const d = (n) => `docs/db-migration/${n}.sql`;

  check("候補が無ければ none", pickNext([]).status === "none");
  check(
    "全部適用済みなら none",
    pickNext([done(d("170_a")), done(d("171_b"), "廃止")]).status === "none",
  );
  const sel = pickNext([ok(d("172_c")), done(d("170_a")), ok(d("171_b"))]);
  check(
    "番号の小さい方を選ぶ",
    sel.status === "selected" && sel.file === d("171_b"),
    JSON.stringify(sel),
  );
  const blk = pickNext([ok(d("172_c")), ng(d("171_b"))]);
  check(
    "前のファイルが通らなければ止め、後ろを当てない",
    blk.status === "blocked" && blk.file === d("171_b"),
    JSON.stringify(blk),
  );
  check("止めたときは理由を出す", blk.reasons.length > 0);
  const nullState = pickNext([
    {
      file: d("171_b"),
      ledgerState: null,
      evaluation: evaluateCandidate({ ...base(), ledgerState: null }),
    },
  ]);
  check(
    "台帳に行が無い新しいファイルも止める（黙って飛ばさない）",
    nullState.status === "blocked",
  );
  const gone = { file: d("170_a"), ledgerState: null, existsAtHead: false, evaluation: null };
  const afterGone = pickNext([gone, ok(d("171_b"))]);
  check(
    "後で master から消したファイルは飛ばし、後ろの番号を止めない",
    afterGone.status === "selected" && afterGone.file === d("171_b"),
    JSON.stringify(afterGone),
  );
  check("飛ばした消したファイルは removed に出す", afterGone.removed?.includes(d("170_a")));
  check("消したファイルだけなら none", pickNext([gone]).status === "none");
  check(
    "013b は 013 と 014 の間",
    ["014_x.sql", "013b_x.sql", "013_x.sql"]
      .sort(byMigrationNumber)
      .join(",") === "013_x.sql,013b_x.sql,014_x.sql",
  );
  check(
    "番号は数として比べる（99 < 100）",
    ["100_x.sql", "099_x.sql"].sort(byMigrationNumber)[0] === "099_x.sql",
  );
}

// 5. busy
{
  check(
    "他の run が無ければ busy でない",
    !isBusy([{ id: 1, status: "in_progress" }], 1),
  );
  check(
    "他の run が承認待ち（waiting）なら busy",
    isBusy([{ id: 2, status: "waiting" }], 1),
  );
  check(
    "他の run が実行中なら busy",
    isBusy([{ id: 2, status: "in_progress" }], "1"),
  );
  check(
    "他の run が待ち行列（queued）なら busy",
    isBusy([{ id: 2, status: "queued" }], 1),
  );
  check(
    "終わった run は busy にしない",
    !isBusy([{ id: 2, status: "completed" }], 1),
  );
}

// 6. 当て方・承認待ち・通知
{
  check("試運転は軽くても当てない", decideMode({ dryRun: true, label: "light" }) === "dry-run");
  check("試運転でも止めるは止める", decideMode({ dryRun: true, label: "stop" }) === "stop");
  check("本番の軽いは auto", decideMode({ dryRun: false, label: "light" }) === "auto");
  check("本番の重いは gated", decideMode({ dryRun: false, label: "heavy" }) === "gated");
  check("知らないラベルは止める", decideMode({ dryRun: false, label: "x" }) === "stop");

  const now = new Date("2026-10-20T12:00:00Z");
  const run = (h, status = "waiting") => ({ id: h, status, run_started_at: new Date(now.getTime() - h * 3_600_000).toISOString(), created_at: "", html_url: `u${h}` });
  const stale = staleWaitingRuns([run(5.9), run(6), run(6.5), run(7), run(6.5, "in_progress")], now);
  check("承認待ちは6〜7時間の窓だけ（1時間ごとの起動で1回）", JSON.stringify(stale) === JSON.stringify(["u6", "u6.5"]), JSON.stringify(stale));

  check("64分前は新しい", isRecent(new Date(now.getTime() - 64 * 60_000).toISOString(), now));
  check("66分前は新しくない（前回の起動で知らせ済み）", !isRecent(new Date(now.getTime() - 66 * 60_000).toISOString(), now));
  check("時刻が無ければ新しくない", !isRecent(null, now));

  const recent = new Date(now.getTime() - 10 * 60_000).toISOString();
  const old = new Date(now.getTime() - 5 * 3_600_000).toISOString();
  const base = { dryRun: true, status: "selected", file: "docs/db-migration/170_a.sql", pr: "1700", addedAt: recent, label: "light", reasons: [], applyResult: "skipped", stale: [], now };
  const dry = buildNotifyMessage(base);
  check("試運転: 新しく足された SQL の「当てるはずだった」を出す", /試運転、当てていない/.test(dry ?? "") && /170_a\.sql/.test(dry ?? "") && /承認なしで当てた/.test(dry ?? ""), dry);
  check("試運転: 前回の起動で知らせたものは出さない", buildNotifyMessage({ ...base, addedAt: old }) === null);
  check("試運転: 重いは「オーナーの1タップを待った」", /1タップ/.test(buildNotifyMessage({ ...base, label: "heavy" }) ?? ""));
  check("blocked は新しいときだけ理由つきで出す", /5点の検査/.test(buildNotifyMessage({ ...base, status: "blocked", reasons: ["承認が無い"] }) ?? "") && buildNotifyMessage({ ...base, status: "blocked", addedAt: old }) === null);
  check("本番: 当てたら出す（時刻の窓に関係なく）", /を当てた/.test(buildNotifyMessage({ ...base, dryRun: false, applyResult: "success", addedAt: old }) ?? ""));
  check("本番: 失敗も出す", /失敗/.test(buildNotifyMessage({ ...base, dryRun: false, applyResult: "failure", addedAt: old }) ?? ""));
  check("本番: 重いの承認待ち（apply が動いていない）は出さない", buildNotifyMessage({ ...base, dryRun: false, label: "heavy", applyResult: "skipped", addedAt: old }) === null);
  check("承認待ちの6時間は出す", /6時間/.test(buildNotifyMessage({ ...base, status: "busy", file: "", stale: ["https://x/run/1"] }) ?? ""));
  check("何も無ければ null", buildNotifyMessage({ ...base, status: "none", file: "" }) === null);
}

if (failures > 0) {
  console.error(`\n${failures} 件失敗`);
  process.exit(1);
}
console.log("\nすべて成功");
