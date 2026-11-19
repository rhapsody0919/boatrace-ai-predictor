/**
 * SNS の暦日の取り込みの DB 操作（PostgREST）。snsDailyRunner.js の createSnsDailyStore を移した（振る舞いは同じ）。
 */
import { ENGAGED_WINDOW, SETSU_SHORT_FORMAT } from "./snsDailyRunnerParts.js";

const COLUMNS =
  "day,channel,draft_id,utm_content,source,metric_name,metric_value,missing_reason,definition";

/** PostgREST の読み書き（service_role）。失敗は握りつぶさず投げる */
export function createSnsDailyStore({ url, key, fetchImpl = fetch }) {
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  async function get(path) {
    const response = await fetchImpl(`${url}/rest/v1/${path}`, { headers });
    if (!response.ok)
      throw new Error(
        `日次の取り込みの DB の読み取りに失敗: HTTP ${response.status} ${path.split("?")[0]}`,
      );
    return response.json();
  }
  return {
    // pt3d の観測（入れ直すかは runner が指標と定義ごとに決める）
    engagedObservations: (draftIds, metrics) =>
      get(
        `sns_metric_observations?window=eq.${ENGAGED_WINDOW}&source=eq.youtube-analytics&metric_name=in.(${metrics.join(",")})&draft_id=in.(${draftIds.join(",")})&select=draft_id,metric_name,definition,metric_value,denominator_value,observed_at`,
      ),
    async appendObservation(draftId, observation) {
      const response = await fetchImpl(
        `${url}/rest/v1/rpc/append_sns_metric_observation`,
        {
          method: "POST",
          headers: { ...headers, "Content-Type": "application/json" },
          body: JSON.stringify({
            p_draft_id: draftId,
            p_observation: observation,
          }),
        },
      );
      if (!response.ok) {
        // PostgREST の本文は details（失敗した行の全体）が長く、先頭で切ると制約名が落ちる。code と message だけを残す
        const text = await response.text();
        let detail = text;
        try {
          const body = JSON.parse(text);
          detail = `${body.code ?? ""} ${body.message ?? ""}`.trim() || text;
        } catch {
          // JSON でなければ本文のまま
        }
        throw new Error(
          `観測の保存に失敗: HTTP ${response.status} ${detail.slice(0, 300)}`,
        );
      }
    },
    youtubeVideos: (since) =>
      get(
        `sns_x_send_jobs?channel=eq.youtube&state=eq.posted&posted_at=gte.${encodeURIComponent(since)}&select=draft_id,external_post_id,posted_at`,
      ),
    // 全貌（format=full_picture）の下書きを race_id から引く（push-full-picture が source_data.full_picture.race_id に入れる）
    fullPictureDrafts: (raceIds) =>
      get(
        `sns_drafts?format=eq.full_picture&source_data->full_picture->>race_id=in.(${raceIds.join(",")})&select=id,platform,posted_at,race_id:source_data->full_picture->>race_id`,
      ),
    // 節の機力の Shorts の投稿済みの下書き（説明欄のリンクで GA4 の行に結びつける）
    setsuShortDrafts: (since) =>
      get(
        `sns_drafts?format=eq.${SETSU_SHORT_FORMAT}&platform=eq.youtube&posted_at=gte.${encodeURIComponent(since)}&select=id,posted_at,caption_text`,
      ),
    async existingDrafts(ids) {
      return (await get(`sns_drafts?id=in.(${ids.join(",")})&select=id`)).map(
        (d) => d.id,
      );
    },
    // max-rows（1000）で切れないように 1000 行ずつ読む
    async existing(from, to) {
      const out = [];
      for (let offset = 0; ; offset += 1000) {
        const page = await get(
          `sns_channel_daily?day=gte.${from}&day=lte.${to}&select=${COLUMNS}&order=id.asc&limit=1000&offset=${offset}`,
        );
        out.push(...page);
        if (page.length < 1000) return out;
      }
    },
    async upsert(rows) {
      const response = await fetchImpl(
        `${url}/rest/v1/sns_channel_daily?on_conflict=day,channel,draft_id,utm_content,source,metric_name,definition`,
        {
          method: "POST",
          headers: {
            ...headers,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          },
          body: JSON.stringify(rows),
        },
      );
      if (!response.ok)
        throw new Error(`日次の取り込みの保存に失敗: HTTP ${response.status}`);
    },
  };
}
