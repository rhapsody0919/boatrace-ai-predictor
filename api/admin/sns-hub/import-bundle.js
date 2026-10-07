import riskRules from "../../../sns-video-studio/remotion/risk-rules.json";
import { requireAdminAuth } from "../../_lib/adminAuth.js";
import { jsonResponse, isConfigured } from "../../_lib/snsHubHelpers.js";
import { readBundleForm, validateBundle, BundleValidationError } from "../../_lib/snsBundleValidation.js";
import { importValidatedBundle, bundleStore } from "../../_lib/snsBundleImport.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  const denied = await requireAdminAuth(req);
  if (denied) return denied;
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);
  if (!isConfigured()) return jsonResponse({ error: "Supabase環境変数が未設定です" }, 500);
  try {
    const validated = await validateBundle(await readBundleForm(req), riskRules.rules);
    const data = await importValidatedBundle(validated, bundleStore);
    return jsonResponse({ data });
  } catch (error) {
    return jsonResponse({ error: error.message }, error instanceof BundleValidationError ? error.status : 500);
  }
}
