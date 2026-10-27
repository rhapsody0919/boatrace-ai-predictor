/**
 * 公開 API の受けるクエリを名指しにし、それ以外を 400・no-store で拒む。
 *
 * CDN はクエリごとに別のキャッシュを持つので、`?zz=乱数` を付けた要求は毎回 MISS で関数と DB まで届く
 * （2026-10-27 に x-vercel-cache: MISS を実測、docs/design/public-api-lockdown/plan.md）。
 * /api/predictions（api/_lib/predictionsResponse.js の validatePredictionsRequest）・/api/analogy/*
 * （api/_lib/analogyV16.js の parseRequest、BOA-1125）と同じ流儀で、生のクエリ文字列を見る。
 * % で書いた別表記（?venue%5Fcode=1）・同じキーの重複・空の組（?a=1&）も、キャッシュの別の鍵になるので拒む。
 *
 * 判定は DB・外部への取得の前に行う。キャッシュに当たった要求には効かない（当たるならもともと関数に届かない）。
 */

/** 値の検査（生の文字列。デコードしない） */
export const rules = {
  /** 会場コード 1〜24。画面は数（"1"）、全貌動画の材料も 1〜24 の数で送る。"01" の形も受ける（9通り増えるだけ） */
  venueCode: (v) => /^(0?[1-9]|1\d|2[0-4])$/.test(v),
};

/**
 * @param {URL} url
 * @param {Record<string, (value: string) => boolean>} allowed 受けるキーと値の検査
 * @param {{ required?: string[] }} [options]
 * @returns {string|null} 拒む理由（受けてよいなら null）
 */
export function queryError(url, allowed, { required = [] } = {}) {
  const raw = url.search.slice(1);
  const pairs = raw === "" ? [] : raw.split("&");
  const seen = new Set();
  for (const pair of pairs) {
    const eq = pair.indexOf("=");
    if (eq <= 0) return "Malformed query string";
    const key = pair.slice(0, eq);
    const value = pair.slice(eq + 1);
    if (!Object.hasOwn(allowed, key)) return "Unknown query parameter";
    if (seen.has(key)) return `Duplicate query parameter: ${key}`;
    if (!allowed[key](value)) return `Invalid value for ${key}`;
    seen.add(key);
  }
  const missing = required.filter((key) => !seen.has(key));
  if (missing.length > 0)
    return `${missing.join(", ")} query parameter is required`;
  return null;
}

/** 400 の応答。CDN に置かせない（置くと拒んだ応答がキャッシュの鍵を増やす） */
export function badRequest(message) {
  return new Response(JSON.stringify({ success: false, error: message }), {
    status: 400,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
  });
}
