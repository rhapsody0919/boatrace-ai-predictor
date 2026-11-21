function cell(text) {
  return String(text).replace(/\|/g, "\\|").replace(/\n/g, " ");
}

function shortList(list, max = 6) {
  if (list.length <= max) return list.join(", ");
  return `${list.slice(0, max).join(", ")} ほか${list.length - max}`;
}

function rpcCallerText(r) {
  const parts = [];
  if (r.callers.length)
    parts.push(
      shortList(
        r.callers.map((x) => x.ref),
        4,
      ),
    );
  if (r.mentions.length)
    parts.push(`名前の文字列: ${shortList(r.mentions, 3)}`);
  if (r.calledByRpc.length) parts.push(`RPC から: ${r.calledByRpc.join(", ")}`);
  if (r.triggerOn.length) parts.push(`トリガー: ${r.triggerOn.join(", ")}`);
  return parts.join(" / ") || "なし";
}

/** 見出しと、機械生成の注記 */
function renderHeader(L, ledger) {
  L.push("# データの読み手の台帳");
  L.push("");
  L.push(
    "> 機械生成（`node scripts/maintenance/generate-data-readers.js`）。手で書き換えない。表・列・RPC を変える・消す前に、ここで読み手と書き手を確かめる。master へのマージ後に CI（regenerate-generated-docs.yml）が作り直す。PR には含めない（ADR-0078）。作業中の枝の影響を見るときは手元で作り直して読み、コミットせずに戻す。機械で拾えない repo の外の読み手（hq 等）は `docs/reference/data-readers.extra.json` に手で足す。",
  );
  L.push(">");
  L.push(
    `> 入力: \`src/\`・\`api/\`・\`scripts/\`・\`sns-video-studio/\` の JS/TS（構文木で \`.from()\`・\`.select()\`・\`.rpc()\` 等と \`/rest/v1/\` を拾う）と、本番スキーマの写し（\`docs/reference/schema-snapshot.json\`、取得 ${ledger.snapshotCapturedAt}）。権限・RPC の本体はこの写しの時点のもの。`,
  );
  L.push("");
}

/** 件数の表 */
function renderCounts(L, ledger) {
  L.push("## 件数");
  L.push("");
  L.push("| 項目 | 件数 |");
  L.push("|---|---|");
  const labels = {
    tables: "表・ビュー（写し）",
    rpcs: "RPC（写しの関数）",
    sourceFiles: "読んだファイル",
    filesWithAccess: "読み書きのあるファイル",
    tableReaders: "表の読み手（箇所）",
    tableWriters: "表の書き手（箇所）",
    rpcCallers: "RPC の呼び手（箇所）",
    nameMentions: "名前の文字列だけの箇所（呼ぶ経路は式）",
    tablesWithoutReaders:
      "読み手の見つからない表（RPC・ビュー経由・名前の文字列・外も無し。data_health_* の監視だけのものは含む）",
    rpcsWithoutCallers:
      "呼び手の見つからない RPC（RPC 経由・名前の文字列・トリガー・外も無し）",
    external: "外の読み手（手で足した行）",
    notInSnapshot: "コードが使うのに写しに無い名前",
    unresolved: "名前が式で拾えなかった箇所",
    parseErrors: "構文木にできなかったファイル",
    uncoveredFiles: "対象外の言語のファイル（Python 等）",
  };
  for (const [k, v] of Object.entries(ledger.counts))
    L.push(`| ${labels[k] ?? k} | ${v} |`);
  L.push("");
}

/** 表の一覧の表 */
function renderTableSummary(L, ledger) {
  L.push("## 表");
  L.push("");
  L.push(
    "読み手・書き手は箇所の数。権限の「anon 可」は anon に SELECT の GRANT があり、RLS が無いか anon・PUBLIC 向けの SELECT のポリシーがあるもの。service_role は RLS を通らないので「service だけ」でも service のキーからは読める。",
  );
  L.push("");
  L.push(
    "| 表 | 種類 | 権限 | 読み手 | 書き手 | 本体で読む RPC・ビュー | 本体で書く RPC | 取得のジョブ | 外の読み手 |",
  );
  L.push("|---|---|---|---|---|---|---|---|---|");
  for (const [name, t] of Object.entries(ledger.tables)) {
    L.push(
      `| [${name}](#t-${name}) | ${t.kind} | ${t.access.summary} | ${t.readers.length} | ${t.writers.length} | ${cell(shortList([...t.readByRpc, ...t.readByView.map((v) => `view:${v}`)], 3))} | ${cell(shortList(t.writtenByRpc, 3))} | ${cell(shortList(t.scrapeJobs, 3))} | ${t.external.map((e) => cell(`${e.repo}:${e.reader}`)).join(", ")} |`,
    );
  }
  L.push("");
}

