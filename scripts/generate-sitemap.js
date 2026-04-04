import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import matter from 'gray-matter';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const SITE_URL = 'https://www.boat-ai.jp';
const PUBLIC_DIR = path.join(__dirname, '../public');
const BLOG_DIR = path.join(PUBLIC_DIR, 'blog');

// 静的ページの定義
const staticPages = [
  {
    loc: '/',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'daily',
    priority: '1.0'
  },
  {
    loc: '/accuracy',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'daily',
    priority: '0.9'
  },
  {
    loc: '/hit-races',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'daily',
    priority: '0.9'
  },
  {
    loc: '/about',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'monthly',
    priority: '0.8'
  },
  {
    loc: '/faq',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'monthly',
    priority: '0.8'
  },
  {
    loc: '/how-to-use',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'monthly',
    priority: '0.9'
  },
  {
    loc: '/privacy',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'yearly',
    priority: '0.3'
  },
  {
    loc: '/terms',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'yearly',
    priority: '0.3'
  },
  {
    loc: '/contact',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'monthly',
    priority: '0.5'
  },
  {
    loc: '/blog',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'weekly',
    priority: '0.7'
  },
  {
    loc: '/races',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'daily',
    priority: '0.9'
  },
  {
    loc: '/picks',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'daily',
    priority: '0.9'
  },
  {
    loc: '/guide',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'monthly',
    priority: '0.8'
  },
  {
    loc: '/responsible-gambling',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'yearly',
    priority: '0.5'
  },
  {
    loc: '/profile',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'monthly',
    priority: '0.5'
  },
  {
    loc: '/accuracy/history',
    lastmod: new Date().toISOString().split('T')[0],
    changefreq: 'daily',
    priority: '0.8'
  }
];

// ブログ記事のスキャン
function getBlogPosts() {
  const blogPosts = [];

  if (!fs.existsSync(BLOG_DIR)) {
    console.warn('Blog directory not found:', BLOG_DIR);
    return blogPosts;
  }

  const files = fs.readdirSync(BLOG_DIR);

  files.forEach(file => {
    if (!file.endsWith('.md')) return;

    const filePath = path.join(BLOG_DIR, file);
    const content = fs.readFileSync(filePath, 'utf-8');
    const { data } = matter(content);

    const slug = file.replace('.md', '');
    const stats = fs.statSync(filePath);

    // frontmatterのdateフィールドまたはファイルの更新日時を使用
    let lastmod = data.date || data.publishedAt || stats.mtime;
    if (lastmod instanceof Date) {
      lastmod = lastmod.toISOString().split('T')[0];
    } else if (typeof lastmod === 'string') {
      lastmod = new Date(lastmod).toISOString().split('T')[0];
    } else {
      lastmod = new Date().toISOString().split('T')[0];
    }

    // 週次レポートは優先度を下げる
    const isWeeklyReport = slug.startsWith('weekly-report-');
    const priority = isWeeklyReport ? '0.5' : '0.6';

    blogPosts.push({
      loc: `/blog/${slug}`,
      lastmod,
      changefreq: 'monthly',
      priority
    });
  });

  return blogPosts;
}

// 過去のレースページをSupabaseから取得
async function getRacePages() {
  const racePages = [];

  // Supabase から全日付を取得
  try {
    const { supabase, isSupabaseEnabled } = await import('./lib/supabaseClient.js');
    if (!isSupabaseEnabled()) {
      console.warn('⚠️ Supabase未設定のため、レースページはスキップします');
      return racePages;
    }

    // race_date をページネーションで全件取得し、重複除去
    const allDates = [];
    let from = 0;
    const pageSize = 1000;
    while (true) {
      const { data, error: pageError } = await supabase
        .from('races')
        .select('race_date')
        .order('race_date', { ascending: false })
        .range(from, from + pageSize - 1);
      if (pageError) throw new Error(pageError.message);
      if (!data || data.length === 0) break;
      allDates.push(...data.map(r => r.race_date));
      if (data.length < pageSize) break;
      from += pageSize;
    }

    const uniqueDates = [...new Set(allDates)];
    const now = new Date();

    for (const dateStr of uniqueDates) {
      const fileDate = new Date(dateStr);
      const daysDiff = (now - fileDate) / (1000 * 60 * 60 * 24);

      // 古いデータほど優先度を下げる
      const priority = daysDiff <= 7 ? '0.8' : daysDiff <= 30 ? '0.7' : '0.5';
      racePages.push({
        loc: `/races/${dateStr}`,
        lastmod: dateStr,
        changefreq: 'weekly',
        priority
      });
    }

    console.log(`📊 Supabase から ${uniqueDates.length} 日分のレースデータを取得`);
  } catch (err) {
    console.error('レースページ取得エラー:', err.message);
  }

  return racePages;
}

// sitemap.xmlの生成
async function generateSitemap() {
  const blogPosts = getBlogPosts();
  const racePages = await getRacePages();
  const allPages = [...staticPages, ...blogPosts, ...racePages];

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';

  allPages.forEach(page => {
    xml += '  <url>\n';
    xml += `    <loc>${SITE_URL}${page.loc}</loc>\n`;
    xml += `    <lastmod>${page.lastmod}</lastmod>\n`;
    xml += `    <changefreq>${page.changefreq}</changefreq>\n`;
    xml += `    <priority>${page.priority}</priority>\n`;
    xml += '  </url>\n';
  });

  xml += '</urlset>\n';

  return xml;
}

// メイン処理
async function main() {
  try {
    console.log('Generating sitemap.xml...');

    const sitemap = await generateSitemap();
    const sitemapPath = path.join(PUBLIC_DIR, 'sitemap.xml');

    fs.writeFileSync(sitemapPath, sitemap, 'utf-8');

    // URL数をカウント
    const urlCount = sitemap.split('<url>').length - 1;
    console.log(`✅ Sitemap generated: ${sitemapPath} (${urlCount} URLs)`);

  } catch (error) {
    console.error('❌ Error generating sitemap:', error);
    process.exit(1);
  }
}

main();
