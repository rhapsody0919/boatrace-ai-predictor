/**
 * Vercel Edge Function: 日付指定の予測データ
 * Supabase RPC関数を呼び出し、CDNでキャッシュ
 */

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

  // 日付形式のバリデーション
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return new Response(JSON.stringify({
      success: false,
      error: 'Invalid date format. Use YYYY-MM-DD',
    }), {
      status: 400,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }

  // light パラメータで turnPrediction/racerStats を除外（初期表示の高速化用）
  const isLight = url.searchParams.get('light') === 'true';
  const rpcName = isLight ? 'get_predictions_by_date_light' : 'get_predictions_by_date';

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

    // 今日の日付かどうかでキャッシュ時間を調整
    const today = new Date().toISOString().split('T')[0];
    const isToday = date === today;

    // 今日のデータ: 5分キャッシュ（morning-init が全レースを逐次ロードする間に
    //   古い部分データがキャッシュされても 5分以内に正しいデータへ更新される）
    // 過去データ: 1日キャッシュ
    const cacheControl = isToday
      ? 's-maxage=300, stale-while-revalidate=60'
      : 's-maxage=86400, stale-while-revalidate=3600';

    return new Response(JSON.stringify(data), {
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
