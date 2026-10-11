import {
  SUPABASE_URL,
  SUPABASE_SERVICE_KEY,
  SNS_HUB_STORAGE_BUCKET,
} from "./snsHubHelpers.js";
import { BUNDLE_SCHEMA } from "./snsBundleValidation.js";

/** 保存インターフェースを注入して、実サービスへ接続せず検証する。 */
export async function importValidatedBundle(validated, store) {
  const { bundle, qa, versionHash, holds, missing, files } = validated;
  // 保存先パスはversionHash+ファイル名で決まり、ファイル間に順序依存は無いため並列化する。
  const manifest = await Promise.all(
    validated.manifest.map(async (entry) => {
      const path = `bundle-imports/${versionHash}/${entry.name}`;
      await store.saveFile(path, files.get(entry.name));
      return { ...entry, storage_path: path };
    }),
  );
  // 保存に失敗したら下書きを作らない。途中保存は同じパスへ再試行できる。
  return store.register({
    p_version_hash: versionHash,
    p_schema_version: BUNDLE_SCHEMA,
    p_bundle: bundle,
    p_qa: qa,
    p_manifest: manifest,
    p_missing: missing,
    p_hold_reasons: holds,
    p_risk_flags: validated.riskFlags,
  });
}

export const bundleStore = {
  async saveFile(path, file) {
    const response = await fetch(
      `${SUPABASE_URL}/storage/v1/object/${SNS_HUB_STORAGE_BUCKET}/${path}`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": file.mime,
          "x-upsert": "true",
        },
        body: file.bytes,
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // 5xxは一時的な障害の可能性があるため再試行を促す。4xxはパス・権限等の
      // 構造的な失敗で、同じ添付を再送しても同じ結果になりうるため言わない
      // （registerと同じ方針。2026-10-07レビュー指摘F02対応）。
      const retryHint =
        response.status >= 500 ? "。同じ添付で再試行できます" : "";
      throw new Error(
        `素材保存に失敗しました (${response.status})${detail ? `: ${detail}` : ""}${retryHint}`,
      );
    }
  },
  async register(payload) {
    const response = await fetch(
      `${SUPABASE_URL}/rest/v1/rpc/import_sns_preview_bundle`,
      {
        method: "POST",
        headers: {
          apikey: SUPABASE_SERVICE_KEY,
          Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      },
    );
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      // 5xxは一時的な障害の可能性があるため再試行を促す。4xxはRPC側の制約違反等、
      // 同じ添付を再送しても同じ結果になりうるため「再試行できます」とは言わない。
      const retryHint =
        response.status >= 500 ? "。同じ添付で再試行できます" : "";
      throw new Error(
        `素材登録に失敗しました (${response.status})${detail ? `: ${detail}` : ""}${retryHint}`,
      );
    }
    return response.json();
  },
};
