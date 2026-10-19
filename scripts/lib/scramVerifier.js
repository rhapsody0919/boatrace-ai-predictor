/**
 * PostgreSQL の SCRAM-SHA-256 の検証子（pg_authid.rolpassword の形）を作る。RFC 5802 / RFC 7677。
 * ALTER ROLE … PASSWORD にこの文字列を渡すと、平文のパスワードを SQL Editor の履歴・ログに残さずに設定できる
 * （scripts/db/ro-setup.js、ADR-0096）。パスワードは ASCII だけを想定する（SASLprep をしない）。
 */
import { createHash, createHmac, pbkdf2Sync, randomBytes } from "node:crypto";

export const SCRAM_ITERATIONS = 4096;

/**
 * @param {string} password
 * @param {{ salt?: Buffer, iterations?: number }} [options]
 */
export function scramSha256Verifier(
  password,
  { salt = randomBytes(16), iterations = SCRAM_ITERATIONS } = {},
) {
  if (!/^[\x21-\x7e]+$/.test(password)) {
    throw new Error(
      "パスワードは空白を含まない ASCII の印字可能文字だけにする",
    );
  }
  const salted = pbkdf2Sync(password, salt, iterations, 32, "sha256");
  const clientKey = createHmac("sha256", salted).update("Client Key").digest();
  const storedKey = createHash("sha256").update(clientKey).digest();
  const serverKey = createHmac("sha256", salted).update("Server Key").digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString("base64")}$${storedKey.toString("base64")}:${serverKey.toString("base64")}`;
}
