import { test, expect } from "./fixtures.js";

// ZB02 の試し（deploy-guard の戻しの道を通す）。PR の e2e（録画の再生、E2E_LIVE 無し）では緑、
// e2e-live（E2E_LIVE=1）でだけ落ちる。戻される前提の試験で、戻しの PR がこのファイルを消す
test("ZB02 の試し: E2E_LIVE=1 の e2e-live でだけ落ちる", () => {
  expect(process.env.E2E_LIVE).not.toBe("1");
});
