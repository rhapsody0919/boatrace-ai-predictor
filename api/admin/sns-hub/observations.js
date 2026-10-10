import { requireAdminAuth } from "../../_lib/adminAuth.js";
import {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  jsonResponse,
  isConfigured,
  isValidDraftId,
  getDraftById,
} from "../../_lib/snsHubHelpers.js";
import {
  validateObservation,
  OBSERVATION_WINDOWS,
  OBSERVATION_METRICS,
  OBSERVED_PLATFORMS,
} from "../../../src/utils/snsObservations.js";
import {
  csvPublicationRange,
  buildObservationCsvRows,
  serializeObservationCsv,
} from "../../../src/utils/snsObservationCsv.js";
export const config = { runtime: "edge" };

// 読み始めの上限を固定し、一意キーのカーソルで全ページを読む。
export async function readObservationPages(
  table,
  params,
  cutoff = new Date().toISOString(),
) {
  const rows = [];
  let cursor = null;
  for (;;) {
    const query = new URLSearchParams({
      ...params,
      order: "id.asc",
      limit: "500",
      created_at: `lte.${cutoff}`,
      ...(cursor === null ? {} : { id: `gt.${cursor}` }),
    });
    const response = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${query}`, {
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
      },
    });
    if (!response.ok)
      throw new Error(`観測データ取得エラー: ${response.status}`);
    const page = await response.json();
    if (!Array.isArray(page)) throw new Error("観測データの応答が不正です");
    rows.push(...page);
    if (page.length < 500) return rows;
    cursor = page.at(-1).id;
  }
}

/** 既存カーソル読み取りと同じ締切。SQL・生履歴を変更しない。 */
export async function readObservationCsv(
  start,
  end,
  platform,
  cutoff = new Date().toISOString(),
) {
  const range = csvPublicationRange(start, end, platform);
  const [drafts, observations] = await Promise.all([
    readObservationPages(
      "sns_drafts",
      {
        select:
          "id,status,platform,format,template_variant_id,posted_at,source_data",
        status: "eq.posted",
        platform:
          platform === "all"
            ? `in.(${OBSERVED_PLATFORMS.join(",")})`
            : `eq.${platform}`,
        and: `(posted_at.gte.${range.start},posted_at.lt.${range.end},posted_at.lte.${cutoff})`,
      },
      cutoff,
    ),
    readObservationPages(
      "sns_metric_observations",
      {
        select: "*,sns_drafts!inner(id)",
        source: "neq.mock",
        observed_at: `lte.${cutoff}`,
        "sns_drafts.status": "eq.posted",
        "sns_drafts.platform":
          platform === "all"
            ? `in.(${OBSERVED_PLATFORMS.join(",")})`
            : `eq.${platform}`,
        "sns_drafts.and": `(posted_at.gte.${range.start},posted_at.lt.${range.end},posted_at.lte.${cutoff})`,
      },
      cutoff,
    ),
  ]);
  return serializeObservationCsv(
    buildObservationCsvRows(drafts, observations, {
      start,
      end,
      platform,
      now: Date.parse(cutoff),
    }),
  );
}

export default async function handler(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (!["GET", "POST"].includes(req.method))
    return jsonResponse({ error: "Method not allowed" }, 405);
  if (!isConfigured())
    return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      if (url.searchParams.get("export") === "csv") {
        const start = url.searchParams.get("start");
        const end = url.searchParams.get("end");
        const platform = url.searchParams.get("platform") || "all";
        try {
          csvPublicationRange(start, end, platform);
        } catch {
          return jsonResponse({ error: "公開日・チャネルが不正です" }, 400);
        }
        const csv = await readObservationCsv(start, end, platform);
        return new Response(csv, {
          headers: {
            "Content-Type": "text/csv; charset=utf-8",
            "Content-Disposition": `attachment; filename="posts-${start}-${end}-${platform}.csv"`,
            "Cache-Control": "no-store",
          },
        });
      }
      const window = url.searchParams.get("window") || "48h";
      const metric = url.searchParams.get("metric") || "views";
      if (
        !Object.hasOwn(OBSERVATION_WINDOWS, window) ||
        !OBSERVATION_METRICS.includes(metric)
      )
        return jsonResponse({ error: "観測窓・指標名が不正です" }, 400);
      const cutoff = new Date().toISOString();
      const [drafts, observations] = await Promise.all([
        readObservationPages(
          "sns_drafts",
          {
            select: "id,platform,language,format,template_variant_id,posted_at",
            posted_at: `lte.${cutoff}`,
            platform: `in.(${OBSERVED_PLATFORMS.join(",")})`,
          },
          cutoff,
        ),
        readObservationPages(
          "sns_metric_observations",
          {
            select: "*",
            window: `eq.${window}`,
            metric_name: `eq.${metric}`,
          },
          cutoff,
        ),
      ]);
      return jsonResponse({ data: { drafts, observations } });
    }
    let body;
    try {
      body = await req.json();
    } catch {
      return jsonResponse({ error: "JSONが不正です" }, 400);
    }
    if (!body || !isValidDraftId(body.draft_id))
      return jsonResponse({ error: "投稿IDが不正です" }, 400);
    const draft = await getDraftById(body.draft_id);
    if (!draft) return jsonResponse({ error: "下書きが見つかりません" }, 404);
    if (draft.status !== "posted")
      return jsonResponse({ error: "投稿済みのみ観測できます" }, 409);
    let observation;
    try {
      observation = validateObservation(body, draft);
      if (Date.parse(observation.observed_at) > Date.now())
        throw new Error("未来の観測日時は保存できません");
      if (observation.source === "mock")
        throw new Error("モックは本番の保存対象外です");
    } catch (error) {
      return jsonResponse({ error: error.message }, 400);
    }
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/append_sns_metric_observation`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_draft_id: draft.id,
          p_observation: observation,
        }),
      },
    );
    if (!response.ok) throw new Error(`観測追記エラー: ${response.status}`);
    return jsonResponse({ data: await response.json() }, 201);
  } catch (error) {
    console.error("SNS観測取得・保存失敗", error.message);
    return jsonResponse({ error: "観測データの処理に失敗しました" }, 500);
  }
}
