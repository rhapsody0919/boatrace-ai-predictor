/**
 * Codex レビューゲートの判定ロジック（純粋関数 + 薄い CLI）。
 *
 * 判定の正本はここに一本化し、シェル（scripts/codex-review.sh）はこの CLI を呼ぶだけにする。
 * boatai には単体テストフレームワークが無いため（hakumei-app 版は verdict.test.ts で検証していた）、
 * この分離の主目的はテスト容易性ではなく「判定ロジックをシェルの文字列処理で再実装しない」こと。
 *
 * CLI 用法:
 *   node codex-review-lib.mjs classify < json   # critical/high>0 なら exit 1、不正 JSON は exit 2
 */

/**
 * Codex の構造化レビュー結果を exit code に落とす。
 * critical/high が 1 件でもあれば block(1)、無ければ approve(0)。
 * 形が壊れている（findings が配列でない / verdict が不正値）か、
 * verdict と findings が自己矛盾している場合は判定不能(2) として安全側に倒す。
 * @param {{verdict?:string, summary?:string, findings?:Array<{severity?:string, [k:string]:unknown}>}} result
 * @returns {{blockers:number, exitCode:0|1|2}}
 */
export function classifyVerdict(result) {
  if (!result || !Array.isArray(result.findings)) {
    return { blockers: 0, exitCode: 2 };
  }
  if (result.verdict !== "approve" && result.verdict !== "block") {
    return { blockers: 0, exitCode: 2 };
  }
  const ALLOWED = new Set(["critical", "high", "medium", "low"]);
  if (result.findings.some((f) => !f || !ALLOWED.has(f.severity))) {
    return { blockers: 0, exitCode: 2 };
  }
  const blockers = result.findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  ).length;
  const verdictByCount = blockers > 0 ? "block" : "approve";
  if (result.verdict !== verdictByCount) {
    return { blockers, exitCode: 2 };
  }
  return { blockers, exitCode: blockers > 0 ? 1 : 0 };
}

/** stdin を最後まで読む。 */
async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

// --- CLI: 直接実行されたときのみ動く（import 時は副作用なし） ---
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2];
  const input = await readStdin();

  if (mode === "classify") {
    let parsed;
    try {
      parsed = JSON.parse(input);
    } catch {
      process.stderr.write("Codex 出力が JSON として不正\n");
      process.exit(2);
    }
    const { blockers, exitCode } = classifyVerdict(parsed);
    process.stderr.write(
      exitCode === 2
        ? "Codex 出力が不正または自己矛盾（findings 欠落 / verdict 不正値 / verdict と件数の不一致）→ 判定不能\n"
        : `Codex: critical/high ${blockers} 件 → ${exitCode === 0 ? "approve" : "block"}\n`,
    );
    process.exit(exitCode);
  } else {
    process.stderr.write("usage: codex-review-lib.mjs classify\n");
    process.exit(2);
  }
}
