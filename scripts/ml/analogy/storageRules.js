/**
 * BOA-271 Storage の版の扱いの規則（純粋関数）。storage.js が使い、
 * scripts/maintenance/verify-analogy-storage.js が固定データで検証する。
 */

/** 版のフォルダ名（YYYY-MM-DD で始まるもの）だけを新しい順に */
const datedVersions = (names) =>
  names
    .filter((n) => /^\d{4}-\d{2}-\d{2}/.test(n))
    .sort()
    .reverse();

/**
 * 消してよい版。新しい順に keep 個と、表示中の版（is_active）と、守る版（参照版など）は残す。
 * 書き込み（db.py）が何週か続けて失敗しても、表示中の版のモデルを消さない
 * （消すと次の週の品質ゲートで比べられず、学習が止まる）。参照版は品質ゲートの比較の相手なので消さない
 */
export function versionsToPrune(
  names,
  activeVersion,
  keep,
  protectedVersions = [],
) {
  return datedVersions(names)
    .slice(keep)
    .filter((v) => v !== activeVersion && !protectedVersions.includes(v));
}

/**
 * 今回の版をアップロードしてよいか。表示中の版と同じ名前なら上書きしない
 * （同じ日の再実行で表示中のモデルが入れ替わり、DB の寄与度と食い違うため）
 */
export function assertUploadable(version, activeVersion) {
  if (version === activeVersion) {
    throw new Error(
      `版 ${version} は表示中のため Storage のモデルを上書きしない（ANALOGY_MODEL_VERSION で別の版名にする）`,
    );
  }
}

/**
 * 長期データのキャッシュ（CSV、先頭行が列名）の列名が、今のコードの列と一致するか。
 * 列を変えてキャッシュの版を上げ忘れると、列がずれたまま黙って読まれるため
 */
export function assertCachedHeader(csv, expectedColumns, key) {
  const header = csv.slice(
    0,
    csv.indexOf("\n") === -1 ? csv.length : csv.indexOf("\n"),
  );
  if (header !== expectedColumns.join(",")) {
    throw new Error(
      `${key} の列が今のコードと違う（キャッシュ: ${header} / コード: ${expectedColumns.join(",")}）。KB_CACHE_VERSION を上げる`,
    );
  }
}
