/**
 * 取得した生HTMLの保管（optimal-scraping-design.md §2.2・承認済みQ1）の最小実装。
 *
 * 「解析結果だけ保存してHTMLを捨てる」と、パーサーの誤りや新しい項目の追加のたびに公式サイトへ取り直すことになる。
 * 取り直せない（取り直すと別の値になる）ページの誤りは後から直せない。そのため、内容が変わったときだけ、
 * gzipしてSupabase Storageの非公開バケットへ置く。
 *
 * 保管の形（ピットレポートの最小実装。他のページ種別は、同じ関数にページ種別を渡して広げる）:
 *   バケット   RAW_HTML_BUCKET（非公開。作成は外部サービスの設定変更のため、ユーザーの承認のもとで行う）
 *   パス       raw/{pageType}/{YYYY-MM-DD}/{race_id}/{内容ハッシュの先頭16桁}.html.gz
 *              （内容ハッシュをファイル名にするため、同じ内容の再取得は同じパスになり、二重に置かない）
 *   台帳       DBの列（race_pit_reports.raw_storage_path）に、生のパスを入れる（署名付きURLは入れない。
 *              読み取り側が都度署名する。.claude/rules/sns-content-generation.md のパス規約と同じ）
 *   用途       内部の再解析のみ。再配布・公開しない（docs/adr/0067）。保管は失敗しても取得を失敗にしない
 *              （取り直せるページでは、保管は保険のため）
 *
 * バケットが無い・書き込めない場合は、警告を出して null を返す（呼び出し側は raw_storage_path を NULL にする）。
 */
import { gzipSync } from "node:zlib";

/** 生HTMLの非公開バケット名（案。作成はユーザーの承認のもとで行う） */
export const RAW_HTML_BUCKET = "raw-pages";

/**
 * @param {{pageType: string, raceId: string, contentHash: string}} params
 * @returns {string} Storage上のパス（生のパス）
 */
export function rawHtmlPath({ pageType, raceId, contentHash }) {
  if (!/^\d{4}-\d{2}-\d{2}-\d{2}-\d{2}$/.test(raceId)) {
    throw new Error(`race_id の形式が不正です: ${raceId}`);
  }
  if (!/^[0-9a-f]{16,}$/.test(contentHash)) {
    throw new Error("contentHash は16進の文字列（16桁以上）で指定してください");
  }
  return `raw/${pageType}/${raceId.slice(0, 10)}/${raceId}/${contentHash.slice(0, 16)}.html.gz`;
}

/**
 * 生HTMLをgzipして保管する。失敗しても例外にせず、null を返す。
 *
 * @param {import("@supabase/supabase-js").SupabaseClient} client
 * @param {{pageType: string, raceId: string, contentHash: string, html: string}} params
 * @returns {Promise<string|null>} 保管したパス。保管できなかったとき null
 */
export async function archiveRawHtml(
  client,
  { pageType, raceId, contentHash, html },
  { bucket = RAW_HTML_BUCKET, warn = (m) => console.warn(m) } = {},
) {
  let path;
  try {
    path = rawHtmlPath({ pageType, raceId, contentHash });
    const { error } = await client.storage
      .from(bucket)
      .upload(path, gzipSync(Buffer.from(html, "utf8")), {
        upsert: true,
        contentType: "application/gzip",
      });
    if (error) throw new Error(error.message);
    return path;
  } catch (error) {
    warn(
      `⚠️ 生HTMLを保管できませんでした（${pageType} ${raceId}。取得は続けます）: ${error.message}`,
    );
    return null;
  }
}
