/** SNSリスクルールの部分一致判定（Node・Edge共通の純粋関数）。 */

/**
 * ルール順・patternsの最初の一致を維持する。platform未指定時は全ルールを適用。
 * @param {string|Array<{text:string,field:string}>} text 照合対象（欄の境界を保持）
 * @param {string} platform 対象プラットフォーム（省略可）
 * @param {Array<object>} rules 読み込み済みルール
 * @returns {Array<{id: string, category: string, description: string, matchedPattern: string}>} 検出結果
 */
export function matchRiskRules(text, platform, rules, field = 'body') {
  const fields = Array.isArray(text) ? text : [{text,field}];
  const violations = [];
  for (const rule of rules) {
    if (rule.platforms !== 'all' && platform &&
      !(Array.isArray(rule.platforms) && rule.platforms.includes(platform))) continue;
    const normalized = fields.map(({text: value, field: location}) => {
      let content = value || '';
      const exception = rule.hashtag_exception;
      if (exception?.enabled === true && exception.fields?.[platform]?.includes(location)) {
        // タグ欄は独立トークンだけ。本文はYouTube説明の末尾タグ群だけ。
        const mask = tags => tags.split(/(\s+)/u).map(tag => tag === exception.value ? '' : tag).join('');
        if (location === 'hashtags' && content === exception.value) content = '';
        else if (location === 'description') content = content.replace(/(?:^|\s)(?:#[\p{L}\p{N}_]+\s*)+$/u, mask);
      }
      return content.replace(/[Ａ-Ｚａ-ｚ０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xfee0)).replace(/[ \u3000]/gu, '');
    });
    const matchedPattern = rule.patterns.find(p => normalized.some(value => value.includes(p)));
    if (matchedPattern) violations.push({id:rule.id,category:rule.category,description:rule.description,matchedPattern});
  }
  return violations;
}

/** 文脈は送信先の確定した欄から指定する。ナレーション・sceneは常に本文。 */
export function draftRiskFields(draft) {
  const bundle = draft.source_data?.bundle;
  return [
    {text:draft.title,field:'body'},
    {text:draft.caption_text,field:draft.platform === 'youtube' && !bundle ? 'description' : 'body'},
    ...(draft.hashtags || []).map(text=>({text,field:'hashtags'})),
    ...bundleRiskFields(bundle || {}, draft.platform),
  ];
}
export function bundleRiskFields(bundle, platform) {
  return [
    {text:bundle.title,field:'body'},
    ...(bundle.scenes || []).flatMap(scene=>(scene.lines || []).map(text=>({text,field:'body'}))),
    {text:platform === 'x' ? bundle.x_text : bundle.script,field:'body'},
    ...(platform === 'x' ? bundle.x_hashtags || [] : bundle.youtube_tags || []).map(text=>({text,field:'hashtags'})),
    ...(platform === 'youtube' ? [{text:bundle.youtube_description,field:'description'}] : []),
  ];
}
