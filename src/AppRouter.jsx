import { Routes, Route } from 'react-router-dom';
import App from './App';
import Blog from './pages/Blog';
import BlogPost from './pages/BlogPost';
import About from './pages/About';
import FAQ from './pages/FAQ';

export default function AppRouter() {
  return (
    <Routes>
      {/* Main App (with tabs) */}
      <Route path="/" element={<App />} />

      {/* Blog Routes */}
      <Route path="/blog" element={<Blog />} />
      <Route path="/blog/:id" element={<BlogPost />} />

      {/* Other Pages */}
      <Route path="/about" element={<About />} />
      <Route path="/faq" element={<FAQ />} />

      {/* Fallback to main app */}
      <Route path="*" element={<App />} />
    </Routes>
  );
}
