// 読み取り専用の用途で使う Supabase クライアント（リポジトリの node_modules から読み込む。.env.local は node --env-file で渡す）
import { createRequire } from "module";
const REPO = "/Users/terukina/boatrace-ai-predictor/.claude/worktrees/confident-chatelet-c22064";
const require = createRequire(`${REPO}/package.json`);
const { createClient } = require("@supabase/supabase-js");
const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_KEY;
if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY が無い（node --env-file=<repo>/.env.local で起動）");
export const supabase = createClient(url, key, { auth: { persistSession: false } });
