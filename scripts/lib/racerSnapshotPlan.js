/**
 * 選手ページのスナップショット（BOA-848）を、このビルドで作るか・どの選手を作るかを決める。
 *
 * - 作るのは sitemap に載る選手だけ（isRacerIndexable の集合。scripts/generate-sitemap.js が毎日書く
 *   public/sitemap.xml をそのまま使う）。noindex のページは作らない
 * - 本番のビルド（VERCEL_ENV=production）だけで全員を作る。Preview・手元のビルドでは作らない
 *   （本番 DB に数千のリクエストを送らないため）。本番でも、描くのは1日1回で、ほかは今の本番から写す
 *   （decideRacerSnapshotSource。写せなかった選手だけ描く）
 * - RACER_SNAPSHOT_LIMIT（正の整数）があれば、本番以外でもその人数だけ作る（Preview で確かめる用）。
 *   本番では無視する（Preview 用の設定が本番に残って、人数が欠けたまま配ることを防ぐ）
 *
 * @param {{ vercelEnv?: string, limit?: string, sitemapXml: string }} input
 * @returns {{ ids: string[], reason: string }} ids が空なら作らない
 */
export function planRacerSnapshots({ vercelEnv, limit, sitemapXml }) {
  const allIds = [
    ...sitemapXml.matchAll(
      /<loc>https:\/\/www\.boat-ai\.jp\/racer\/(\d{4})<\/loc>/g,
    ),
  ].map((m) => m[1]);
  const ids = [...new Set(allIds)];

  if (vercelEnv === "production") {
    const note = limit
      ? `（RACER_SNAPSHOT_LIMIT=${limit} は本番では無視）`
      : "";
    return { ids, reason: `本番のビルド: sitemap の ${ids.length} 人${note}` };
  }

  if (limit === undefined || limit === "") {
    return {
      ids: [],
      reason: `本番以外のビルド（VERCEL_ENV=${vercelEnv ?? "なし"}）では作らない。RACER_SNAPSHOT_LIMIT で人数を指定すれば作る`,
    };
  }

  const n = Number(limit);
  if (!Number.isInteger(n) || n <= 0) {
    return {
      ids: [],
      reason: `RACER_SNAPSHOT_LIMIT=${limit} は正の整数ではないので作らない`,
    };
  }
  return {
    ids: ids.slice(0, n),
    reason: `RACER_SNAPSHOT_LIMIT=${n}: sitemap の ${ids.length} 人のうち先頭 ${Math.min(n, ids.length)} 人`,
  };
}

/** BOA-1183: 保存直前のHTMLを検査する。目印欠落・取得失敗も保存しない。 */
export function canSaveRacerSnapshot(html) {
  return (
    /data-snapshot-ready="true"/.test(html) &&
    /data-snapshot-motor="(?:done|empty)"/.test(html) &&
    /data-snapshot-history="(?:done|empty)"/.test(html) &&
    !/data-snapshot-(?:motor|history)="(?:loading|error)"/.test(html) &&
    !/集計中|読み込み中/.test(html)
  );
}

/**
 * 選手ページの見た目の版。RacerProfile とその部品（スナップショットに入る画面）を変える PR で1つ上げる。
 * 今の本番の status.json の racer.templateVersion と違えば、写さずに全員を描き直す（Vercel の費用、2026-11-05）
 */
export const RACER_SNAPSHOT_TEMPLATE_VERSION = 1;

/** 写してよい古さの上限。オーナーの線（最大1日）から、越えた後の次の本番ビルドまでの余裕を4時間とった */
export const RACER_SNAPSHOT_MAX_AGE_HOURS = 20;

/** 時計のずれとして許す「未来の renderedAt」 */
const CLOCK_SKEW_MS = 10 * 60 * 1000;

/**
 * 選手ページを今の本番から写すか、全員を描くかを決める（Vercel の費用、2026-11-05、ADR 0032 追記）。
 *
 * 描くのは1日1回にし、ほかの本番ビルドでは今の本番の /ai-snapshots/racer/{id}.html を写す。
 * 写せる条件は、今の本番の status.json の racer が「版が同じ・途中で止まっていない・描いた時刻が20時間以内」。
 * 満たさない（取れない・古い形・壊れている）なら描く側に倒す（今までの動き）。
 *
 * @param {{ sourceStatus: unknown, nowMs: number, forceRender?: boolean,
 *   templateVersion?: number, maxAgeHours?: number }} input
 *   sourceStatus は今の本番の status.json を JSON.parse したもの（取れなければ null）
 * @returns {{ mode: "copy", renderedAt: string, reason: string } | { mode: "render", reason: string }}
 */
