/**
 * その日の /today の X 投稿（format=today_digest の親の下書き）が使ったレースを、hq が思考投稿（today_thinking、BOA-1169）の
 * 対象を選ぶ材料として JSON で出す。読み取りだけ。鍵は本リポジトリの .env.local（SUPABASE_URL・SUPABASE_SERVICE_KEY）。
 *
 * 使い方:
 *   node --env-file=.env.local scripts/sns/today-picks.js <YYYY-MM-DD>
 * 出力: {date, draft_id, status, form, content_type_id, featured, list}。form は a（見出し＋一覧）か b（course_win）。featured・list の行は {race_id, boat_number, deadline_at, cancelled}
 *   - 型 a（見出し＋一覧）: featured は本文に「注目レース：」の行があるときの picks の先頭、list は残りの picks（一覧、締切順）
 *   - 型 b（course_win）: featured は source_data.course_win.featured、list は picks の全部（画像の行）
 *   - その日の下書きが無ければ draft_id=null・featured=null・list=[]
 * exit: 0 出せた・2 使い方・鍵の不足・読めない
 * 8:00 の投稿の後に読む（status が posted か、hq が確かめる）
 */
import { pathToFileURL } from "node:url";
import { deadlineIso } from "../../api/_lib/snsClaimCheck.js";

const FEATURED_LINE = /^注目レース：/m;

/** 下書きと races の行から、注目レースと一覧を作る（純粋関数） */
export function todayPicksOf(date, draft, races = []) {
  if (!draft)
    return {
      date,
      draft_id: null,
      status: null,
      form: null,
      content_type_id: null,
      featured: null,
      list: [],
    };
  const byId = new Map(races.map((r) => [r.race_id, r]));
  const row = ({ race_id, boat_number }) => {
    const race = byId.get(race_id);
    return {
      race_id,
      boat_number: boat_number ?? null,
      deadline_at: deadlineIso(race),
      cancelled: race ? race.cancellation_status != null : null,
    };
  };
  const sd = draft.source_data ?? {};
  const picks = sd.digest?.picks ?? [];
  const courseWin = sd.course_win?.featured;
  const featuredA = !courseWin && FEATURED_LINE.test(draft.caption_text ?? "");
  const featured = courseWin
    ? row(courseWin)
    : featuredA && picks.length
      ? row(picks[0])
      : null;
  const list = (featuredA ? picks.slice(1) : picks).map(row);
  return {
    date,
    draft_id: draft.id,
    status: draft.status,
    form: courseWin ? "b" : "a",
    content_type_id: sd.content_type?.id ?? null,
    featured,
    list,
  };
}

/** races を読むための race_id（重複なし） */
export const raceIdsOf = (draft) => [
  ...new Set(
    [
      draft?.source_data?.course_win?.featured?.race_id,
      ...(draft?.source_data?.digest?.picks ?? []).map((p) => p.race_id),
    ].filter(Boolean),
  ),
];

/** その日の親の下書き（返信の子・archived を除く）。2件以上は投げる */
export async function readTodayPicks(date, call) {
  const drafts = await call(
    `sns_drafts?send_lane=eq.A&format=eq.today_digest&source_data->digest->>date=eq.${date}&status=neq.archived&select=id,status,caption_text,source_data&limit=4`,
  );
  const parents = drafts.filter((d) => !d.source_data?.today_reply);
  if (parents.length > 1) throw new Error(`/today の下書きが2件ある: ${date}`);
  const draft = parents[0] ?? null;
  const ids = raceIdsOf(draft);
  const races = ids.length
    ? await call(
        `races?race_id=in.(${ids.map(encodeURIComponent).join(",")})&select=race_id,race_date,start_time,cancellation_status`,
      )
    : [];
  return todayPicksOf(date, draft, races);
}

async function main() {
  const date = process.argv[2];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date ?? "")) {
    console.error(
      "使い方: node --env-file=.env.local scripts/sns/today-picks.js <YYYY-MM-DD>",
    );
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL・SUPABASE_SERVICE_KEY が無い（.env.local）");
    process.exit(2);
  }
  const call = async (p) => {
    const response = await fetch(`${url}/rest/v1/${p}`, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
    });
    const text = await response.text();
    if (!response.ok)
      throw new Error(
        `DB の読み取りに失敗: HTTP ${response.status} ${p.split("?")[0]} ${text.slice(0, 300)}`,
      );
    return JSON.parse(text);
  };
  try {
    console.log(JSON.stringify(await readTodayPicks(date, call), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
