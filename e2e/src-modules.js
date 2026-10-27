/**
 * src/ のモジュールをテストの側（Node）で読む。
 *
 * 以前は `page.evaluate(() => import("/src/utils/share.js"))` でブラウザから生のソースを読んでいたが、
 * それは vite の開発サーバーだけが配る。build した束を `vite preview` で配って e2e を流すと 404 になり、
 * 4つの spec が通らなかった（#1319、docs/design/ci-minutes-reduction/design.md 4.2 A）。
 * Vite の SSR の読み込み（ssrLoadModule）を使うので、拡張子の無い import・import.meta.glob・
 * import.meta.env は開発サーバーと同じに解ける。ワーカーごとに1つだけ作り、ポートは開かない。
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let serverPromise = null;

function viteServer() {
  // Supabase のクライアントは import.meta.env の宛先が無いと作られない（null）。テストの側で読むモジュールは
  // ネットワークに出さない（spec が fetch を差し替える）ので、宛先が無い手元では置き場の値を入れる
  process.env.VITE_SUPABASE_URL ||= "https://e2e-node.invalid";
  process.env.VITE_SUPABASE_ANON_KEY ||= "e2e-node";
  serverPromise ??= import("vite").then(({ createServer }) =>
    createServer({
      root: ROOT,
      logLevel: "error",
      appType: "custom",
      server: { middlewareMode: true, hmr: false, watch: null },
      optimizeDeps: { noDiscovery: true, include: [] },
    }),
  );
  return serverPromise;
}

/** `/src/...` のモジュールを読む（例: `await loadSrc("/src/utils/share.js")`） */
export async function loadSrc(modulePath) {
  if (!modulePath.startsWith("/src/"))
    throw new Error(`loadSrc は /src/ のモジュールだけを読む: ${modulePath}`);
  const server = await viteServer();
  return server.ssrLoadModule(modulePath);
}

/**
 * 画面と同じ翻訳の t（src/i18n.js は document を触るので Node では読めない）。
 * 設定は src/i18n.js の init と同じ（名前空間 common、エスケープしない）
 */
export async function srcFixedT(lng) {
  const { default: i18next } = await import("i18next");
  const resources = JSON.parse(
    readFileSync(path.join(ROOT, `src/locales/${lng}/common.json`), "utf8"),
  );
  const instance = i18next.createInstance();
  await instance.init({
    lng,
    resources: { [lng]: { common: resources } },
    defaultNS: "common",
    ns: ["common"],
    interpolation: { escapeValue: false },
  });
  return instance.getFixedT(lng);
}

/** src/ の CSS の中身（`page.addStyleTag({ content })` で当てる） */
export function srcCss(cssPath) {
  if (!/^\/src\/.+\.css$/.test(cssPath))
    throw new Error(`srcCss は /src/ の .css だけを読む: ${cssPath}`);
  return readFileSync(path.join(ROOT, cssPath), "utf8");
}

/** ワーカーの終わりに閉じる（開いたままだと Playwright のワーカーが終わらない） */
export async function closeSrcLoader() {
  if (!serverPromise) return;
  const server = await serverPromise;
  serverPromise = null;
  await server.close();
}
