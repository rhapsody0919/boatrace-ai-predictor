import { useState, useEffect, useRef } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import './Header.css'

function Header() {
  const location = useLocation()
  const navigate = useNavigate()
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isCompressed, setIsCompressed] = useState(false)
  const menuRef = useRef(null)

  // 現在のページ/タブを判定
  const getActiveTab = () => {
    if (location.pathname === '/') {
      // ホームページの場合はハッシュを確認
      const hash = location.hash.slice(1)
      return hash || 'races'
    }
    // その他のページ
    if (location.pathname === '/hit-races') return 'hit-races'
    if (location.pathname === '/accuracy') return 'accuracy'
    if (location.pathname === '/outcome-distribution') return 'outcome-distribution'
    if (location.pathname === '/picks') return 'picks'
    if (location.pathname.startsWith('/races')) return 'past-races'
    if (location.pathname === '/how-to-use') return 'how-to-use'
    if (location.pathname === '/guide') return 'guide'
    if (location.pathname.startsWith('/blog')) return 'blog'
    if (location.pathname === '/faq') return 'faq'
    if (location.pathname === '/about') return 'about'
    if (location.pathname === '/profile') return 'profile'
    return 'races'
  }

  const activeTab = getActiveTab()

  // メニュー外クリック検出
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        setIsMenuOpen(false)
      }
    }

    if (isMenuOpen) {
      document.addEventListener('click', handleClickOutside)
      return () => document.removeEventListener('click', handleClickOutside)
    }
  }, [isMenuOpen])

  // スクロール検出：デスクトップのみ圧縮
  useEffect(() => {
    const handleScroll = () => {
      const isMobile = window.innerWidth <= 768
      if (isMobile) {
        setIsCompressed(false)
        return
      }
      const currentScrollY = window.scrollY
      setIsCompressed(currentScrollY > 100) // 100px以上スクロールで圧縮
    }

    window.addEventListener('scroll', handleScroll, { passive: true })
    return () => window.removeEventListener('scroll', handleScroll)
  }, [])

  // ロゴクリック時の処理
  const handleLogoClick = () => {
    navigate('/')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  // タブクリック時の処理（パスベースナビゲーション）
  const handleTabClick = (tab) => {
    const path = tab === 'races' ? '/' : `/${tab}`
    navigate(path)
  }

  return (
    <header className={`app-header ${isCompressed ? 'compressed' : ''}`}>
      <div className="header-content" ref={menuRef}>
        <button className="logo" onClick={handleLogoClick} aria-label="BoatAI トップページへ">
          <span className="logo-icon">🚤</span>
          <h1>BoatAI</h1>
        </button>
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
            className="nav-btn menu-btn"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            aria-label="その他のメニュー"
            aria-expanded={isMenuOpen}
          >
            ☰
          </button>
        </nav>
        {/* サブメニュー - navの外に配置してoverflowの影響を受けないようにする */}
        {isMenuOpen && <div className="menu-overlay" onClick={() => setIsMenuOpen(false)} />}
        {isMenuOpen && (
          <div className="submenu">
            <button
              className={`submenu-item submenu-item-button ${activeTab === 'races' ? 'active' : ''}`}
              onClick={() => { handleTabClick('races'); setIsMenuOpen(false) }}
            >
              🏁 予想
            </button>
            <button
              className={`submenu-item submenu-item-button ${activeTab === 'hit-races' ? 'active' : ''}`}
              onClick={() => { handleTabClick('hit-races'); setIsMenuOpen(false) }}
            >
              ✅ 的中
            </button>
            <Link
              to="/accuracy"
              className={`submenu-item ${activeTab === 'accuracy' ? 'active' : ''}`}
              onClick={() => setIsMenuOpen(false)}
            >
              📈 精度分析
            </Link>
            <Link
              to="/outcome-distribution"
              className={`submenu-item ${activeTab === 'outcome-distribution' ? 'active' : ''}`}
              onClick={() => setIsMenuOpen(false)}
            >
              📊 出目分布分析
            </Link>
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
              to="/guide"
              className={`submenu-item ${activeTab === 'guide' ? 'active' : ''}`}
              onClick={() => setIsMenuOpen(false)}
            >
              📖 完全ガイド
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
            <Link
              to="/profile"
              className={`submenu-item ${activeTab === 'profile' ? 'active' : ''}`}
              onClick={() => setIsMenuOpen(false)}
            >
              👤 運営者プロフィール
            </Link>
          </div>
        )}
      </div>
    </header>
  )
}

export default Header
