import { Routes, Route } from 'react-router-dom';
import App from './App';
import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import About from './pages/About';
import FAQ from './pages/FAQ';
import HowToUse from './pages/HowToUse';
import RaceHistory from './pages/RaceHistory';
import RaceDetail from './pages/RaceDetail';

export default function AppRouter() {
  return (
    <Routes>
      {/* Main App (with tabs) */}
      <Route path="/" element={<App />} />

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

      {/* Fallback to main app */}
      <Route path="*" element={<App />} />
    </Routes>
  );
}
