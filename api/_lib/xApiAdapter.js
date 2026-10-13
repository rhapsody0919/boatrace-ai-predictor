/**
 * X API v2 の実 adapter（sns-pdca-loop tasks 17）。runXSendJob（snsXSend.js）の契約どおりの形にする:
 * initialize({size,type,category}) / append({id,index,bytes}) / finalize(id) / status(id) / createPost({text,mediaIds,replyTo})
 * - 媒体は v2 の分割アップロード（/2/media/upload/initialize・{id}/append・{id}/finalize、状態は GET /2/media/upload?command=STATUS）
 * - 投稿は POST /2/tweets。返信は reply.in_reply_to_tweet_id
 * - POST は自動で再試行しない（応答が分からない投稿は要照合に残す。契約どおり）
 * - posted_at は投稿の ID（snowflake）に入っている作成時刻から求める（読み取りの API を余分に呼ばない）
 */
export const X_API_BASE = "https://api.x.com";
const TIMEOUT_MS = 30000;
// X の snowflake ID の時刻の起点（2010-11-04T01:42:54.657Z）
const SNOWFLAKE_EPOCH_MS = 1288834974657n;

export function postedAtFromId(id) {
  if (!/^[0-9]{1,19}$/.test(id)) throw new Error("X の投稿 ID が不正です");
  return new Date(
    Number((BigInt(id) >> 22n) + SNOWFLAKE_EPOCH_MS),
  ).toISOString();
}

/**
 * accessToken は呼び出し側（runner）が claim の前に getXAccessToken で取って渡す。
 * adapter の中で取ると、テキストだけの投稿では最初の呼び出しが begin_post の後の createPost になり、
 * トークンの取得の失敗で、何も投稿していない job が要照合に落ちるため
 */
export function createXApiAdapter({ accessToken, fetchImpl = fetch }) {
  if (!accessToken) throw new Error("X の access token がありません");
  // 媒体 ID ごとの種類（finalize で動画かどうかを見るため）
  const categories = new Map();
  async function call(path, { method = "GET", json, form } = {}) {
    const response = await fetchImpl(`${X_API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(json ? { "Content-Type": "application/json" } : {}),
      },
      body: json ? JSON.stringify(json) : form,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let body = {};
    let parseError = null;
    try {
      body = text ? JSON.parse(text) : {};
    } catch (error) {
      parseError = error;
    }
    if (response.ok && parseError)
      throw new Error(
        `X API ${method} ${path.split("?")[0]} の応答を解釈できません: HTTP ${response.status}`,
      );
    if (!response.ok) {
      // 応答の本文（API の詳細）は DB・ログに残さない契約なので、状態コードと X のエラーの種類だけを出す
      const kind = body?.title || body?.errors?.[0]?.title || "";
      throw new Error(
        `X API ${method} ${path.split("?")[0]} が失敗: HTTP ${response.status}${kind ? ` ${kind}` : ""}`,
      );
    }
    return body;
  }
  return {
    async initialize({ size, type, category }) {
      const body = await call("/2/media/upload/initialize", {
        method: "POST",
        json: { media_type: type, total_bytes: size, media_category: category },
      });
      if (!body?.data?.id) throw new Error("X の媒体 ID が返りません");
      categories.set(body.data.id, category);
      return { id: body.data.id };
    },
    async append({ id, index, bytes }) {
      const form = new FormData();
      form.append("segment_index", String(index));
      form.append("media", new Blob([bytes]), "chunk");
      await call(`/2/media/upload/${encodeURIComponent(id)}/append`, {
        method: "POST",
        form,
      });
    },
    // 処理の完了は明示の状態でだけ認める。応答に data が無い（空・{}・null）ときは投げて、投稿の前に保留にする。
    // 画像は processing_info を省略した finalize の応答を完了とみなす。動画は省略されても完了とせず、STATUS で
    // 明示の状態を確かめる（処理を待たずに投稿へ進まないため。開発の補助の点検 D1、2026-10-13）
    async finalize(id) {
      const body = await call(
        `/2/media/upload/${encodeURIComponent(id)}/finalize`,
        {
          method: "POST",
        },
      );
      if (!body?.data)
        throw new Error("X の媒体の finalize の応答に data がありません");
      const info = body.data.processing_info;
      if (info) return { processing_info: info };
      return categories.get(id) === "tweet_video"
        ? { processing_info: { state: "pending", check_after_secs: 1 } }
        : { processing_info: null };
    },
    async status(id) {
      const body = await call(
        `/2/media/upload?command=STATUS&media_id=${encodeURIComponent(id)}`,
      );
      const info = body?.data?.processing_info;
      if (!info?.state)
        throw new Error(
          "X の媒体の処理状態が読めません（STATUS の応答に processing_info.state がありません）",
        );
      return { processing_info: info };
    },
    async createPost({ text, mediaIds = [], replyTo }) {
      const body = await call("/2/tweets", {
        method: "POST",
        json: {
          text,
          ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}),
          ...(replyTo ? { reply: { in_reply_to_tweet_id: replyTo } } : {}),
        },
      });
      const id = body?.data?.id;
      // 投稿は作られたが ID が読めない場合も、投げて要照合に残す（再送しない）
      if (!/^[0-9]{1,19}$/.test(id ?? ""))
        throw new Error("X の投稿 ID が返りません");
      return { id, posted_at: postedAtFromId(id) };
    },
  };
}
