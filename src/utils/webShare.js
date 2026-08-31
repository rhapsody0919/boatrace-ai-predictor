/**
 * Web Share API 対応判定ヘルパー
 *
 * iOS Safariの動画ファイル共有は歴史的に不完全なことが確認されている
 * （docs/design/sns-marketing-hub/spec.md参照）。そのため呼び出し側は必ず
 * canShareVideo()がfalseの場合のダウンロードリンク等へのフォールバックとセットで使う。
 */

/**
 * 指定したURLの動画ファイルをWeb Share APIで共有できるか判定する。
 * @param {string} videoUrl
 * @param {string} [fileName]
 * @returns {Promise<{canShare: boolean, file: File|null}>}
 */
export async function canShareVideo(videoUrl, fileName = "video.mp4") {
  if (!navigator.canShare || !navigator.share) {
    return { canShare: false, file: null };
  }

  try {
    const response = await fetch(videoUrl);
    const blob = await response.blob();
    const file = new File([blob], fileName, { type: blob.type || "video/mp4" });

    if (navigator.canShare({ files: [file] })) {
      return { canShare: true, file };
    }
    return { canShare: false, file: null };
  } catch (err) {
    console.error("canShareVideo判定エラー:", err);
    return { canShare: false, file: null };
  }
}

/**
 * 動画ファイルをWeb Share APIで共有する。
 * @param {File} file
 * @param {string} [title]
 */
export async function shareVideoFile(file, title = "") {
  await navigator.share({ files: [file], title });
}

/**
 * クロスオリジンの動画URL（Supabase Storage署名付きURL等）を、再生させずに
 * ファイルとしてダウンロードさせる。
 *
 * `<a href={crossOriginUrl} download>`のdownload属性はクロスオリジンURLに対して
 * ブラウザ仕様上無視されるため、リンク先へ直接遷移してしまい動画再生UIが表示される
 * （2026-08-31判明）。fetchでBlobとして取得し、同一オリジンのblob URL経由で
 * ダウンロードをトリガーすることでこれを回避する。
 * @param {string} videoUrl
 * @param {string} [fileName]
 */
export async function downloadVideoBlob(videoUrl, fileName = "video.mp4") {
  const response = await fetch(videoUrl);
  if (!response.ok) {
    throw new Error(`動画の取得に失敗しました: ${response.status}`);
  }
  const blob = await response.blob();
  const objectUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objectUrl;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objectUrl);
}
