// 会場コードからブログ記事IDへのマッピング
export const VENUE_CODE_TO_BLOG_ID = {
  1: 'kiryu',
  2: 'toda',
  3: 'edogawa',
  4: 'heiwajima',
  5: 'tamagawa',
  6: 'hamanako',
  7: 'gamagori',
  8: 'tokoname',
  9: 'tsu',
  10: 'mikuni',
  11: 'biwako',
  12: 'suminoe',
  13: 'amagasaki',
  14: 'naruto',
  15: 'marugame',
  16: 'kojima',
  17: 'miyajima',
  18: 'tokuyama',
  19: 'shimonoseki',
  20: 'wakamatsu',
  21: 'ashiya',
  22: 'fukuoka',
  23: 'karatsu',
  24: 'omura'
};

// 会場コード→ブログID変換
export const getVenueBlogId = (venueCode) => {
  const code = parseInt(venueCode, 10);
  return VENUE_CODE_TO_BLOG_ID[code] || null;
};

// 会場攻略ガイドのブログ記事パスを生成
export const getVenueGuidePath = (venueCode) => {
  const blogId = getVenueBlogId(venueCode);
  if (!blogId) return null;
  return `/blog/venue-${blogId}`;
};
