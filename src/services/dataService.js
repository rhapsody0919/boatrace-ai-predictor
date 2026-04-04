/**
 * データ取得サービス
 *
 * Supabaseからデータを取得します。
 */

import { supabaseDataService, clearCache } from './supabaseDataService';

// 起動時にログ出力
console.log('📊 データソース: Supabase (30分キャッシュ有効)');

/**
 * データサービス
 */
export const dataService = {
  /**
   * レースデータを取得
   */
  async getRaces() {
    return supabaseDataService.getRaces();
  },

  /**
   * 予想データを取得
   * @param {string} date - 日付文字列（YYYY-MM-DD形式）
   */
  async getPredictions(date) {
    return supabaseDataService.getPredictions(date);
  },

  /**
   * 精度統計データを取得
   */
  async getAccuracy() {
    return supabaseDataService.getAccuracy();
  },

  /**
   * 予想データが存在する日付リストを取得
   * @param {number} days - 過去何日分を取得するか
   */
  async getAvailableDates(days = 90) {
    return supabaseDataService.getAvailableDates(days);
  },

  /**
   * レース履歴サマリーを取得（日付ごとのモデル別的中統計）
   * @param {number} days - 過去何日分を取得するか
   */
  async getRaceHistorySummary(days = 90) {
    return supabaseDataService.getRaceHistorySummary(days);
  },

  /**
   * キャッシュをクリア（手動更新時に使用）
   * @param {string|null} key - 特定のキーをクリア（nullで全クリア）
   */
  clearCache(key = null) {
    clearCache(key);
  }
};
