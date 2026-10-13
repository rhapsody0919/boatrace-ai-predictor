/**
 * YouTube Data API v3 の実 adapter（sns-pdca-loop tasks 18）。snsDeadlineQueue.js の
 * runYoutubeQueueJob・runYoutubePublishJob・reconcileYoutubeJob の契約どおりの形にする（案B: 非公開で上げて確かめてから公開）:
 * - upload({snapshot, media, privacyStatus:'private', publishAt:null, beforeCall, uploaded}) → uploaded の戻り値
 * - processing(job) → {confirmed, id, privacyStatus, processingStatus}
 * - makePublic({job, privacyStatus:'public', publishAt:null, beforeCall}) → {confirmed, id, privacyStatus, posted_at}
 * - lookup(job) → 同上（照合の読み取り）
 * 各 Data API の呼び出しの直前に beforeCall(method) でクォータの台帳へ記録する（146 の契約）。自動で再試行しない。
 * 動画は 32 MiB までなので、1回の multipart で上げる（続きから送る仕組みは作らない。plan §4）。
 * access token は runner が claim の前に取って渡す（X の adapter と同じ理由）。
 */
const API = "https://www.googleapis.com/youtube/v3";
const UPLOAD_API = "https://www.googleapis.com/upload/youtube/v3";
const TIMEOUT_MS = 120000;
const VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
// videos.update の part=status は status を丸ごと書き換える（指定しない項目は既定値に戻る）。
// upload と公開で同じ項目を送るよう、privacyStatus 以外はここにまとめる
const STATUS_FIELDS = { selfDeclaredMadeForKids: false };
const TITLE_MAX = 100;
export const VIDEO_MAX_BYTES = 32 * 1024 * 1024;

