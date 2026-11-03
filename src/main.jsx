import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/design-tokens.css'
import './index.css'
import './styles/indicators.css'
import './i18n'
import AppRouter from './AppRouter.jsx'
import { initTrackingIfConsented } from './utils/analytics'

// 完全版 f01 の撮影用の頁（docs/design/f01-stable-capture/）。ビルドの旗 VITE_SNS_CAPTURE=1 のときだけ
// （f01-capture.mjs がローカルの dev サーバーに付ける）。旗の無い本番のビルドでは、この分岐と頁のコードが消える
const snsCapture =
  import.meta.env.VITE_SNS_CAPTURE === '1' && window.location.pathname.startsWith('/sns-capture/')

if (snsCapture) {
  const F01Capture = lazy(() => import('./snsCapture/F01Capture.jsx'))
  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <Suspense fallback={null}>
        <F01Capture />
      </Suspense>
    </StrictMode>,
  )
} else {
  // 同意済みの場合のみGA+AdSenseを初期化
  initTrackingIfConsented();

  createRoot(document.getElementById('root')).render(
    <StrictMode>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </StrictMode>,
  )
}