/** RPC の一覧の表 */
function renderRpcSummary(L, ledger) {
  L.push("## RPC");
  L.push("");
  L.push(
    "| RPC | 権限 | definer | 呼び手 | 呼ぶ RPC | 本体が読む表 | 本体が書く表 | 外の読み手 |",
  );
  L.push("|---|---|---|---|---|---|---|---|");
  for (const [name, r] of Object.entries(ledger.rpcs)) {
    L.push(
      `| ${name} | ${r.access.summary} | ${r.securityDefiner ? "yes" : ""} | ${cell(rpcCallerText(r))} | ${cell(r.calls.join(", "))} | ${cell(r.reads.join(", "))} | ${cell(r.writes.join(", "))} | ${r.external.map((e) => cell(`${e.repo}:${e.reader}`)).join(", ")} |`,
    );
  }
  L.push("");
}

/** 取得のジョブの表 */
function renderScrapeSummary(L, ledger) {
  L.push("## 取得のジョブ（scrape の registry）");
  L.push("");
  L.push(
    "入口の `api/cron` のファイルから相対 import でたどれるファイルの書き込み。共有の部品を通るので、別のジョブの書き込みも入る（多めに出る）。",
  );
  L.push("");
  L.push("| ジョブ | 入口 | たどったファイル | 書く表 |");
  L.push("|---|---|---|---|");
  for (const j of ledger.scrapeJobs) {
    L.push(
      `| ${j.job} | ${j.entry} | ${j.reachableFiles} | ${cell(Object.keys(j.writes).join(", "))} |`,
    );
  }
  for (const u of ledger.unresolvedJobs)
    L.push(`| ${u.job} | （${u.reason}） | | |`);
  L.push("");
}

/** コードが使うのに写しに無い名前 */
function renderNotInSnapshot(L, ledger) {
  L.push("## コードが使うのに写しに無い名前");
  L.push("");
  L.push(
    "写しの取得より後のマイグレーションで足したもの、消したもの、別のスキーマ、誤りのどれか。",
  );
  L.push("");
  if (!ledger.notInSnapshot.length) L.push("なし");
  for (const n of ledger.notInSnapshot)
    L.push(
      `- ${n.kind} \`${n.name}\`: ${shortList(
        n.refs.map((r) => `\`${r}\``),
        5,
      )}`,
    );
  L.push("");
}

/** 拾えなかったもの */
function renderUnresolved(L, ledger) {
  L.push("## 拾えなかったもの");
  L.push("");
  L.push(
    `- 名前が式（変数・テンプレートの式）の箇所: ${ledger.unresolved.length}`,
  );
  for (const u of ledger.unresolved)
    L.push(`  - \`${u.file}:${u.line}\` ${u.reason}`);
  L.push(`- 構文木にできなかったファイル: ${ledger.parseErrors.length}`);
  for (const p of ledger.parseErrors)
    L.push(`  - \`${p.file}\` ${cell(p.error)}`);
  L.push(
    `- 対象外の言語で DB を読み書きしうるファイル（Python。拾っていない）: ${ledger.uncoveredFiles.length}`,
  );
  for (const f of ledger.uncoveredFiles) L.push(`  - \`${f}\``);
  L.push(
    "- repo の外（hq の `platform/*.py`・cron-job.org 等）: 機械では拾えない。`docs/reference/data-readers.extra.json` に手で足す",
  );
  L.push(
    '- 読み手の変数に入れてから後で足した連鎖（`let q = …from("t"); q = q.eq("c", …)`）の列、`.select()` の文字列が式の列',
  );
  L.push("");
}

