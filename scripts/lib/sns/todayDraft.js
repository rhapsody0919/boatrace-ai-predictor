// 下書きが /today の投稿かの判定。api/_lib/snsTodayDigest.js から字のまま移した（api/ 側は再 export。保留の理由 sendHolds.js が使う）

/** 下書きが /today の投稿か（source_data.digest を持ち、素材のバンドルではない） */
export const isTodayDraft = (draft) =>
  !draft?.bundle_import_id &&
  /^\d{4}-\d{2}-\d{2}$/.test(draft?.source_data?.digest?.date ?? "");
