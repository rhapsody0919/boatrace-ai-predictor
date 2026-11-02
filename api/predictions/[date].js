/**
 * Vercel Edge Function: 日付指定の予測データ
 * Supabase RPC関数を呼び出し、CDNでキャッシュ
 */

import { predictionsCacheControl } from '../_lib/predictionsCache.js';
import {
  stripUnusedPredictionFields,
  validatePredictionsRequest,
} from '../_lib/predictionsResponse.js';
import { badRequest, queryError } from '../_lib/strictQuery.js';

export const config = {
  runtime: 'edge',
};

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

export default async function handler(req) {
  // OPTIONSリクエストの処理
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      status: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // URLから日付を取得
  const url = new URL(req.url);
  const pathParts = url.pathname.split('/');
  const date = pathParts[pathParts.length - 1];

  // 日付・クエリの検査（実在の日付・JST の明日まで・クエリは無しか light=true だけ。api/_lib/predictionsResponse.js）
  const checked = validatePredictionsRequest(date, url.searchParams, Date.now());
  if (!checked.ok) {
    return new Response(JSON.stringify({
      success: false,
      error: checked.error,
    }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'no-store',
      },
    });
  }

  // 上の検査はデコードした searchParams を見るので、生の表記の違い（?l%69ght=true・?light=true&・空の組の数）は
  // 別のキャッシュの鍵として通ってしまう。生のクエリ文字列でも名指しの2つだけにする（api/_lib/strictQuery.js）
  const rawInvalid = queryError(url, {
    light: (v) => v === 'true',
    date: (v) => v === date,
  });
  if (rawInvalid) return badRequest(rawInvalid);

  // light で turnPrediction/racerStats を除外（初期表示の高速化用）
  const rpcName = checked.light ? 'get_predictions_by_date_light' : 'get_predictions_by_date';

  try {
    // Supabase RPC関数を呼び出し
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${rpcName}`, {
      method: 'POST',
      headers: {
        'apikey': SUPABASE_KEY,
        'Authorization': `Bearer ${SUPABASE_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ target_date: date }),
    });

    if (!response.ok) {
      throw new Error(`Supabase RPC error: ${response.status}`);
    }

    const data = await response.json();

    // JST の今日より前の日付だけ1日、今日・未来は5分（判定は api/_lib/predictionsCache.js。UTC で比べない）
    const cacheControl = predictionsCacheControl(date, Date.now());

    // 読み手の無い欄（廃止した3モデルの点・予想オッズ）を外す（BOA-1110）
    return new Response(JSON.stringify(stripUnusedPredictionFields(data)), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': cacheControl,
      },
    });
  } catch (error) {
    console.error('Edge function error:', error);

    return new Response(JSON.stringify({
      success: false,
      error: error.message,
    }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
