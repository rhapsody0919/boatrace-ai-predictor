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
