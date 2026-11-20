// v0 の素材（bundle 由来）の公開の保留。api/_lib/snsBundleValidation.js から字のまま移した（api/ 側は再 export。保留の理由 sendHolds.js が使う）

/** 入力のreleaseフラグやQA.passを書き換えてもv0を公開可能にしない。 */
export function isBundlePublicationBlocked(draft) {
  return Boolean(
    draft.publish_blocked ||
    draft.bundle_import_id ||
    draft.bundle_version_hash,
  );
}