export function decideRacerSnapshotSource({
  sourceStatus,
  nowMs,
  forceRender = false,
  templateVersion = RACER_SNAPSHOT_TEMPLATE_VERSION,
  maxAgeHours = RACER_SNAPSHOT_MAX_AGE_HOURS,
}) {
  const render = (reason) => ({ mode: "render", reason });
  if (forceRender) return render("RACER_SNAPSHOT_FORCE_RENDER で全員を描く");
  const racer =
    sourceStatus && typeof sourceStatus === "object"
      ? sourceStatus.racer
      : null;
  if (!racer || typeof racer !== "object")
    return render("今の本番の status.json に racer が無い（取れない・古い形）");
  if (racer.fatalError)
    return render(
      `今の本番の選手ページは途中で止まっていた: ${racer.fatalError}`,
    );
  if (racer.templateVersion !== templateVersion)
    return render(
      `見た目の版が違う（本番 ${racer.templateVersion ?? "なし"}、このビルド ${templateVersion}）`,
    );
  const renderedMs = Date.parse(racer.renderedAt ?? "");
  if (!Number.isFinite(renderedMs))
    return render("今の本番の status.json に描いた時刻（renderedAt）が無い");
  const ageMs = nowMs - renderedMs;
  if (ageMs < -CLOCK_SKEW_MS)
    return render(`描いた時刻が未来（${racer.renderedAt}）`);
  const ageHours = ageMs / 3600000;
  if (ageHours > maxAgeHours)
    return render(
      `描いてから ${ageHours.toFixed(1)} 時間（上限 ${maxAgeHours} 時間）`,
    );
  return {
    mode: "copy",
    renderedAt: racer.renderedAt,
    reason: `今の本番から写す（${racer.renderedAt} に描いた版、${ageHours.toFixed(1)} 時間前）`,
  };
}

/**
 * 写し終えた後に読み直した今の本番の status.json を見て、写した HTML を捨てて描き直すべきかを返す。
 * 写している間に alias が「見た目の版が違う・途中で止まった」版へ切り替わると、その版の HTML を
 * このビルドの版の番号のまま配ってしまう（ADR 0089 決定3）。読み直せなかった（null）ときは、写す前の判定を信じる
 *
 * @param {unknown} afterStatus
 * @param {number} [templateVersion]
 * @returns {string|null} 描き直す理由。写したままでよければ null
 */
export function sourceChangedDuringCopy(
  afterStatus,
  templateVersion = RACER_SNAPSHOT_TEMPLATE_VERSION,
) {
  if (afterStatus == null) return null;
  const racer = typeof afterStatus === "object" ? afterStatus.racer : null;
  if (!racer || typeof racer !== "object")
    return "写している間に今の本番の status.json から racer が消えた";
  if (racer.fatalError)
    return `写している間に今の本番が途中で止まった版に変わった: ${racer.fatalError}`;
  if (racer.templateVersion !== templateVersion)
    return `写している間に今の本番の見た目の版が変わった（${racer.templateVersion ?? "なし"}）`;
  return null;
}

/** 2つの ISO 時刻の古い方（読めない方は捨てる。両方読めなければ null） */
export function olderIso(a, b) {
  const valid = [a, b]
    .map((s) => ({ s, t: Date.parse(s ?? "") }))
    .filter((x) => Number.isFinite(x.t))
    .sort((x, y) => x.t - y.t);
  return valid[0]?.s ?? null;
}

/**
 * dist/index.html から main の js・css の参照を取り出す（写した HTML の書き換え先）
 * @param {string} indexHtml
 * @returns {{ js: string, css: string } | null}
 */
export function mainAssetsOf(indexHtml) {
  const js = indexHtml.match(/src="(\/assets\/main-[A-Za-z0-9_-]+\.js)"/)?.[1];
  const css = indexHtml.match(
    /href="(\/assets\/main-[A-Za-z0-9_-]+\.css)"/,
  )?.[1];
  return js && css ? { js, css } : null;
}

/**
 * 今の本番から取った選手ページの HTML を、このビルドで配れる形にする。
 *
 * - main の js・css の参照（ビルドごとに hash が変わる）を、このビルドの dist/index.html のものに書き換える
 * - `/` で始まり拡張子を持つ src・href が、すべてこのビルドの dist に在ること。無いものが1つでもあれば写さない（描く側に倒す）
 * - 描いたときと同じ保存の検査（canSaveRacerSnapshot）と noindex でないこと。無い番号を取ると catch-all で
 *   200 の SPA の外枠（約5KB）が返るので、「200 なら在る」とは見ない
 *
 * @param {string} html
 * @param {{ mainAssets: { js: string, css: string }, distHas: (urlPath: string) => boolean }} ctx
 * @returns {{ ok: true, html: string } | { ok: false, reason: string }}
 */
export function adaptCopiedRacerHtml(html, { mainAssets, distHas }) {
  if (!canSaveRacerSnapshot(html))
    return { ok: false, reason: "保存の目印が無い（SPA の外枠・描きかけ）" };
  if (/<meta[^>]+name="robots"[^>]+content="[^"]*noindex/i.test(html))
    return { ok: false, reason: "noindex" };
  const out = html
    .replace(/\/assets\/main-[A-Za-z0-9_-]+\.js/g, mainAssets.js)
    .replace(/\/assets\/main-[A-Za-z0-9_-]+\.css/g, mainAssets.css);
  const refs = [
    ...out.matchAll(
      /\s(?:src|href)="(\/(?!\/)[^"?#]*\.[A-Za-z0-9]+)(?:[?#][^"]*)?"/g,
    ),
  ].map((m) => m[1]);
  const missing = [...new Set(refs)].filter((p) => !distHas(p));
  if (missing.length > 0)
    return {
      ok: false,
      reason: `このビルドに無い参照: ${missing.slice(0, 3).join(", ")}`,
    };
  return { ok: true, html: out };
}
