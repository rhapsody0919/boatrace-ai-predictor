/** 投稿用の値だけ。署名URL・状態変更は本文差分に含めない。 */
export function draftContent(d) {
  const source = {...(d.source_data || {})};
  delete source.dataCardUrl;
  return {title:d.title ?? null, caption_text:d.caption_text ?? null, hashtags:d.hashtags ?? null,
    source_data:source, video_storage_path:d.video_storage_path ?? null, cover_image_path:d.cover_image_path ?? null};
}

/** Unicodeコードポイント単位。長文は共通の前後を残して変更範囲を表示し、二乗メモリを避ける。 */
export function characterDiff(before, after) {
  const a=Array.from(before || ''), b=Array.from(after || '');
  let start=0, end=0;
  while(start<a.length && start<b.length && a[start]===b[start]) start++;
  while(end<a.length-start && end<b.length-start && a[a.length-1-end]===b[b.length-1-end]) end++;
  const x=a.slice(start,a.length-end), y=b.slice(start,b.length-end), parts=[];
  const add=(kind,text)=>{if(!text)return; const last=parts.at(-1); if(last?.kind===kind)last.text+=text;else parts.push({kind,text});};
  add('same',a.slice(0,start).join(''));
  if(x.length*y.length>1000000) {add('removed',x.join(''));add('added',y.join(''));}
  else {
    const table=Array.from({length:x.length+1},()=>new Uint32Array(y.length+1));
    for(let i=x.length-1;i>=0;i--) for(let j=y.length-1;j>=0;j--) table[i][j]=x[i]===y[j]?1+table[i+1][j+1]:Math.max(table[i+1][j],table[i][j+1]);
    let i=0,j=0;
    while(i<x.length || j<y.length) {
      if(i<x.length && j<y.length && x[i]===y[j]) {add('same',x[i++]);j++;}
      else if(i<x.length && (j===y.length || table[i+1][j]>=table[i][j+1])) add('removed',x[i++]);
      else add('added',y[j++]);
    }
  }
  add('same',end?a.slice(a.length-end).join(''):'');
  return parts;
}
export function numericDiff(before, after, path='') {
  if(typeof before==='number' || typeof after==='number') return Object.is(before,after)?[]:[{path:path || '/',before,after}];
  const keys=new Set([...Object.keys(before && typeof before==='object'?before:{}),...Object.keys(after && typeof after==='object'?after:{})]);
  return [...keys].sort().flatMap(k=>numericDiff(before?.[k],after?.[k],`${path}/${k.replaceAll('~','~0').replaceAll('/','~1')}`));
}
export function compareDraftSnapshots(before, after) {
  const a=before.content,b=after.content;
  const text=[['title','タイトル',a.title,b.title],['caption_text','本文・説明文',a.caption_text,b.caption_text],
    ['hashtags','ハッシュタグ',a.hashtags?.join(' '),b.hashtags?.join(' ')],
    ['description','説明文',a.source_data?.bundle?.youtube_description,b.source_data?.bundle?.youtube_description],
    ['script','台本',a.source_data?.bundle?.script,b.source_data?.bundle?.script]]
    .filter(([, ,x,y])=>(x || '')!==(y || ''))
    .map(([key,label,x,y])=>({key,label,parts:characterDiff(x,y)}));
  const media=['video','cover','dataCard'].map(key=>{
    const pathKey={video:'video_storage_path',cover:'cover_image_path'}[key];
    const oldPath=pathKey?a[pathKey]:a.source_data?.dataCardPath;
    const newPath=pathKey?b[pathKey]:b.source_data?.dataCardPath;
    const x=before.media?.[key] || (oldPath?{path:oldPath,sha256:null}:null),y=after.media?.[key] || (newPath?{path:newPath,sha256:null}:null);
    let state;
    if(!x && !y) state='same';
    else if(!x) state='added';
    else if(!y) state='removed';
    else if(!x.sha256 || !y.sha256) state='unknown';
    else state=x.sha256===y.sha256?'same':'replaced';
    return {key,before:x,after:y,state};
  }).filter(m=>m.state!=='same');
  return {text,media,numbers:numericDiff(a.source_data,b.source_data)};
}
