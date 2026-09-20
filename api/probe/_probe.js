/**
 * リージョン・取得先の一時的なプローブ（tasks.md T4a-04）。マージしない。測定後にブランチごと削除する。
 *
 * 計測:
 *   (1) 実行リージョン（VERCEL_REGION）・Nodeのバージョン
 *   (2) Supabaseの軽い読み取りのRTT（venues を1行、n回、逐次）
 *   (3) boatrace.jp の代表ページの取得時間・成功率（raceresult と odds3t を n 回ずつ、逐次、
 *       リクエスト間隔は2秒以上、UA BoatraceAIBot/1.0、429/503 で即中止）
 * 環境変数の値は返さない（設定されているかどうかの真偽のみ）。
 */
const UA =
  "BoatraceAIBot/1.0 (+https://github.com/rhapsody0919/boatrace-ai-predictor)";
const SITE_BASE = "https://www.boatrace.jp/owpc/pc/race";
const SITE_GAP_MS = 2200;
const MAX_N = 8;
// 関数の最大実行時間(60秒)の手前で打ち切り、その時点までの結果を返す・ログに残す
const DEADLINE_MS = 48000;

const median = (values) => {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function timed(fn) {
  const t = performance.now();
  try {
    const result = await fn();
    return { ms: Math.round(performance.now() - t), ...result };
  } catch (error) {
    return {
      ms: Math.round(performance.now() - t),
      error: `${error.name}: ${error.message}`,
    };
  }
}

async function probeSupabase(n) {
  const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  const key =
    process.env.VITE_SUPABASE_ANON_KEY ?? process.env.SUPABASE_ANON_KEY;
  if (!url || !key) return { skipped: "SUPABASE_URL / anon key が環境に無い" };
  const runs = [];
  for (let i = 0; i < n; i++) {
    runs.push(
      await timed(async () => {
        const res = await fetch(`${url}/rest/v1/venues?select=code&limit=1`, {
          headers: { apikey: key, Authorization: `Bearer ${key}` },
        });
        await res.arrayBuffer();
        return { status: res.status };
      }),
    );
  }
  const ok = runs.filter((r) => r.status === 200);
  return {
    n,
    ok: ok.length,
    allMs: runs.map((r) => r.ms),
    medianMs: median(ok.map((r) => r.ms)),
    // 1回目は、TLS・接続の確立を含む。2回目以降が、接続を再利用した通常の往復
    medianExcludingFirstMs: median(ok.slice(1).map((r) => r.ms)),
    statuses: runs.map((r) => r.status ?? r.error),
  };
}

async function probeSite(n, venue, date, startedAt, only) {
  const pages = [];
  for (const page of ["raceresult", "odds3t"].filter(
    (p) => !only || only === "both" || p === only,
  )) {
    for (let rno = 1; rno <= n; rno++) pages.push({ page, rno });
  }
  const runs = [];
  let stopped = null;
  for (const [i, p] of pages.entries()) {
    if (i > 0) await sleep(SITE_GAP_MS);
    if (Date.now() - startedAt > DEADLINE_MS) {
      stopped = `時間切れ（${DEADLINE_MS}ms）のため、${i}件で打ち切り`;
      break;
    }
    const url = `${SITE_BASE}/${p.page}?rno=${p.rno}&jcd=${venue}&hd=${date}`;
    const r = await timed(async () => {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      const buf = await res.arrayBuffer();
      return { status: res.status, bytes: buf.byteLength };
    });
    runs.push({ page: p.page, rno: p.rno, ...r });
    // 関数が途中で終了しても結果が残るよう、1件ごとにログへ出す
    console.log(
      `PROBE_SITE ${JSON.stringify({ region: process.env.VERCEL_REGION, page: p.page, rno: p.rno, status: r.status ?? null, ms: r.ms, bytes: r.bytes ?? null, error: r.error ?? null })}`,
    );
    if (r.status === 429 || r.status === 503) {
      stopped = `HTTP ${r.status} を受けたため中止（${i + 1}件目）`;
      break;
    }
  }
  const summary = (page) => {
    const rs = runs.filter((r) => r.page === page);
    const ok = rs.filter((r) => r.status === 200 && r.bytes > 5000);
    return {
      requested: rs.length,
      ok: ok.length,
      allMs: rs.map((r) => r.ms),
      medianMs: median(ok.map((r) => r.ms)),
      statuses: rs.map((r) => r.status ?? r.error),
      medianBytes: median(ok.map((r) => r.bytes)),
    };
  };
  return {
    totalRequests: runs.length,
    stopped,
    raceresult: summary("raceresult"),
    odds3t: summary("odds3t"),
  };
}

export async function runProbe(req, res) {
  const started = Date.now();
  const n = Math.min(
    Math.max(Number(req.query?.n ?? MAX_N) || MAX_N, 1),
    MAX_N,
  );
  const site = req.query?.site !== "0";
  const out = {
    region: process.env.VERCEL_REGION ?? null,
    node: process.version,
    envPresent: {
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL),
      VITE_SUPABASE_URL: Boolean(process.env.VITE_SUPABASE_URL),
      VITE_SUPABASE_ANON_KEY: Boolean(process.env.VITE_SUPABASE_ANON_KEY),
      SUPABASE_SERVICE_KEY: Boolean(process.env.SUPABASE_SERVICE_KEY),
      CRON_SECRET: Boolean(process.env.CRON_SECRET),
    },
  };
  out.supabase = await probeSupabase(10);
  if (site) out.site = await probeSite(n, "12", "20260919", started, req.query?.page);
  out.totalMs = Date.now() - started;
  console.log(`PROBE_RESULT ${JSON.stringify(out)}`);
  res.status(200).json(out);
}
