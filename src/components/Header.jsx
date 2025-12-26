import { useState, useEffect } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import './Header.css'

function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isMenuOpen, setIsMenuOpen] = useState(false)

  // 現在のページ/タブを判定
  const getActiveTab = () => {
    if (location.pathname === '/') {
      // ホームページの場合はハッシュを確認
      const hash = location.hash.slice(1)
      return hash || 'races'
    }
    // その他のページ
    if (location.pathname.startsWith('/races')) return 'past-races'
    if (location.pathname === '/how-to-use') return 'how-to-use'
    if (location.pathname.startsWith('/blog')) return 'blog'
    if (location.pathname === '/faq') return 'faq'
    if (location.pathname === '/about') return 'about'
    return 'races'
  }

  const activeTab = getActiveTab()

  // メニュー外クリックで閉じる
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (isMenuOpen && !event.target.closest('.menu-container')) {
        setIsMenuOpen(false)
      }
    }

    document.addEventListener('click', handleClickOutside)
    return () => document.removeEventListener('click', handleClickOutside)
  }, [isMenuOpen])

  // ロゴクリック時の処理
  const handleLogoClick = () => {
    navigate('/#races')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // タブクリック時の処理（ホームページのハッシュナビゲーション）
  const handleTabClick = (tab) => {
    navigate(`/#${tab}`)
  }

  return (
    <header className="app-header">
      <div className="header-content">
        <div className="logo" onClick={handleLogoClick}>
          <span className="logo-icon">🚤</span>
          <h1>BoatAI</h1>
        </div>
        <nav className="nav">
          <button
            className={`nav-btn ${activeTab === 'races' ? 'active' : ''}`}
            onClick={() => handleTabClick('races')}
          >
            🏁 予想
          </button>
          <button
            className={`nav-btn ${activeTab === 'hit-races' ? 'active' : ''}`}
            onClick={() => handleTabClick('hit-races')}
          >
            ✅ 的中
          </button>
          <button
            className={`nav-btn ${activeTab === 'accuracy' ? 'active' : ''}`}
            onClick={() => handleTabClick('accuracy')}
          >
            📊 成績
          </button>
          <div className="menu-container">
            <button
              className="nav-btn menu-btn"
              onClick={() => setIsMenuOpen(!isMenuOpen)}
            >
              ⋮
            </button>
            {isMenuOpen && (
              <div className="submenu">
                <Link
                  to="/races"
                  className={`submenu-item ${activeTab === 'past-races' ? 'active' : ''}`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  📅 過去の予想
                </Link>
                <Link
                  to="/how-to-use"
                  className={`submenu-item ${activeTab === 'how-to-use' ? 'active' : ''}`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  📚 使い方
                </Link>
                <Link
                  to="/blog"
                  className={`submenu-item ${activeTab === 'blog' ? 'active' : ''}`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  📝 ブログ
                </Link>
                <Link
                  to="/faq"
                  className={`submenu-item ${activeTab === 'faq' ? 'active' : ''}`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  ❓ よくある質問
                </Link>
                <Link
                  to="/about"
                  className={`submenu-item ${activeTab === 'about' ? 'active' : ''}`}
                  onClick={() => setIsMenuOpen(false)}
                >
                  ℹ️ サービスについて
                </Link>
              </div>
            )}
          </div>
        </nav>
      </div>
    </header>
  )
}

export default Header
