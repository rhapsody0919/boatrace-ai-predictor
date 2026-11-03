/**
 * /api の関門の観測ログ（middleware.js の1行の JSON、{"api_gate":reason,…}）を数える
 * （BOA-1110 段階3→4 の進む条件、docs/design/public-api-lockdown/plan.md §4・§6）。
 *
 * 入力: Vercel の Runtime Logs の行（テキストでも、message に行が入った JSON でもよい）。
 *   行の中の {"api_gate": … } を拾う。ほかの行は数えない（拾えた行・拾えなかった行の数を出す）。
 *   取り方は plan §6 の1（Vercel MCP の get_runtime_logs・ダッシュボードの書き出し）。
 *
 * 出すもの:
 *   - reason × group（google・bingbot・search_other・ai_crawler・hq・ryujin・browser・other）の件数。
 *     browser の抜き取り（sample=10）は掛け戻す
 *   - would_deny・bad_key の内訳（group・ua_class・path の先頭2段・caller_claimed）
 *   - 自分の呼び出し元（plan §1.2 の b・c 群）ごとの reason=internal の件数と、0件の群
 *   - 検索ボット（bot_verified=true）の件数と、そのうち would_deny・deny の件数
 *   - 段階4へ進む条件のうちログで判定できるもの（自分の群の would_deny・bad_key が0、各群の internal が1件以上、
 *     bot_verified=true が1件以上でその would_deny が0）。期間（平日・土日を含む連続2日）は呼ぶ側が窓で決める
 *
 * 使い方:
 *   node scripts/maintenance/count-api-gate-log.js logs-2026-11-05.txt [more.txt ...]
 *   cat logs.jsonl | node scripts/maintenance/count-api-gate-log.js
 *   --json で結果を JSON で出す
 *
 * 鍵・IP・UA の全文はログに入っていない（verify-api-gate.js [8]・[10]）。この集計も出さない。
 * 判定の試験は verify-api-gate.js [12]。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// plan §1.2 の b・c 群が付ける呼び出し元の名前（internalApiHeaders の caller）。hq（c2・c3）は "hq-" で始まる名前
export const OWN_CALLER_GROUPS = [
  {
    id: "b1",
    label: "ボット HTML（botPage・botRace）",
    callers: ["bot-page", "bot-race"],
  },
  {
    id: "b2",
    label: "SNS の照合（snsClaimCheck）",
    callers: ["sns-claim-check"],
  },
  {
    id: "c1",
    label: "全貌動画の材料（fetch-materials・daily）",
    callers: ["full-picture-materials", "full-picture-select"],
  },
  { id: "c2c3", label: "hq（優勝戦・全貌動画）", callerPrefix: "hq-" },
  {
    id: "c3b",
    label: "ボット HTML の監視（bot-html-parity）",
    callers: ["bot-html-parity"],
  },
];

const MARKER = '{"api_gate"';

/** 1行から関門のログの JSON を取り出す。無ければ null */
export function extractGateRecord(line) {
  if (typeof line !== "string") return null;
  let text = line;
  // Vercel の JSON の行（message に元の行）。message の中の JSON は文字列なので先に取り出す
  const trimmed = line.trim();
  if (trimmed.startsWith("{") && !trimmed.startsWith(MARKER)) {
    try {
      const outer = JSON.parse(trimmed);
      const message = outer?.message ?? outer?.text ?? outer?.log;
      if (typeof message === "string") text = message;
    } catch {
      // JSON でない行はそのまま探す
    }
  }
  const start = text.indexOf(MARKER);
  if (start < 0) return null;
  // 1行の JSON は入れ子を持たないので、最初の "}" までで閉じる（値に "}" が入りうるので後ろから順に試す）
  for (
    let end = text.lastIndexOf("}");
    end > start;
    end = text.lastIndexOf("}", end - 1)
  ) {
    try {
      const record = JSON.parse(text.slice(start, end + 1));
      return typeof record?.api_gate === "string" ? record : null;
    } catch {
      // 短くして試し直す
    }
  }
  return null;
}

const pathHead = (path) =>
  typeof path === "string" ? path.split("/").slice(0, 4).join("/") : "(なし)";

const bump = (map, key, by) => map.set(key, (map.get(key) ?? 0) + by);

const ownGroupOf = (caller) =>
  caller
    ? (OWN_CALLER_GROUPS.find((g) =>
        g.callerPrefix
          ? caller.startsWith(g.callerPrefix)
          : g.callers.includes(caller),
      ) ?? null)
    : null;

/**
 * @param {string[]} lines
 */
