/**
 * データ取得サービス
 *
 * DB移行に備えて、データ取得ロジックを抽象化します。
 * 現在はJSONファイルから取得し、将来的にはAPI経由で取得できるようにします。
 */

// データ取得モード: 'json' or 'api'
const API_MODE = import.meta.env.VITE_API_MODE || 'json';
const API_URL = import.meta.env.VITE_API_URL || '';
const BASE_URL = import.meta.env.BASE_URL || '';

/**
 * リトライ機能付きfetch関数
 */
const fetchWithRetry = async (url, maxRetries = 3, retryDelay = 2000) => {
  let lastError;

  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      return response;
    } catch (error) {
      lastError = error;
      console.warn(`取得失敗 (${i + 1}/${maxRetries}):`, error.message);

      // 最後の試行でなければ待機してリトライ
      if (i < maxRetries - 1) {
        await new Promise(resolve => setTimeout(resolve, retryDelay));
      }
    }
  }

  throw lastError;
};

/**
 * データサービス
 */
export const dataService = {
  /**
   * レースデータを取得
   */
  async getRaces() {
    if (API_MODE === 'api') {
      // 将来: API経由で取得
      const response = await fetchWithRetry(`${API_URL}/api/races`);
      return response.json();
    } else {
      // 現在: JSONファイルから取得
      const response = await fetchWithRetry(BASE_URL + 'data/races.json');
      return response.json();
    }
  },

  /**
   * 予想データを取得
   * @param {string} date - 日付文字列（YYYY-MM-DD形式）
   */
  async getPredictions(date) {
    if (API_MODE === 'api') {
      // 将来: API経由で取得
      const response = await fetchWithRetry(`${API_URL}/api/predictions?date=${date}`);
      return response.json();
    } else {
      // 現在: JSONファイルから取得
      const response = await fetchWithRetry(BASE_URL + `data/predictions/${date}.json`, 2, 1000);
      return response.json();
    }
  },

  /**
   * 精度統計データを取得
   */
  async getAccuracy() {
    if (API_MODE === 'api') {
      // 将来: API経由で取得
      const response = await fetchWithRetry(`${API_URL}/api/accuracy`);
      return response.json();
    } else {
      // 現在: JSONファイルから取得
      const response = await fetchWithRetry(BASE_URL + 'data/predictions/summary.json');
      return response.json();
    }
  },

  /**
   * fetchWithRetry関数を外部に公開（後方互換性のため）
   */
  fetchWithRetry
};
