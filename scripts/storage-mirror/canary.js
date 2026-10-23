#!/usr/bin/env node
/**
 * R2 の鍵のカナリア（.github/workflows/key-canary.yml の r2 の job、ADR-0101）。manifests/ を1件だけ一覧する読み取り。
 * 書き込みはしない。失敗は `R2 HTTP 401・403` の形で出し、job-watch が「鍵・設定の誤り」に分ける。
 */
import { MANIFEST_PREFIX } from "../lib/storageMirror.js";
import { createR2Client, r2EnvOrThrow } from "./r2.js";

try {
  await createR2Client(r2EnvOrThrow()).listOne(MANIFEST_PREFIX);
  console.log("R2 OK");
} catch (e) {
  console.error(`::error::${e.message}`);
  process.exit(1);
}