export function countApiGateLines(lines) {
  const byReasonGroup = new Map();
  const denyDetail = new Map();
  const internalByCaller = new Map();
  let parsed = 0;
  let skipped = 0;
  let botVerified = 0;
  let botVerifiedDenied = 0;
  for (const line of lines) {
    if (!line.trim()) continue;
    const r = extractGateRecord(line);
    if (!r) {
      skipped++;
      continue;
    }
    parsed++;
    const weight = Number.isInteger(r.sample) && r.sample > 0 ? r.sample : 1;
    bump(byReasonGroup, `${r.api_gate}\t${r.group ?? "?"}`, weight);
    if (
      r.api_gate === "would_deny" ||
      r.api_gate === "deny" ||
      r.api_gate === "bad_key"
    ) {
      bump(
        denyDetail,
        [
          r.api_gate,
          r.group ?? "?",
          r.ua_class ?? "?",
          pathHead(r.path),
          r.caller_claimed ?? "-",
        ].join("\t"),
        weight,
      );
    }
    if (r.api_gate === "internal")
      bump(internalByCaller, r.caller ?? "(名前なし)", weight);
    if (r.bot_verified === true) {
      botVerified += weight;
      if (r.api_gate === "would_deny" || r.api_gate === "deny")
        botVerifiedDenied += weight;
    }
  }

  const ownDenied = [...denyDetail]
    .filter(([key]) => {
      const [, group] = key.split("\t");
      return group === "hq" || group === "ryujin";
    })
    .reduce((sum, [, n]) => sum + n, 0);
  const groups = OWN_CALLER_GROUPS.map((g) => ({
    id: g.id,
    label: g.label,
    internal: [...internalByCaller]
      .filter(([caller]) => ownGroupOf(caller)?.id === g.id)
      .reduce((sum, [, n]) => sum + n, 0),
  }));
  const unknownCallers = [...internalByCaller].filter(
    ([caller]) => !ownGroupOf(caller),
  );

  return {
    parsed,
    skipped,
    byReasonGroup: [...byReasonGroup]
      .map(([key, count]) => {
        const [reason, group] = key.split("\t");
        return { reason, group, count };
      })
      .sort((a, b) => b.count - a.count),
    denyDetail: [...denyDetail]
      .map(([key, count]) => {
        const [reason, group, ua_class, path, caller_claimed] = key.split("\t");
        return { reason, group, ua_class, path, caller_claimed, count };
      })
      .sort((a, b) => b.count - a.count),
    internalByCaller: Object.fromEntries(internalByCaller),
    unknownCallers: Object.fromEntries(unknownCallers),
    groups,
    botVerified,
    botVerifiedDenied,
    conditions: {
      ownDeniedZero: ownDenied === 0,
      ownDenied,
      everyGroupHasInternal: groups.every((g) => g.internal > 0),
      missingGroups: groups.filter((g) => g.internal === 0).map((g) => g.id),
      botVerifiedSeen: botVerified > 0,
      botVerifiedNeverDenied: botVerifiedDenied === 0,
    },
  };
}

function printReport(result) {
  const out = [];
  out.push(`拾えた関門の行: ${result.parsed}（ほかの行: ${result.skipped}）`);
  out.push("", "## reason × group（browser は抜き取りを掛け戻した数）");
  for (const row of result.byReasonGroup)
    out.push(`  ${row.reason}\t${row.group}\t${row.count}`);
  out.push(
    "",
    "## would_deny・deny・bad_key の内訳（reason・group・ua_class・path・名乗った caller）",
  );
  if (result.denyDetail.length === 0) out.push("  なし");
  for (const row of result.denyDetail)
    out.push(
      `  ${row.reason}\t${row.group}\t${row.ua_class}\t${row.path}\t${row.caller_claimed}\t${row.count}`,
    );
  out.push("", "## 自分の呼び出し元（reason=internal）");
  for (const g of result.groups)
    out.push(`  ${g.id}\t${g.label}\t${g.internal}`);
  for (const [caller, n] of Object.entries(result.unknownCallers))
    out.push(`  ?\t一覧に無い名前 ${caller}\t${n}`);
  out.push(
    "",
    `## 検索ボット（UA と IP で確かめた bot_verified=true）: ${result.botVerified}件、うち拒む候補 ${result.botVerifiedDenied}件`,
  );
  const c = result.conditions;
  out.push(
    "",
    "## 段階4へ進む条件のうちログで見るもの（期間は窓で決める: 平日・土日を含む連続2日）",
    `  ${c.ownDeniedZero ? "OK" : "NG"}  自分の群（hq・ryujin）の would_deny・bad_key が0（${c.ownDenied}件）`,
    `  ${c.everyGroupHasInternal ? "OK" : "NG"}  b・c 群ごとに internal が1件以上${c.missingGroups.length ? `（0件: ${c.missingGroups.join(", ")}）` : ""}`,
    `  ${c.botVerifiedSeen ? "OK" : "NG"}  bot_verified=true が1件以上`,
    `  ${c.botVerifiedNeverDenied ? "OK" : "NG"}  bot_verified=true の would_deny・deny が0`,
    "  （ログの外: 検索ボットの疎通試験・c5 を手で1回・§1.2 の e の文書の書き換え）",
  );
  console.log(out.join("\n"));
}

async function readInput(paths) {
  if (paths.length > 0)
    return paths.flatMap((p) => readFileSync(p, "utf8").split(/\r?\n/));
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").split(/\r?\n/);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const asJson = args.includes("--json");
  const files = args.filter((a) => a !== "--json");
  const result = countApiGateLines(await readInput(files));
  if (asJson) console.log(JSON.stringify(result, null, 2));
  else printReport(result);
}