/** 承認の snapshot のハッシュタグを YouTube のタグ（先頭の # を外したキーワード）にする。空と重複は除く */
export function youtubeTagsOf(snapshot) {
  const tags = (snapshot?.source?.hashtags ?? [])
    .filter((tag) => typeof tag === "string")
    .map((tag) => tag.trim().replace(/^#+/, ""))
    .filter(Boolean);
  return [...new Set(tags)];
}

/** YouTube が受け付けない題名（空・100文字超・< >）と、1回で上げられない大きさの動画を、送る前に見つける */
export function validateYoutubeSnapshot(snapshot) {
  const title = snapshot?.youtube_title ?? "";
  if (!title.trim() || [...title].length > TITLE_MAX || /[<>]/.test(title))
    throw new Error("youtube_title_invalid");
  // 1回の multipart で上げるので、動画は 32 MiB まで（ADR 0090 の素材 v1 と同じ上限）。承認は 500 MiB まで通るが、
  // それより大きい動画は送る前に止める（関数の時間・メモリで途中で切れると、上がったか分からない要照合になるため）
  if (!(snapshot?.media?.[0]?.size <= VIDEO_MAX_BYTES))
    throw new Error("youtube_video_too_large");
}

export function createYoutubeQueueAdapter({ accessToken, fetchImpl = fetch }) {
  if (!accessToken) throw new Error("YouTube の access token がありません");
  async function call(url, { method = "GET", headers = {}, body } = {}) {
    const response = await fetchImpl(url, {
      method,
      headers: { Authorization: `Bearer ${accessToken}`, ...headers },
      body,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    let parsed = null;
    let parseError = null;
    try {
      parsed = text ? JSON.parse(text) : {};
    } catch (error) {
      parseError = error;
    }
    const where = `${method} ${new URL(url).pathname}`;
    if (!response.ok) {
      // API の本文は DB・ログに残さない契約なので、状態コードと Google のエラーの理由だけを出す
      const reason =
        parsed?.error?.errors?.[0]?.reason || parsed?.error?.status || "";
      throw new Error(
        `YouTube API ${where} が失敗: HTTP ${response.status}${reason ? ` ${reason}` : ""}`,
      );
    }
    if (parseError)
      throw new Error(
        `YouTube API ${where} の応答を解釈できません: HTTP ${response.status}`,
      );
    return parsed;
  }
  // 自分がアップロードした動画だけが processingDetails を返す（他人の動画では見えない）。これを本人の動画の確認に使う
  async function readVideo(id) {
    const body = await call(
      `${API}/videos?part=status,snippet,processingDetails&id=${encodeURIComponent(id)}`,
    );
    return body.items?.find((item) => item.id === id) ?? null;
  }
  const approvedTitle = (job) => job?.snapshot?.youtube_title ?? null;
  const isOwnApproved = (video, job) =>
    Boolean(
      video &&
      video.processingDetails &&
      video.snippet?.title === approvedTitle(job),
    );

  return {
    async upload({
      snapshot,
      media,
      privacyStatus,
      publishAt,
      beforeCall,
      uploaded,
    }) {
      if (privacyStatus !== "private" || publishAt !== null)
        throw new Error("YouTube は非公開でだけ上げる（案B）");
      const [video, cover] = media;
      if (!video?.bytes || video.type !== "video/mp4")
        throw new Error("動画がありません");
      const metadata = {
        snippet: {
          title: snapshot.youtube_title,
          // 承認した版をそのまま送る: 説明は承認の完成文（本文＋タグの行）、タグは承認したハッシュタグ。どちらも承認の hash に入る
          description: snapshot.text ?? "",
          tags: youtubeTagsOf(snapshot),
        },
        status: {
          privacyStatus: "private",
          ...STATUS_FIELDS,
        },
      };
      const boundary = `ryujin-${crypto.randomUUID()}`;
      const body = new Blob([
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n`,
        `--${boundary}\r\nContent-Type: video/mp4\r\n\r\n`,
        video.bytes,
        `\r\n--${boundary}--`,
      ]);
      await beforeCall("videos.insert");
      const inserted = await call(
        `${UPLOAD_API}/videos?uploadType=multipart&part=snippet,status`,
        {
          method: "POST",
          headers: {
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body,
        },
      );
      if (!VIDEO_ID.test(inserted?.id ?? ""))
        throw new Error("YouTube の動画 ID が返りません");
      const job = await uploaded(inserted.id);
      if (cover) {
        await beforeCall("thumbnails.set");
        // サムネイルの Content-Type は媒体に合わせる（承認時に jpeg・png だけを通している）
        await call(
          `${UPLOAD_API}/thumbnails/set?videoId=${encodeURIComponent(inserted.id)}&uploadType=media`,
          {
            method: "POST",
            headers: { "Content-Type": cover.type },
            body: cover.bytes,
          },
        );
      }
      return job;
    },

    validate: validateYoutubeSnapshot,

    async processing(job) {
      const video = job.external_post_id
        ? await readVideo(job.external_post_id)
        : null;
      return {
        confirmed: isOwnApproved(video, job),
        id: video?.id ?? null,
        privacyStatus: video?.status?.privacyStatus ?? null,
        processingStatus: video?.processingDetails?.processingStatus ?? null,
      };
    },

    async makePublic({ job, privacyStatus, publishAt, beforeCall }) {
      if (privacyStatus !== "public" || publishAt !== null)
        throw new Error("公開は即時だけ");
      await beforeCall("videos.update");
      await call(`${API}/videos?part=status`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: job.external_post_id,
          status: {
            privacyStatus: "public",
            ...STATUS_FIELDS,
          },
        }),
      });
      await beforeCall("videos.list");
      return publicationResult(await readVideo(job.external_post_id), job);
    },

    // 動画 ID が分からない（insert の応答を失った）job は一覧を探さずオーナーの照合に残す（呼び出しもしない）
    async lookup(job) {
      if (!job.external_post_id) return publicationResult(null, job);
      return publicationResult(await readVideo(job.external_post_id), job);
    },
  };

  // 公開を確かめた結果。posted_at は公開後の snippet.publishedAt（非公開の間の時刻や upload の終了時刻は使わない）
  function publicationResult(video, job) {
    const confirmed =
      isOwnApproved(video, job) &&
      video.status?.privacyStatus === "public" &&
      Number.isFinite(Date.parse(video.snippet?.publishedAt));
    return {
      confirmed,
      id: video?.id ?? null,
      privacyStatus: video?.status?.privacyStatus ?? null,
      posted_at: confirmed ? video.snippet.publishedAt : null,
    };
  }
}
