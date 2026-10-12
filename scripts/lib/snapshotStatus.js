/**
 * AI クローラー向けスナップショット生成（generate-ai-snapshots.js）の結果を、見える形にまとめる。
 *
 * 生成の失敗はビルドを止めない（PR #624。ブログの生成が落ちても /winning-technique・/today は配る）。
 * その代わり、失敗がログの途中に埋もれて気づけなかった（2026-10-11 まで本番で3記事が欠けていた、#1393）。
 * そこで、ログの最後に目立つまとめを出し、配信物に status.json を置いて、毎日の照合から読めるようにする。
 *
 * @param {{ total: number, failed: { id: string, error: string }[], fatalError?: string|null,
 *   relaunches?: number, generatedAt: string }} run
 * @returns {{ status: object, lines: string[] }}
 */
export function summarizeSnapshotRun({
  total,
  failed,
  fatalError = null,
  relaunches = 0,
  generatedAt,
}) {
  // 生成の途中で止まった（fatalError）ときは、何件書けたか分からないので成功件数を出さない
  const succeeded = fatalError ? null : total - failed.length;
  const ok = !fatalError && failed.length === 0;
  const status = {
    generatedAt,
    ok,
    blog: {
      total,
      succeeded,
      failedIds: failed.map((f) => f.id),
      fatalError,
    },
    browserRelaunches: relaunches,
  };

  const bar = "=".repeat(60);
  const lines = [bar];
  if (ok) {
    lines.push(`AI スナップショット: ブログ ${total}/${total} 件 OK`);
  } else if (fatalError) {
    lines.push(
      `⚠️⚠️ AI スナップショット: ブログの生成が途中で止まった（ビルドは継続）: ${fatalError}`,
    );
  } else {
    lines.push(
      `⚠️⚠️ AI スナップショット: ブログ ${succeeded}/${total} 件。${failed.length} 件が失敗（ビルドは継続）`,
    );
    for (const f of failed)
      lines.push(`  - ${f.id}: ${f.error.split("\n")[0]}`);
    lines.push(
      "  失敗した記事は AI クローラーに中身の無い画面が返る。/ai-snapshots/status.json にも同じ内容がある",
    );
  }
  if (relaunches > 0) lines.push(`  ブラウザを ${relaunches} 回起動し直した`);
  lines.push(bar);
  return { status, lines };
}
