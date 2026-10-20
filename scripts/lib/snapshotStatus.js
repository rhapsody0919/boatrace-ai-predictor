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

/**
 * ブログ以外の組（翻訳記事の言語ごと・ブログ一覧、BOA-848 第2段）の結果を status に足す。
 * 失敗が1件でもあれば status.ok を false にし、まとめの最後の区切りの前に警告の行を足す（status と lines を書き換える）
 *
 * @param {object} status - summarizeSnapshotRun の status
 * @param {string[]} lines - summarizeSnapshotRun の lines
 * @param {string} name - 例 "blogI18n.en"・"blogList"。"." の前が status のキー、後ろがその中のキー
 * @param {{total: number|null, failed: {id: string, error: string}[], fatalError?: string|null}} result
 */
export function addSnapshotGroup(status, lines, name, result) {
  const fatalError = result.fatalError ?? null;
  const entry = {
    total: result.total,
    succeeded:
      fatalError || result.total == null
        ? null
        : result.total - result.failed.length,
    failedIds: result.failed.map((f) => f.id),
    fatalError,
  };
  const [top, sub] = name.split(".");
  if (sub) {
    status[top] = { ...(status[top] ?? {}), [sub]: entry };
  } else {
    status[top] = entry;
  }
  const groupOk = !fatalError && result.failed.length === 0;
  if (groupOk) return;
  status.ok = false;
  const warn = fatalError
    ? `⚠️⚠️ AI スナップショット: ${name} の生成が途中で止まった（ビルドは継続）: ${fatalError}`
    : `⚠️⚠️ AI スナップショット: ${name} ${entry.succeeded}/${entry.total} 件。失敗: ${entry.failedIds.join(", ")}`;
  lines.splice(Math.max(lines.length - 1, 0), 0, warn);
}

/**
 * status の中の、ブログ以外の組の失敗を「名前: 内容」の一覧にする（毎日の照合のメッセージ用）
 *
 * @param {object} status
 * @returns {string[]}
 */
export function failedSnapshotGroups(status) {
  const out = [];
  const visit = (name, e) => {
    if (!e || typeof e !== "object") return;
    if (e.fatalError) out.push(`${name}: 途中で止まった（${e.fatalError}）`);
    else if (Array.isArray(e.failedIds) && e.failedIds.length > 0)
      out.push(
        `${name}: ${e.succeeded}/${e.total} 件。失敗: ${e.failedIds.join(", ")}`,
      );
  };
  if (status?.blogI18n) {
    if ("fatalError" in status.blogI18n) visit("blogI18n", status.blogI18n);
    else
      for (const [lang, e] of Object.entries(status.blogI18n))
        visit(`blogI18n.${lang}`, e);
  }
  visit("blogList", status?.blogList);
  visit("blogChartPng", status?.blogChartPng);
  return out;
}
