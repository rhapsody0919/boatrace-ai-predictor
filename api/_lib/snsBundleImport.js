import { SUPABASE_URL, SUPABASE_SERVICE_KEY, SNS_HUB_STORAGE_BUCKET } from "./snsHubHelpers.js";
import { BUNDLE_SCHEMA } from "./snsBundleValidation.js";

/** 保存インターフェースを注入して、実サービスへ接続せず検証する。 */
export async function importValidatedBundle(validated, store) {
  const { bundle, qa, versionHash, holds, missing, files } = validated;
  const manifest = [];
  for (const entry of validated.manifest) {
    const path = `bundle-imports/${versionHash}/${entry.name}`;
    await store.saveFile(path, files.get(entry.name));
    manifest.push({ ...entry, storage_path: path });
  }
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
    const response = await fetch(`${SUPABASE_URL}/storage/v1/object/${SNS_HUB_STORAGE_BUCKET}/${path}`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": file.mime,
        "x-upsert": "true",
      },
      body: file.bytes,
    });
    if (!response.ok) throw new Error(`素材保存に失敗しました (${response.status})。同じ添付で再試行できます`);
  },
  async register(payload) {
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/import_sns_preview_bundle`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${SUPABASE_SERVICE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
    if (!response.ok) throw new Error(`素材登録に失敗しました (${response.status})。同じ添付で再試行できます`);
    return response.json();
  },
};
