import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useEffect } from 'react';
import App from './App';
import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import About from './pages/About';
import FAQ from './pages/FAQ';
import HowToUse from './pages/HowToUse';
import RaceHistory from './pages/RaceHistory';
import RaceDetail from './pages/RaceDetail';

// 旧ハッシュURLからのリダイレクトを処理するコンポーネント
function HashRedirect() {
  const location = useLocation();

  useEffect(() => {
    // ハッシュがある場合、対応するパスにリダイレクト
    if (location.hash) {
      const hash = location.hash.slice(1); // '#' を除去
      const validPaths = ['races', 'hit-races', 'accuracy', 'privacy', 'terms', 'contact'];
      if (validPaths.includes(hash)) {
        // ハッシュを削除してパスに変換
        const newPath = hash === 'races' ? '/' : `/${hash}`;
        window.history.replaceState(null, '', newPath);
        window.location.reload();
      }
    }
  }, [location]);

  return null;
}

export default function AppRouter() {
  return (
    <>
      <HashRedirect />
      <Routes>
        {/* Main App - 予想ページ（トップ） */}
        <Route path="/" element={<App tab="races" />} />

        {/* タブページ（SEO対応: 個別URL） */}
        <Route path="/hit-races" element={<App tab="hit-races" />} />
        <Route path="/accuracy" element={<App tab="accuracy" />} />
        <Route path="/privacy" element={<App tab="privacy" />} />
        <Route path="/terms" element={<App tab="terms" />} />
        <Route path="/contact" element={<App tab="contact" />} />

        {/* Race History Routes */}
        <Route path="/races" element={<RaceHistory />} />
        <Route path="/races/:date" element={<RaceDetail />} />

        {/* Blog Routes */}
        <Route path="/blog" element={<Blog />} />
        <Route path="/blog/:id" element={<BlogPost />} />

        {/* Other Pages */}
        <Route path="/about" element={<About />} />
        <Route path="/faq" element={<FAQ />} />
        <Route path="/how-to-use" element={<HowToUse />} />

        {/* Fallback: 不明なパスはトップへ */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </>
  );
}
