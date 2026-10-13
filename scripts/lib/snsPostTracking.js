/**
 * X の親の投稿の UTM（sns-pdca-loop tasks 23、plan §2・§5、spec C3）。
 * auto-plan（tasks 12）が承認の前に呼ぶ: 本文のレースの URL を UTM つきに差し替え → sns_post_tracking に保存 → 禁止表現の検査 → 承認。
 * 本文を変えるのは承認の前だけ（承認の後に変えると承認の snapshot と食い違い、承認が失効する）。
 *
 * - 対象は X のスレッドの親（thread_index=0）だけ。URL を含む投稿は1スレッドに1件（spec の費用の前提）
 * - campaign=race-full、utm_content=下書きの ID（素材 v1 は型の版が無い）。GA4 の取り込み（tasks 22）はこの utm_content で投稿に結びつける
 * - X は URL を長さに関係なく23文字と数えるので、UTM を足しても本文の重みは変わらない
 */
import { buildObservationUtm } from "../../src/utils/snsObservations.js";

/** 本文の中のレースの URL（後ろに URL の続きの文字が無いもの）をちょうど1か所、UTM つきに差し替える。差し替え済みならそのまま返す */
export function insertTrackingUrl(text, raceUrl, trackingUrl) {
  if (typeof text !== "string") throw new Error("本文がありません");
  const count = (needle) => text.split(needle).length - 1;
  const escaped = raceUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  // URL の続きの文字（英数・記号）が後ろに来ない位置だけを、URL の終わりとみなす（「。」や改行は終わり）
  const pattern = new RegExp(`${escaped}(?![\\w\\-./?%&=#~:+@!$'()*,;])`, "g");
  const hits = text.match(pattern)?.length ?? 0;
  // 差し替え済み（auto-plan のやり直し）。素の URL が別に残っていれば曖昧として止める
  if (count(trackingUrl) === 1 && hits === 0) return text;
  if (hits === 0) throw new Error("race_url_missing");
  if (hits > 1 || count(raceUrl) !== hits)
    throw new Error("race_url_ambiguous");
  return text.replace(pattern, trackingUrl);
}

/**
 * @param {{draft: {id: string, platform: string, thread_index?: number, caption_text: string, template_variant_id?: string|null},
 *          raceUrl: string, releaseEvidence: object}} input
 * @returns {{text: string, tracking: object}|null} X の親でなければ null
 */
export function prepareRaceTracking({ draft, raceUrl, releaseEvidence }) {
  if (draft.platform !== "x" || (draft.thread_index ?? 0) !== 0) return null;
  const tracking = buildObservationUtm({
    raceUrl,
    draftId: draft.id,
    variantId: draft.template_variant_id ?? null,
    releaseEvidence,
    campaign: "race-full",
  });
  return {
    text: insertTrackingUrl(draft.caption_text, raceUrl, tracking.tracking_url),
    tracking,
  };
}

const TRACKING_COLUMNS = [
  "draft_id",
  "template_variant_id",
  "race_url",
  "tracking_url",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "release_evidence",
];

/**
 * sns_post_tracking への保存（service_role。表は INSERT だけ許す）。同じ下書きの行が既にあれば入れず、
 * 既存の tracking_url が同じなら成功、違えば投げる（auto-plan のやり直しで別の URL を黙って使わない）
 */
export function createPostTrackingStore({ url, key, fetchImpl = fetch }) {
  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
  };
  return {
    async save(tracking) {
      const row = Object.fromEntries(
        TRACKING_COLUMNS.map((column) => [column, tracking[column] ?? null]),
      );
      const insert = await fetchImpl(
        `${url}/rest/v1/sns_post_tracking?on_conflict=draft_id`,
        {
          method: "POST",
          headers: { ...headers, Prefer: "resolution=ignore-duplicates" },
          body: JSON.stringify(row),
        },
      );
      if (!insert.ok)
        throw new Error(`UTM の保存に失敗: HTTP ${insert.status}`);
      const read = await fetchImpl(
        `${url}/rest/v1/sns_post_tracking?draft_id=eq.${row.draft_id}&select=tracking_url`,
        { headers },
      );
      if (!read.ok)
        throw new Error(`UTM の読み直しに失敗: HTTP ${read.status}`);
      const [saved] = await read.json();
      if (saved?.tracking_url !== row.tracking_url)
        throw new Error("tracking_url_conflict");
    },
  };
}