/** 表1つ分の詳細の頭（権限・RPC・ジョブ・外の読み手・名前の文字列） */
function renderTableFacts(L, t) {
  L.push(
    `- 権限: ${t.access.summary}（anon: ${t.access.anon.join("・") || "なし"} / authenticated: ${t.access.authenticated.join("・") || "なし"}、RLS ${t.rlsEnabled ? "有効" : "無効"}）`,
  );
  if (t.readByView.length)
    L.push(`- 定義で読むビュー: ${t.readByView.join(", ")}`);
  if (t.readByRpc.length) L.push(`- 本体で読む RPC: ${t.readByRpc.join(", ")}`);
  if (t.writtenByRpc.length)
    L.push(`- 本体で書く RPC: ${t.writtenByRpc.join(", ")}`);
  if (t.scrapeJobs.length) L.push(`- 取得のジョブ: ${t.scrapeJobs.join(", ")}`);
  for (const e of t.external)
    L.push(
      `- 外の読み手: ${e.repo} \`${e.reader}\`（${e.access}${e.columns ? `、列 ${e.columns.join(", ")}` : ""}）${e.detail ? ` ${e.detail}` : ""}（${e.source}、${e.addedAt}）`,
    );
  if (t.columnsNotInSnapshot.length)
    L.push(
      `- 写しに無い列の名前（埋め込みの別名・JSON のキー・誤りのどれか）: ${t.columnsNotInSnapshot.join(", ")}`,
    );
  if (t.mentions.length)
    L.push(
      `- 名前の文字列（\`.from(式)\` 等の先で読む・書く見込み）: ${t.mentions.map((m) => `\`${m}\``).join(", ")}`,
    );
}

/** 箇所の1行 */
const fmtAccess = (a) =>
  `\`${a.ref}\` ${a.op}${a.via !== "client" ? `(${a.via})` : ""}${a.columns.length ? ` [${a.columns.join(", ")}]` : ""}${a.test ? " （検査）" : ""}`;

/** 表1つ分の読み手・書き手の箇所 */
function renderTableAccesses(L, t) {
  L.push(`- 読み手（${t.readers.length}）: ${t.readers.length ? "" : "なし"}`);
  for (const a of t.readers) L.push(`  - ${fmtAccess(a)}`);
  L.push(`- 書き手（${t.writers.length}）: ${t.writers.length ? "" : "なし"}`);
  for (const a of t.writers) L.push(`  - ${fmtAccess(a)}`);
}

/** 列の読まれ方の注記 */
function renderColumnNote(L, t) {
  const externalColumns = new Set(t.external.flatMap((e) => e.columns ?? []));
  const unread = Object.entries(t.columns)
    .filter(
      ([k, v]) =>
        v.readers.length === 0 && v.sql.length === 0 && !externalColumns.has(k),
    )
    .map(([k]) => k);
  const unknownReader =
    t.readers.some(
      (a) =>
        a.columns.includes("*") ||
        a.columns.includes("?") ||
        a.columns.length === 0,
    ) ||
    t.mentions.length > 0 ||
    t.external.some((e) => !e.columns);
  if (unknownReader) {
    L.push(
      '- 列: 列の分からない読み手（`select("*")`・部品の呼び出し・名前の文字列・列を書いていない外の読み手）があるので、名指しの無い列も読まれうる',
    );
  } else if (unread.length) {
    L.push(
      `- コード・RPC・ビューのどれからも名指しの無い列（Python・SQL の直書き・repo の外は見ていない）: ${unread.join(", ")}`,
    );
  }
}

/** 表1つ分の詳細 */
function renderTableDetail(L, name, t) {
  L.push(`### <a id="t-${name}"></a>${name}`);
  L.push("");
  renderTableFacts(L, t);
  renderTableAccesses(L, t);
  renderColumnNote(L, t);
  L.push("");
}

/** 表ごとの読み手・書き手 */
function renderTableDetails(L, ledger) {
  L.push("## 表ごとの読み手・書き手");
  L.push("");
  for (const [name, t] of Object.entries(ledger.tables))
    renderTableDetail(L, name, t);
}

/** 台帳の Markdown。JSON と同じ中身を、人と AI が先に読む形にする */
export function renderMarkdown(ledger) {
  const L = [];
  renderHeader(L, ledger);
  renderCounts(L, ledger);
  renderTableSummary(L, ledger);
  renderRpcSummary(L, ledger);
  renderScrapeSummary(L, ledger);
  renderTableDetails(L, ledger);
  renderNotInSnapshot(L, ledger);
  renderUnresolved(L, ledger);
  return L.join("\n");
}
