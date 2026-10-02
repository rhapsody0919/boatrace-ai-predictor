import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './styles/design-tokens.css'
import './index.css'
import './styles/indicators.css'
import './i18n'
import AppRouter from './AppRouter.jsx'
import { initTrackingIfConsented } from './utils/analytics'

// 同意済みの場合のみGA+AdSenseを初期化
initTrackingIfConsented();

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AppRouter />
    </BrowserRouter>
  </StrictMode>,
)
