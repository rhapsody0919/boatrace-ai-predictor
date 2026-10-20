import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { buildImageDimensions } from './scripts/lib/blogImageDimensions.js'

// 開発サーバーにはVercelのEdge Function(api/)が無く、/api/*がindex.htmlを返してJSON解析に
// 失敗し、フロントが本番では使われないフォールバック(Supabase直接クエリ)へ落ちていた。
// そのままだとローカル・e2eが本番と別の経路を通り、RPCとフォールバックの差分(BOA-304の
// weather等)を検知できず、重い直接クエリでe2eもタイムアウトしやすい(BOA-355)。
// 読み取り専用のAPIだけ本番へ転送し、開発・e2eも本番と同じ経路にする。
// admin/cron/sns-hub等の書き込み系は転送しない。未適用のapi/やRPCの変更を試す場合は
// API_PROXY_TARGET= (空文字)でプロキシを無効化する
const apiProxyTarget = process.env.API_PROXY_TARGET ?? 'https://www.boat-ai.jp'
const READ_ONLY_API = '^/api/(predictions|races|accuracy|race-history|outcome-distribution|analogy|odds)(/|$|\\?)'

// ブログ画像の実寸の表を、ビルド・開発サーバーの起動時に画像のヘッダーから作って画面へ渡す（BOA-908）。
// 記事の PR が寸法の表を直さずに済むように。読めない JPEG があればビルドを落とす（scripts/lib/blogImageDimensions.js）
const BLOG_IMAGE_DIMENSIONS_ID = 'virtual:blog-image-dimensions'
function blogImageDimensionsPlugin() {
  return {
    name: 'blog-image-dimensions',
    resolveId(id) {
      return id === BLOG_IMAGE_DIMENSIONS_ID ? '\0' + BLOG_IMAGE_DIMENSIONS_ID : undefined
    },
    load(id) {
      if (id !== '\0' + BLOG_IMAGE_DIMENSIONS_ID) return undefined
      const dims = buildImageDimensions('public/images/blog', '/images/blog/')
      return `export default ${JSON.stringify(dims)}`
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), blogImageDimensionsPlugin()],
  base: '/', // Vercel用（カスタムドメイン boat-ai.jp）
  build: {
    outDir: 'dist',
    // data/races.json を dist にコピー
    rollupOptions: {
      input: {
        main: './index.html'
      }
    }
  },
  publicDir: 'public',
  server: {
    proxy: apiProxyTarget
      ? { [READ_ONLY_API]: { target: apiProxyTarget, changeOrigin: true } }
      : undefined
  }
})
