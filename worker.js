const VENUES = {
  "11":"函館","12":"青森","13":"いわき平","21":"弥彦","22":"前橋","23":"取手","24":"宇都宮","25":"大宮","26":"西武園","27":"京王閣","28":"立川",
  "31":"松戸","32":"千葉","34":"川崎","35":"平塚","36":"小田原","37":"伊東温泉","38":"静岡","42":"名古屋","43":"岐阜","44":"大垣","45":"豊橋","46":"富山","47":"松阪","48":"四日市",
  "51":"福井","53":"奈良","54":"向日町","55":"和歌山","56":"岸和田","61":"玉野","62":"広島","63":"防府","71":"高松","73":"小松島","74":"高知","75":"松山","81":"小倉","83":"久留米","84":"武雄","85":"佐世保","86":"別府","87":"熊本"
};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const txt=x=>String(x||'').replace(/\s+/g,' ').trim();
class BodyText { constructor(){this.value=''} text(t){this.value+=t.text+' '} }
class LinkCapture {
  constructor(){this.links=[];this.current=null}
  a={
    element:(el)=>{
      const item={href:el.getAttribute('href')||'',v:''};
      this.links.push(item);this.current=item;
      el.onEndTag(()=>{item.v=txt(item.v);if(this.current===item)this.current=null});
    },
    text:(t)=>{if(this.current)this.current.v+=t.text+' '}
  }
}
class RowCapture {
  constructor(rows){this.rows=rows;this.current=null}
  tr={ element:(el)=>{this.current=[];el.onEndTag(()=>{if(this.current&&this.current.length)this.rows.push(this.current);this.current=null})} }
  td={ element:(el)=>{if(!this.current)return;const cell={v:''};this.current.push(cell);el.onEndTag(()=>{cell.v=txt(cell.v)})}, text:(t)=>{if(this.current&&this.current.length)this.current[this.current.length-1].v+=t.text+' '} }
}
function parseRiders(rows){
  const out=[];
  for(const row of rows){
    const c=row.map(x=>txt(x.v));
    let si=-1;
    for(let i=0;i<c.length-1;i++){
      const score=parseFloat(c[i]);
      if(/^\d{2,3}\.\d{1,2}$/.test(c[i])&&score>=50&&score<=150&&/^\d*\s*[逃追両]$/.test(c[i+1]||'')){si=i;break}
    }
    if(si<1)continue;
    const styleMatch=(c[si+1]||'').match(/[逃追両]/);
    if(!styleMatch)continue;
    const st=styleMatch[0];

    // netkeirinの先頭2列は『枠番, 車番』。6・7車は同じ枠になるため車番は2列目を優先。
    let car=/^[1-9]$/.test(c[1]||'')?+c[1]:0;
    if(!car){for(let i=0;i<si;i++){if(/^[1-9]$/.test(c[i])){car=+c[i];break}}}
    if(!car)continue;

    let name=txt(c[si-1]||'').replace(/^[ァ-ヶー・\s]+/,'').trim();
    if(!name||name.length>30)name='車番'+car;

    const n=(idx)=>{const m=String(c[idx]||'').match(/-?\d+(?:\.\d+)?/);return m?+m[0]:0};
    const pct=(idx)=>{const v=parseFloat(String(c[idx]||'').replace('%',''));return Number.isFinite(v)?v:0};

    // Current netkeirin order after 競走得点:
    // 脚質, S, H, B, 逃げ, まくり, 差し, マーク, 1着, 2着, 3着, 着外, 勝率, 2連対率, 3連対率
    const s=n(si+2),h=n(si+3),b=n(si+4);
    const escape=n(si+5),makuri=n(si+6);
    let win=pct(si+13),top2=pct(si+14),top3=pct(si+15);

    // Fallback if the source adds/removes a non-data cell.
    if(!/%$/.test(c[si+13]||'')||!/%$/.test(c[si+14]||'')||!/%$/.test(c[si+15]||'')){
      const pcts=c.slice(si+2).filter(v=>/^\d+(?:\.\d+)?%$/.test(v)).slice(0,3).map(v=>parseFloat(v));
      if(pcts.length<3)continue;
      [win,top2,top3]=pcts;
    }
    const comment=txt(c[si+17]||c[c.length-1]||'');
    out.push({num:car,name,score:parseFloat(c[si]),style:st,s,h,b,escape,makuri,win,top2,top3,comment});
  }
  const dedup=new Map();for(const x of out){if(!dedup.has(x.num))dedup.set(x.num,x)}
  return [...dedup.values()].sort((a,b)=>a.num-b.num);
}
async function fetchHtml(url){
  const r=await fetch(url,{headers:{"user-agent":"Mozilla/5.0 (compatible; KeirinAI/2.1)","accept-language":"ja,en;q=0.7"},cf:{cacheTtl:60,cacheEverything:true}});
  if(!r.ok)throw new Error('source '+r.status);return r;
}
async function apiToday(url){
  const d=url.searchParams.get('date');if(!/^\d{8}$/.test(d||''))return json({error:'date required'},400);
  const r=await fetchHtml('https://keirin.netkeiba.com/race/race_calendar/');
  const h=new BodyText();await new HTMLRewriter().on('body',h).transform(r).text();
  const all=txt(h.value),mm=+d.slice(4,6),dd=+d.slice(6,8),token=`${mm}/${dd}`;
  const nextDate=new Date(Date.UTC(+d.slice(0,4),mm-1,dd+1)),nt=`${nextDate.getUTCMonth()+1}/${nextDate.getUTCDate()}`;
  let section=all;const a=all.indexOf(token);if(a>=0){const b=all.indexOf(nt,a+token.length);section=all.slice(a,b>0?b:a+2500)}
  let venues=[];for(const [code,name] of Object.entries(VENUES)){if(section.includes(name))venues.push({code,name})}
  if(!venues.length){
    const hr=await fetchHtml('https://keirin.netkeiba.com/');const bh=new BodyText();await new HTMLRewriter().on('body',bh).transform(hr).text();
    const s=txt(bh.value),p=s.indexOf('本日の競輪開催'),q=s.indexOf('競輪レースメニュー',p+1),sec=p>=0?s.slice(p,q>p?q:p+1200):s;
    for(const [code,name] of Object.entries(VENUES)){if(sec.includes(name))venues.push({code,name})}
  }
  return json({date:d,venues});
}
function parseLineText(bodyText,riders){
  const all=txt(bodyText),marker='並び予想',a=all.indexOf(marker);
  if(a<0)return '';
  const sec=all.slice(a+marker.length,a+marker.length+900);
  const valid=new Set(riders.map(x=>x.num));
  const order=[];
  // 並び予想部分は「6 鈴木豪 1 宇佐見 ...」のように車番→選手名の順で抽出される。
  for(const m of sec.matchAll(/(?:^|\s)([1-9])\s*(?=[ァ-ヶ一-龯々])/gu)){
    const n=+m[1]; if(valid.has(n)&&!order.includes(n))order.push(n);
    if(order.length===riders.length)break;
  }
  if(order.length!==riders.length)return '';

  // HTMLの空白だけではライン境界が失われるため、選手コメントから先頭車を安全側に判定。
  // 「自力」「前で」「先行」「自在」等を明示した車だけをライン先頭候補にする。
  const byNum=new Map(riders.map(x=>[x.num,x]));
  const leaders=new Set(riders.filter(x=>{
    const c=String(x.comment||'');
    return /(自力|前で|先行|自在|頑張|何でも|自分で)/.test(c) && !/(君|さん|任せ|マーク|番手|後ろ|勢)/.test(c);
  }).map(x=>x.num));
  if(leaders.size<2)return '';

  const groups=[]; let g=[];
  for(const n of order){
    if(g.length && leaders.has(n)){groups.push(g);g=[]}
    g.push(n);
  }
  if(g.length)groups.push(g);
  // 全車が一度ずつ入り、各グループが空でない時だけ採用。曖昧なら手入力に戻す。
  const flat=groups.flat();
  if(flat.length!==riders.length||new Set(flat).size!==riders.length)return '';
  return groups.map(x=>x.join('-')).join(' / ');
}

async function fetchLineText(id,riders){
  try{
    const src=`https://keirin.netkeiba.com/race/yoso/?race_id=${id}`;
    const r=await fetchHtml(src),body=new BodyText();
    await new HTMLRewriter().on('body',body).transform(r).text();
    return parseLineText(body.value,riders);
  }catch(_){return ''}
}

function parseRaceResult(bodyText){
  const all=txt(bodyText);
  if(!/(レースが確定しました|払戻金)/.test(all))return null;
  const finish=[];
  for(let pos=1;pos<=3;pos++){
    const m=all.match(new RegExp(pos+'着\\s+(?:[1-6]\\s+)?([1-9])(?:\\s|$)'));
    if(!m)return null;finish.push(+m[1]);
  }
  const sec=(all.split(/払戻金/)[1]||all).slice(0,2500);
  const m=sec.match(/(?:３|3)連単\s+([1-9])\s*[>＞]\s*([1-9])\s*[>＞]\s*([1-9])\s+([0-9,]+)円/);
  if(!m)return null;
  return {finish,trifecta:`${m[1]}-${m[2]}-${m[3]}`,payout:parseInt(m[4].replace(/,/g,''),10)};
}
async function apiRaceResult(url){
  const id=url.searchParams.get('race_id');if(!/^\d{12}$/.test(id||''))return json({error:'race_id required'},400);
  const src=`https://keirin.netkeiba.com/race/result/?race_id=${id}`;
  const r=await fetchHtml(src),body=new BodyText();await new HTMLRewriter().on('body',body).transform(r).text();
  const result=parseRaceResult(body.value);
  if(!result)return json({race_id:id,ready:false,message:'結果はまだ確定していません。',source:src});
  return json({race_id:id,ready:true,...result,source:src});
}

async function apiEntry(url){
  const id=url.searchParams.get('race_id');if(!/^\d{12}$/.test(id||''))return json({error:'race_id required'},400);
  const code=id.slice(8,10),race=+id.slice(10,12),src=`https://keirin.netkeiba.com/race/entry/?race_id=${id}`;
  const r=await fetchHtml(src),rows=[],cap=new RowCapture(rows);
  const transformed=new HTMLRewriter().on('tr',cap.tr).on('td',cap.td).transform(r);await transformed.text();
  const riders=parseRiders(rows);
  if(riders.length<5)return json({error:`出走表を解析できませんでした（${riders.length}車取得）。`,race_id:id,source:src},502);
  const lineText=await fetchLineText(id,riders);
  return json({race_id:id,track:VENUES[code]||code,race,riders,lineText,source:src});
}

const APP_HTML = "<!doctype html>\n<html lang=\"ja\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><meta name=\"theme-color\" content=\"#0b1220\"><title>競輪AI予想 V2</title>\n<style>\n:root{--bg:#09111d;--card:#121d2c;--card2:#17263a;--text:#f6f8fb;--muted:#91a3bc;--line:#2b3d57;--blue:#42b7ff;--green:#54d58c;--yellow:#ffd166;--red:#ff7070}\n*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#07101a,#0d1725 45%,#09111c);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Noto Sans JP\",sans-serif}.wrap{max-width:980px;margin:auto;padding:14px 12px 70px}h1{font-size:24px;margin:8px 0 3px}.sub,.muted{color:var(--muted)}.sub{font-size:12px;margin-bottom:12px}.card{background:rgba(18,29,44,.97);border:1px solid var(--line);border-radius:16px;padding:13px;margin:10px 0;box-shadow:0 10px 30px rgba(0,0,0,.16)}.row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}label{display:block;font-size:11px;color:var(--muted);margin:2px 0 5px}input,select,button{width:100%;padding:11px;border-radius:11px;border:1px solid var(--line);background:#0a1422;color:var(--text);font-size:15px}button{font-weight:800;background:#16314b;cursor:pointer}.primary{border:0;background:linear-gradient(135deg,#0878b9,#334fb8)}.good{background:#15482e;border-color:#26794f}.status{font-size:12px;margin-top:8px;min-height:18px}.ok{color:var(--green)}.err{color:var(--red)}.pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.pill{border:1px solid var(--line);border-radius:999px;padding:5px 8px;font-size:11px;color:#cbd7e7}.grid{overflow-x:auto}.rider{min-width:860px;display:grid;grid-template-columns:48px 1.6fr 86px 64px 64px 64px 52px 52px 52px 70px;gap:5px;margin:5px 0;align-items:center}.hdr{font-size:10px;color:var(--muted)}.num{text-align:center;font-weight:900;border-radius:9px;padding:10px 0}.n1{background:#fff;color:#111}.n2{background:#171717}.n3{background:#dc3f3f}.n4{background:#3864cc}.n5{background:#ebc439;color:#111}.n6{background:#4d9955}.n7{background:#e884ac;color:#111}.n8{background:#e88532}.n9{background:#7650a2}.scores{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.score{background:var(--card2);border-radius:12px;padding:11px}.score b{font-size:23px}.S{color:var(--red)}.A{color:var(--yellow)}.B{color:#81cfff}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px 5px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--muted)}.combo{font-size:17px;font-weight:900}.hidden{display:none}.footer{font-size:10px;line-height:1.6;color:#74859d;margin-top:14px}.badge{display:inline-block;padding:4px 7px;border-radius:7px;background:#263a55;font-size:11px}.source{font-size:11px;color:#8194ad;margin-top:6px}.statgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.historyItem{background:var(--card2);border-radius:12px;padding:10px;margin:7px 0}.hit{color:var(--green);font-weight:900}.miss{color:var(--muted);font-weight:900}.autoItem{background:var(--card2);border:1px solid var(--line);border-radius:12px;padding:11px;margin:8px 0}.autoHead{display:flex;justify-content:space-between;gap:8px;align-items:center}.autoGrade{font-weight:900}.autoCombos{font-size:12px;line-height:1.7;margin-top:6px}.autoTime{font-size:10px;color:var(--muted)}.autoResult{margin-top:7px;padding:7px 8px;border-radius:9px;background:#0d1827;font-size:12px}.autoPending{color:var(--muted)}.venueFilter{margin-top:10px}.venueGroup{margin-top:12px}.venueTitle{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 10px;border-radius:10px;background:#0d1827;border:1px solid var(--line);font-weight:900}.venueStats{font-size:10px;color:var(--muted);font-weight:600}.venueEmpty{padding:12px;color:var(--muted)}\n@media(max-width:650px){.row{grid-template-columns:1fr 1fr}.scores{grid-template-columns:1fr}.wrap{padding:10px 9px 60px}}\n</style></head><body><div class=\"wrap\">\n<h1>🚴 競輪AI予想 V2</h1><div class=\"sub\">今日の開催 → 総合AI採点 → H/B補助 → 3連単上位6点</div>\n<div class=\"card\"><b>① 今日のレースを選ぶ</b><div class=\"row\" style=\"margin-top:10px\">\n<div><label>日付</label><input id=\"date\" type=\"date\"></div><div><label>競輪場</label><select id=\"track\"><option value=\"\">取得してください</option></select></div><div><label>R</label><select id=\"race\"></select></div><div><label>データ</label><button id=\"todayBtn\">今日の開催を取得</button></div></div>\n<button class=\"primary\" id=\"entryBtn\" style=\"margin-top:9px\">出走表を自動取得</button><div id=\"autoStatus\" class=\"status muted\"></div><div class=\"source\">データ取込は試作版。最終確認は主催者発表を優先してください。</div></div>\n<div class=\"card\"><b>② ライン・並び</b><label style=\"margin-top:8px\">例：1-4-8 / 3-9 / 6-2 / 5 / 7</label><input id=\"lines\" placeholder=\"並びが取れない場合だけ入力\"><div class=\"pills\"><span class=\"pill\">H/B展開予測</span><span class=\"pill\">H/Bは補助評価</span><span class=\"pill\">能力・連対率重視</span><span class=\"pill\">ライン補正</span><span class=\"pill\">競走得点・勝率</span><span class=\"pill\">3連単6点に絞る</span></div></div>\n<div class=\"card\"><b>③ 選手データ</b><div class=\"muted\" style=\"font-size:11px;margin:5px 0 9px\">自動取得後も数値は修正できます。</div><div class=\"grid\"><div class=\"rider hdr\"><div>車</div><div>選手</div><div>得点</div><div>勝%</div><div>2連%</div><div>3連%</div><div>S</div><div>H</div><div>B</div><div>脚質</div></div><div id=\"riders\"></div></div><button class=\"primary\" id=\"predictBtn\" style=\"margin-top:10px\">AI予想する</button></div>\n<div id=\"result\" class=\"card hidden\"><div class=\"scores\"><div class=\"score\"><small class=\"muted\">勝負度</small><br><b id=\"grade\">-</b><div id=\"gradeNote\" class=\"muted\"></div></div><div class=\"score\"><small class=\"muted\">◎ 本命</small><br><b id=\"main\">-</b><div id=\"mainP\" class=\"muted\"></div></div><div class=\"score\"><small class=\"muted\">上位3車集中度</small><br><b id=\"focus\">-</b><div class=\"muted\">軸の絞りやすさ</div></div></div><div class=\"scores\" style=\"margin-top:8px\"><div class=\"score\"><small class=\"muted\">H予測</small><br><b id=\"hForecast\">-</b></div><div class=\"score\"><small class=\"muted\">B予測</small><br><b id=\"bForecast\">-</b></div><div class=\"score\"><small class=\"muted\">展開シナリオ</small><br><b id=\"scenario\" style=\"font-size:16px\">-</b></div></div><h3>展開AIランキング</h3><div style=\"overflow:auto\"><table><thead><tr><th>印</th><th>車</th><th>選手</th><th>AI</th><th>1着推定</th><th>H予測</th><th>B予測</th><th>脚質</th></tr></thead><tbody id=\"rank\"></tbody></table></div><h3>総合AI 3連単上位6点</h3><div style=\"overflow:auto\"><table><thead><tr><th>#</th><th>買い目</th><th>推定確率</th><th>構築理由</th></tr></thead><tbody id=\"combos\"></tbody></table></div><div class=\"row2\" style=\"margin-top:10px\"><button class=\"good\" id=\"saveBtn\">予想保存</button><button id=\"copyBtn\">note用コピー</button></div></div>\n<div class=\"card\"><b>④ 予想成績・結果入力</b><div class=\"muted\" style=\"font-size:11px;margin:5px 0 9px\">保存した予想に実際の結果を記録します。初期設定は上位6点×各100円＝600円です。</div><div class=\"row\"><div><label>保存レース</label><select id=\"resultRace\"></select></div><div><label>1着</label><select id=\"finish1\"></select></div><div><label>2着</label><select id=\"finish2\"></select></div><div><label>3着</label><select id=\"finish3\"></select></div></div><div class=\"row2\" style=\"margin-top:8px\"><div><label>3連単払戻（100円あたり）</label><input id=\"payout\" type=\"number\" min=\"0\" step=\"10\" placeholder=\"例：12840\"></div><div><label>1点あたり購入額</label><input id=\"stakePerBet\" type=\"number\" min=\"100\" step=\"100\" value=\"100\"></div></div><div class=\"row2\" style=\"margin-top:9px\"><button class=\"primary\" id=\"autoResultBtn\">結果を自動取得</button><button class=\"good\" id=\"recordBtn\">結果を記録</button></div><div id=\"resultStatus\" class=\"status muted\"></div><h3>累計成績</h3><div class=\"statgrid\"><div class=\"score\"><small class=\"muted\">検証済み</small><br><b id=\"testedCount\">0</b></div><div class=\"score\"><small class=\"muted\">本命1着率</small><br><b id=\"mainHitRate\">0%</b></div><div class=\"score\"><small class=\"muted\">3連単6点的中率</small><br><b id=\"trifectaHitRate\">0%</b></div><div class=\"score\"><small class=\"muted\">購入額</small><br><b id=\"totalStake\">¥0</b></div><div class=\"score\"><small class=\"muted\">払戻</small><br><b id=\"totalReturn\">¥0</b></div><div class=\"score\"><small class=\"muted\">回収率</small><br><b id=\"roi\">0%</b></div></div><div id=\"history\"></div></div><div class=\"card\"><div class=\"autoHead\"><b>⑤ 自動予想一覧</b><button id=\"refreshAutoBtn\" style=\"width:auto;padding:8px 12px\">更新</button></div><div class=\"muted\" style=\"font-size:11px;margin:5px 0 9px\">締切時間が近い未予想レースから順にCronが処理します。同じrace_idは最新内容に更新されます。</div><div class=\"row2\"><div class=\"score\"><small class=\"muted\">自動予想</small><br><b id=\"autoCount\">0</b></div><div class=\"score\"><small class=\"muted\">最終自動実行</small><br><span id=\"autoRanAt\" class=\"muted\">-</span></div></div><div class=\"statgrid\" style=\"margin-top:8px\"><div class=\"score\"><small class=\"muted\">自動検証済み</small><br><b id=\"autoTested\">0</b></div><div class=\"score\"><small class=\"muted\">6点的中率</small><br><b id=\"autoHitRate\">0%</b></div><div class=\"score\"><small class=\"muted\">自動回収率</small><br><b id=\"autoRoi\">0%</b></div></div><div id=\"autoQueueInfo\" class=\"autoResult autoPending\" style=\"margin-top:8px\">締切優先キューを読み込み中…</div><div class=\"venueFilter\"><label>競輪場ごとに表示</label><select id=\"autoVenueFilter\"><option value=\"ALL\">すべての競輪場</option></select></div><div id=\"autoList\"><div class=\"muted\" style=\"margin-top:9px\">読み込み中…</div></div></div><div class=\"card\"><b>保存状況</b><div class=\"row\" style=\"margin-top:9px\"><div><small class=\"muted\">保存予想</small><div id=\"saveCount\" style=\"font-size:22px;font-weight:900\">0</div></div><div><small class=\"muted\">バージョン</small><div style=\"font-size:18px;font-weight:900\">V2 AUTO FIX11.4</div></div></div></div>\n<div class=\"footer\">※統計モデルの参考値です。的中や利益を保証するものではありません。<br>※公開サイトの自動取込は相手サイトの仕様変更で動かなくなる場合があります。商用運用では利用条件に適合したデータ供給方法へ切り替えてください。</div>\n</div><script>\nconst $=x=>document.getElementById(x); let latest=null;\nconst venueFallback={\"11\":\"函館\",\"12\":\"青森\",\"13\":\"いわき平\",\"21\":\"弥彦\",\"22\":\"前橋\",\"23\":\"取手\",\"24\":\"宇都宮\",\"25\":\"大宮\",\"26\":\"西武園\",\"27\":\"京王閣\",\"28\":\"立川\",\"31\":\"松戸\",\"32\":\"千葉\",\"34\":\"川崎\",\"35\":\"平塚\",\"36\":\"小田原\",\"37\":\"伊東温泉\",\"38\":\"静岡\",\"42\":\"名古屋\",\"43\":\"岐阜\",\"44\":\"大垣\",\"45\":\"豊橋\",\"46\":\"富山\",\"47\":\"松阪\",\"48\":\"四日市\",\"51\":\"福井\",\"53\":\"奈良\",\"54\":\"向日町\",\"55\":\"和歌山\",\"56\":\"岸和田\",\"61\":\"玉野\",\"62\":\"広島\",\"63\":\"防府\",\"71\":\"高松\",\"73\":\"小松島\",\"74\":\"高知\",\"75\":\"松山\",\"81\":\"小倉\",\"83\":\"久留米\",\"84\":\"武雄\",\"85\":\"佐世保\",\"86\":\"別府\",\"87\":\"熊本\"};\nfunction init(){let d=new Date(),z=n=>String(n).padStart(2,'0');$('date').value=`${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;for(let i=1;i<=12;i++)$('race').innerHTML+=`<option value=\"${i}\">${i}R</option>`;render([]);stats();loadAutoPredictions();}\nfunction render(data){$('riders').innerHTML='';(data.length?data:Array.from({length:7},(_,i)=>({num:i+1}))).forEach(x=>{let d=document.createElement('div');d.className='rider';d.dataset.num=x.num;d.innerHTML=`<div class=\"num n${x.num}\">${x.num}</div><input class=\"name\" value=\"${esc(x.name||'')}\" placeholder=\"選手\"><input class=\"pts\" type=\"number\" step=\".01\" value=\"${x.score??''}\"><input class=\"win\" type=\"number\" step=\".1\" value=\"${x.win??''}\"><input class=\"top2\" type=\"number\" step=\".1\" value=\"${x.top2??''}\"><input class=\"top3\" type=\"number\" step=\".1\" value=\"${x.top3??''}\"><input class=\"s\" type=\"number\" value=\"${x.s??''}\"><input class=\"h\" type=\"number\" value=\"${x.h??''}\"><input class=\"b\" type=\"number\" value=\"${x.b??''}\"><select class=\"style\"><option ${x.style==='逃'?'selected':''}>逃</option><option ${x.style==='両'?'selected':''}>両</option><option ${x.style==='追'?'selected':''}>追</option></select>`;$('riders').appendChild(d)});}\nfunction esc(s){return String(s).replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[m]))}\nasync function today(){setStatus('開催一覧を取得中…');try{let d=$('date').value.replaceAll('-','');let r=await fetch(`/api/today?date=${d}`);let j=await r.json();if(!r.ok)throw Error(j.error||'取得失敗');$('track').innerHTML='';j.venues.forEach(v=>$('track').innerHTML+=`<option value=\"${v.code}\">${v.name}${v.grade?' '+v.grade:''}</option>`);setStatus(`${j.venues.length}場を取得しました`,'ok')}catch(e){setStatus('開催取得に失敗：'+e.message,'err')}}\nasync function entry(){let code=$('track').value;if(!code){setStatus('先に開催一覧を取得してください','err');return}setStatus('出走表を取得中…');try{let date=$('date').value.replaceAll('-',''),race=String($('race').value).padStart(2,'0');let id=date+code+race;let r=await fetch(`/api/entry?race_id=${id}`);let j=await r.json();if(!r.ok)throw Error(j.error||'取得失敗');render(j.riders);$('lines').value=j.lineText||'';window.currentRaceId=j.race_id;setStatus(`${j.track||venueFallback[code]||''} ${$('race').value}R：${j.riders.length}車を自動取得${j.lineText?'・ラインも取得':'・ラインは手入力'}`,'ok');predict()}catch(e){setStatus('出走表取得に失敗：'+e.message,'err')}}\nfunction setStatus(t,c='muted'){$('autoStatus').className='status '+c;$('autoStatus').textContent=t}\nfunction lines(){let groups=$('lines').value.trim().split('/').map(x=>x.trim()).filter(Boolean).map(x=>x.split('-').map(Number).filter(Boolean)),pos={};groups.forEach((g,gi)=>g.forEach((n,i)=>pos[n]={g:gi,i,len:g.length}));return{groups,pos}}\nfunction data(){return[...document.querySelectorAll('#riders .rider')].map(r=>({num:+r.dataset.num,name:r.querySelector('.name').value||('選手'+r.dataset.num),pts:+r.querySelector('.pts').value||0,win:+r.querySelector('.win').value||0,top2:+r.querySelector('.top2').value||0,top3:+r.querySelector('.top3').value||0,s:+r.querySelector('.s').value||0,h:+r.querySelector('.h').value||0,b:+r.querySelector('.b').value||0,style:r.querySelector('.style').value}))}\nfunction nrm(a,v){let mi=Math.min(...a),ma=Math.max(...a);return ma===mi?.5:(v-mi)/(ma-mi)}\nfunction principleModel(R,L){\n  let C={pts:R.map(x=>x.pts),win:R.map(x=>x.win),top2:R.map(x=>x.top2),top3:R.map(x=>x.top3),b:R.map(x=>x.b),s:R.map(x=>x.s),h:R.map(x=>x.h)},groups=L.groups||[],leaderNums=new Set(groups.length?groups.map(g=>g[0]):R.filter(x=>x.style!=='追').map(x=>x.num));\n  if(!leaderNums.size)R.forEach(x=>leaderNums.add(x.num));\n  // H/Bは展開の参考値として予測するが、買い目へ強制採用しない。\n  R.forEach(x=>{let p=L.pos[x.num],attack=x.style==='逃'?1:x.style==='両'?.68:.18,lead=leaderNums.has(x.num)?1:0;x.hRaw=42*nrm(C.h,x.h)+20*nrm(C.b,x.b)+14*attack+10*lead+7*nrm(C.s,x.s)+7*nrm(C.pts,x.pts)-(p&&p.i>0?14+4*p.i:0);x.bRaw=50*nrm(C.b,x.b)+18*nrm(C.h,x.h)+15*attack+10*lead+5*nrm(C.pts,x.pts)+2*nrm(C.s,x.s)-(p&&p.i>0?17+5*p.i:0)});\n  let cand=R.filter(x=>leaderNums.has(x.num)),sm=(key,T)=>{let mx=Math.max(...cand.map(x=>x[key])),e=cand.map(x=>Math.exp((x[key]-mx)/T)),z=e.reduce((a,b)=>a+b,0),u=1/Math.max(1,cand.length);R.forEach(x=>x[key==='hRaw'?'hp':'bp']=0);cand.forEach((x,i)=>x[key==='hRaw'?'hp':'bp']=.78*(e[i]/z)+.22*u)};sm('hRaw',15);sm('bRaw',15);\n  let hPick=[...R].sort((a,b)=>b.hp-a.hp)[0],bPick=[...R].sort((a,b)=>b.bp-a.bp)[0],bg=groups.find(g=>g[0]===bPick.num)||[bPick.num],second=R.find(x=>x.num===bg[1]);\n  // 元の総合AIを主役に戻す。H/B予測は小さな補助点だけ。\n  R.forEach(x=>{let attack=x.style==='逃'?1:x.style==='両'?.6:.15,p=L.pos[x.num];let sc=34*nrm(C.pts,x.pts)+18*nrm(C.win,x.win)+14*nrm(C.top2,x.top2)+10*nrm(C.top3,x.top3)+8*nrm(C.b,x.b)+4*nrm(C.s,x.s)+4*nrm(C.h,x.h)+8*attack;if(p){if(p.i===0&&(x.style==='逃'||x.style==='両'))sc+=4.3;if(p.i===1)sc+=4;if(p.i>=2)sc+=1.3;if(p.len>=3)sc+=1}if(x.num===bPick.num&&bPick.bp>=.45)sc+=1.5+2*bPick.bp;if(x.num===hPick.num&&hPick.hp>=.45)sc+=.8+1.2*hPick.hp;if(second&&x.num===second.num&&bPick.bp>=.55)sc+=1.2*bPick.bp;x.ai=sc});\n  let mx=Math.max(...R.map(x=>x.ai)),E=R.map(x=>Math.exp((x.ai-mx)/15)),sum=E.reduce((a,b)=>a+b,0),u=1/R.length;R.forEach((x,i)=>x.p=.9*(E[i]/sum)+.1*u);\n  let rank=[...R].sort((a,b)=>b.ai-a.ai),scenario='総合能力・連対率を優先／H・Bは補助評価';if(second&&bPick.bp>=.45)scenario+=`／${bPick.num}-${second.num}ラインを軽く加点`;\n  let comb=[];R.forEach(a=>R.forEach(b=>R.forEach(c=>{if(new Set([a.num,b.num,c.num]).size<3)return;let den1=Math.max(.001,1-a.p),den2=Math.max(.001,1-a.p-b.p),raw=a.p*(b.p/den1)*(c.p/den2),mul=1,label='総合AI上位',A=L.pos[a.num],B=L.pos[b.num],C2=L.pos[c.num],sameAB=A&&B&&A.g===B.g,sameBC=B&&C2&&B.g===C2.g,allSame=sameAB&&sameBC;if(sameAB){mul*=1.15;label='ライン連係'}if(sameBC)mul*=1.08;if(allSame){mul*=1.08;label='ライン決着'}if(bPick.bp>=.5&&a.num===bPick.num){mul*=1.05;label=label==='総合AI上位'?'H/B補助・主導権候補':label+'＋H/B補助'}if(second&&bPick.bp>=.55&&a.num===second.num&&b.num===bPick.num){mul*=1.06;label='H/B補助・番手差し'}else if(second&&bPick.bp>=.55&&a.num===bPick.num&&b.num===second.num){mul*=1.06;label='H/B補助・先行残り'}if(hPick.hp>=.55&&a.num===hPick.num)mul*=1.03;comb.push({a:a.num,b:b.num,c:c.num,raw:raw*mul,label})})));\n  let total=comb.reduce((a,b)=>a+b.raw,0);comb.forEach(x=>x.p=x.raw/total);comb.sort((a,b)=>b.raw-a.raw);let top=comb.slice(0,6),focus=rank.slice(0,3).reduce((a,b)=>a+b.p,0),gap=rank[0].ai-rank[1].ai,g='B';if(rank[0].p>=.28&&gap>=6&&focus>=.68)g='S';else if(rank[0].p>=.21&&gap>=3&&focus>=.60)g='A';return{grade:g,rank,top,hPick,bPick,scenario,focus,gap}}\nfunction predict(){let R=data();if(!R.length||R.every(x=>!x.pts)){alert('出走表を取得するかデータを入力してね');return}let L=lines(),m=principleModel(R,L),rank=m.rank,top=m.top,g=m.grade;$('grade').textContent=g+'評価';$('grade').className=g;$('gradeNote').textContent=`H/Bは補助評価 / 軸差 ${m.gap.toFixed(1)}pt`;$('main').textContent=`${rank[0].num}番 ${rank[0].name}`;$('mainP').textContent=`1着推定 ${(rank[0].p*100).toFixed(1)}%`;$('focus').textContent=(m.focus*100).toFixed(1)+'%';$('hForecast').textContent=`${m.hPick.num}番 ${(m.hPick.hp*100).toFixed(0)}%`;$('bForecast').textContent=`${m.bPick.num}番 ${(m.bPick.bp*100).toFixed(0)}%`;$('scenario').textContent=m.scenario;let M=['◎','○','▲','△','☆'];$('rank').innerHTML=rank.map((x,i)=>`<tr><td><b>${M[i]||''}</b></td><td>${x.num}</td><td>${esc(x.name)}</td><td>${x.ai.toFixed(1)}</td><td>${(x.p*100).toFixed(1)}%</td><td>${(x.hp*100).toFixed(0)}%</td><td>${(x.bp*100).toFixed(0)}%</td><td>${x.style}</td></tr>`).join('');$('combos').innerHTML=top.map((x,i)=>`<tr><td>${i+1}</td><td class=\"combo\">${x.a}-${x.b}-${x.c}</td><td>${(x.p*100).toFixed(2)}%</td><td>${esc(x.label)}</td></tr>`).join('');latest={date:$('date').value,track:$('track').selectedOptions[0]?.textContent||'',race:+$('race').value,raceId:window.currentRaceId||($('date').value.replaceAll('-','')+$('track').value+String($('race').value).padStart(2,'0')),grade:g,rank,top,lines:$('lines').value,hForecast:{num:m.hPick.num,p:m.hPick.hp},bForecast:{num:m.bPick.num,p:m.bPick.bp},scenario:m.scenario,at:new Date().toISOString()};$('result').classList.remove('hidden');}\nfunction save(){if(!latest)return;let a=JSON.parse(localStorage.getItem('keirinV2')||'[]'),copy=JSON.parse(JSON.stringify(latest)),i=a.findIndex(x=>(copy.raceId&&x.raceId===copy.raceId)||(!copy.raceId&&x.date===copy.date&&x.track===copy.track&&+x.race===+copy.race));if(i>=0){copy.id=a[i].id||copy.id||Date.now();if(a[i].result)copy.result=a[i].result;a[i]=copy;localStorage.setItem('keirinV2',JSON.stringify(a));stats();alert('同じレースの予想を最新内容に更新しました')}else{copy.id=copy.id||Date.now();a.push(copy);localStorage.setItem('keirinV2',JSON.stringify(a));stats();alert('予想を保存しました')}}\nfunction saved(){return JSON.parse(localStorage.getItem('keirinV2')||'[]')}\nfunction yen(n){return '¥'+Math.round(n||0).toLocaleString('ja-JP')}\nfunction resultOptions(){let a=saved(),sel=$('resultRace');if(!sel)return;let cur=sel.value;sel.innerHTML='<option value=\"\">保存レースを選択</option>'+a.map((x,i)=>`<option value=\"${i}\">${x.date} ${esc(x.track)} ${x.race}R${x.result?' ✓':''}</option>`).join('');if(cur!==''&&a[+cur])sel.value=cur;let nums='<option value=\"\">車番</option>'+Array.from({length:9},(_,i)=>`<option value=\"${i+1}\">${i+1}</option>`).join('');['finish1','finish2','finish3'].forEach(id=>{if($(id))$(id).innerHTML=nums})}\nfunction stats(){let a=saved();$('saveCount').textContent=a.length;resultOptions();let done=a.filter(x=>x.result),tested=done.length,mainHits=done.filter(x=>x.result.mainHit).length,hits=done.filter(x=>x.result.hit).length,stake=done.reduce((s,x)=>s+(x.result.stake||0),0),ret=done.reduce((s,x)=>s+(x.result.returnAmount||0),0);if($('testedCount')){$('testedCount').textContent=tested;$('mainHitRate').textContent=tested?(mainHits/tested*100).toFixed(1)+'%':'0%';$('trifectaHitRate').textContent=tested?(hits/tested*100).toFixed(1)+'%':'0%';$('totalStake').textContent=yen(stake);$('totalReturn').textContent=yen(ret);$('roi').textContent=stake?(ret/stake*100).toFixed(1)+'%':'0%';$('history').innerHTML=done.slice().reverse().slice(0,10).map(x=>`<div class=\"historyItem\"><b>${esc(x.date)} ${esc(x.track)} ${x.race}R</b>　<span class=\"${x.result.hit?'hit':'miss'}\">${x.result.hit?'的中':'不的中'}</span><br><span class=\"muted\">${x.result.finish} / 購入 ${yen(x.result.stake)} / 払戻 ${yen(x.result.returnAmount)} / 収支 ${x.result.profit>=0?'+':''}${yen(x.result.profit)}</span></div>`).join('')}}\nasync function autoResult(){let raw=$('resultRace').value;if(raw===''){alert('保存レースを選んでね');return}let idx=+raw,a=saved(),x=a[idx];if(!x){alert('保存レースを選んでね');return}let raceId=x.raceId;if(!raceId){let code=Object.keys(venueFallback).find(k=>String(x.track||'').includes(venueFallback[k]));if(code)raceId=String(x.date||'').replaceAll('-','')+code+String(x.race).padStart(2,'0')}if(!raceId){$('resultStatus').className='status err';$('resultStatus').textContent='race_idを作れませんでした。';return}$('resultStatus').className='status muted';$('resultStatus').textContent='結果を取得中…';try{let r=await fetch(`/api/race-result?race_id=${raceId}`),j=await r.json();if(!r.ok)throw Error(j.error||'取得失敗');if(!j.ready){$('resultStatus').className='status muted';$('resultStatus').textContent=j.message||'結果はまだ確定していません。';return}[$('finish1').value,$('finish2').value,$('finish3').value]=j.finish.map(String);$('payout').value=j.payout;$('resultStatus').className='status ok';$('resultStatus').textContent=`自動取得：${j.finish.join('-')} / 3連単 ${yen(j.payout)}。確認後「結果を記録」を押してね。`}catch(e){$('resultStatus').className='status err';$('resultStatus').textContent='結果取得に失敗：'+e.message}}\nfunction recordResult(){let raw=$('resultRace').value;if(raw===''){alert('保存レースを選んでね');return}let idx=+raw,f1=+$('finish1').value,f2=+$('finish2').value,f3=+$('finish3').value,payout=+$('payout').value||0,unit=+$('stakePerBet').value||100,a=saved();if(!a[idx]){alert('保存レースを選んでね');return}if(!f1||!f2||!f3||new Set([f1,f2,f3]).size<3){alert('1着・2着・3着を正しく選んでね');return}let x=a[idx],key=`${f1}-${f2}-${f3}`,hit=(x.top||[]).some(c=>`${c.a}-${c.b}-${c.c}`===key),mainHit=!!(x.rank&&x.rank[0]&&x.rank[0].num===f1),stake=(x.top||[]).length*unit,returnAmount=hit?payout*(unit/100):0;x.result={finish:key,payout,unit,stake,returnAmount,profit:returnAmount-stake,hit,mainHit,recordedAt:new Date().toISOString()};a[idx]=x;localStorage.setItem('keirinV2',JSON.stringify(a));stats();alert(hit?'🎯 3連単6点 的中！':'結果を記録しました')}\nlet autoPredCache=[];function autoResultHtml(x){let c=(x.top||[]).map(v=>`${v.a}-${v.b}-${v.c}`).join(' / '),p=x.main&&Number.isFinite(+x.main.p)?(+x.main.p*100).toFixed(1)+'%':'-',hp=x.hPick&&Number.isFinite(+x.hPick.p)?(+x.hPick.p*100).toFixed(0)+'%':'-',bp=x.bPick&&Number.isFinite(+x.bPick.p)?(+x.bPick.p*100).toFixed(0)+'%':'-',rr=x.result,head=`<div class='autoHead'><b>${esc(x.track||'')} ${x.race||''}R</b><span class='autoGrade ${esc(x.grade||'B')}'>${esc(x.grade||'B')}評価</span></div><div style='margin-top:5px'>◎ ${x.main?x.main.num:''} ${esc(x.main?.name||'')} <span class='muted'>1着推定 ${p}</span></div><div class='autoCombos'><b>H予測 ${x.hPick?.num||'-'}番 ${hp} ／ B予測 ${x.bPick?.num||'-'}番 ${bp}</b><br><span class='muted'>展開：</span>${esc(x.scenario||'-')}<br><span class='muted'>3連単：</span>${esc(c||'-')}</div>`;if(rr){let cls=rr.hit?'hit':'miss',txt=rr.hit?'的中':'不的中',profit=(rr.profit||0)>=0?'+'+yen(rr.profit):yen(rr.profit);return `<div class='autoItem'>${head}<div class='autoResult'><span class='${cls}'>${txt}</span>　結果 ${esc(rr.finish||'-')}<br><span class='muted'>購入 ${yen(rr.stake)} / 払戻 ${yen(rr.returnAmount)} / 収支 ${profit}</span></div><div class='autoTime'>${x.deadline?`締切 ${new Date(x.deadline).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}　`:''}race_id ${esc(x.raceId||'')}　${x.at?new Date(x.at).toLocaleString('ja-JP'):''}</div></div>`}return `<div class='autoItem'>${head}<div class='autoResult autoPending'>結果待ち（Cronが自動取得します）</div><div class='autoTime'>${x.deadline?`締切 ${new Date(x.deadline).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'})}　`:''}race_id ${esc(x.raceId||'')}　${x.at?new Date(x.at).toLocaleString('ja-JP'):''}</div></div>`}function venueStatsHtml(a){let done=a.filter(x=>x.result),hits=done.filter(x=>x.result.hit).length,stake=done.reduce((n,x)=>n+(x.result.stake||0),0),ret=done.reduce((n,x)=>n+(x.result.returnAmount||0),0),hit=done.length?(hits/done.length*100).toFixed(1)+'%':'-',roi=stake?(ret/stake*100).toFixed(1)+'%':'-';return `${a.length}予想 / 検証${done.length} / 的中${hit} / 回収${roi}`}function renderAutoByVenue(){let box=$('autoList');if(!box)return;let sel=$('autoVenueFilter')?.value||'ALL',a=autoPredCache.slice().reverse();if(sel!=='ALL')a=a.filter(x=>(x.track||'不明')===sel);if(!a.length){box.innerHTML=`<div class='venueEmpty'>この競輪場の自動予想はまだありません。</div>`;return}let groups={};a.forEach(x=>{let k=x.track||'不明';(groups[k]||(groups[k]=[])).push(x)});box.innerHTML=Object.entries(groups).map(([track,items])=>`<div class='venueGroup'><div class='venueTitle'><span>📍 ${esc(track)}</span><span class='venueStats'>${venueStatsHtml(items)}</span></div>${items.map(autoResultHtml).join('')}</div>`).join('')}function setAutoVenueOptions(a){let sel=$('autoVenueFilter');if(!sel)return;let cur=sel.value||'ALL',tracks=[...new Set(a.map(x=>x.track||'不明'))].sort((a,b)=>String(a).localeCompare(String(b),'ja'));sel.innerHTML=`<option value='ALL'>すべての競輪場（${tracks.length}場）</option>`+tracks.map(t=>`<option value='${esc(t)}'>${esc(t)}（${a.filter(x=>(x.track||'不明')===t).length}件）</option>`).join('');if(cur==='ALL'||tracks.includes(cur))sel.value=cur;else sel.value='ALL'}async function loadAutoPredictions(){let box=$('autoList');if(!box)return;box.innerHTML='<div class=\"muted\" style=\"margin-top:9px\">自動予想を読み込み中…</div>';try{let r=await fetch('/api/auto-status',{cache:'no-store'}),j=await r.json();let a=Array.isArray(j.predictions)?j.predictions:[];autoPredCache=a;$('autoCount').textContent=a.length;$('autoRanAt').textContent=j.ranAt?new Date(j.ranAt).toLocaleString('ja-JP'):'-';let done=a.filter(x=>x.result),hits=done.filter(x=>x.result.hit).length,stake=done.reduce((n,x)=>n+(x.result.stake||0),0),ret=done.reduce((n,x)=>n+(x.result.returnAmount||0),0);$('autoTested').textContent=done.length;$('autoHitRate').textContent=done.length?(hits/done.length*100).toFixed(1)+'%':'0%';$('autoRoi').textContent=stake?(ret/stake*100).toFixed(1)+'%':'0%';let qi=j.queueInfo||{},qbox=$('autoQueueInfo');if(qbox){let next=qi.next?`${esc(qi.next.track||'')} ${qi.next.race||''}R / 締切 ${qi.next.deadline?new Date(qi.next.deadline).toLocaleTimeString('ja-JP',{hour:'2-digit',minute:'2-digit'}):'-'}`:'待機中';qbox.innerHTML=`<b>締切優先キュー</b>　時刻取得 ${qi.scheduledVenues||0}/${qi.totalVenues||0}場<br><span class='muted'>全${qi.totalRaces||0}R / 予想済${qi.predicted||0} / 待機${qi.waiting||0} / 締切通過${qi.missed||0}</span><br>次：${next}`;}if(!a.length){box.innerHTML=`<div class='muted' style='margin-top:9px'>${esc(j.message||'まだ自動予想がありません。Cronの処理後に表示されます。')}</div>`;return}setAutoVenueOptions(a);renderAutoByVenue()}catch(e){$('autoCount').textContent='-';box.innerHTML=`<div class='err' style='margin-top:9px'>自動予想の取得に失敗：${esc(e.message)}</div>`}}$('autoVenueFilter')?.addEventListener('change',renderAutoByVenue);\nfunction copy(){if(!latest)return;let r=latest.rank,c=latest.top,t=`🚴 競輪AI予想 FIX11.4\n${latest.track} ${latest.race}R\n勝負度：${latest.grade}\nライン：${latest.lines||'未入力'}\nH予測：${latest.hForecast?.num||'-'}番（${latest.hForecast? (latest.hForecast.p*100).toFixed(0):'-'}%）\nB予測：${latest.bForecast?.num||'-'}番（${latest.bForecast? (latest.bForecast.p*100).toFixed(0):'-'}%）\n展開：${latest.scenario||'-'}\n\n◎ ${r[0].num} ${r[0].name}\n○ ${r[1].num} ${r[1].name}\n▲ ${r[2].num} ${r[2].name}\n\n【総合AI 3連単上位6点】\n${c.map((x,i)=>`${i+1}. ${x.a}-${x.b}-${x.c}（${x.label||''} / 推定${(x.p*100).toFixed(2)}%）`).join('\\n')}\n\n※H/Bは補助評価です。総合AI上位を優先しており、的中・利益を保証するものではありません。`;navigator.clipboard.writeText(t).then(()=>alert('コピーしました'))}\n$('todayBtn').onclick=today;$('entryBtn').onclick=entry;$('predictBtn').onclick=predict;$('saveBtn').onclick=save;$('copyBtn').onclick=copy;$('autoResultBtn').onclick=autoResult;$('recordBtn').onclick=recordResult;$('refreshAutoBtn').onclick=loadAutoPredictions;init();\n</script></body></html>";


function serverPredict(riders,lineText){
  const R=riders.map(x=>({num:x.num,name:x.name,pts:x.score||0,win:x.win||0,top2:x.top2||0,top3:x.top3||0,s:x.s||0,h:x.h||0,b:x.b||0,style:x.style||'追'}));
  const groups=String(lineText||'').split('/').map(x=>x.trim()).filter(Boolean).map(x=>x.split('-').map(Number).filter(Boolean)),pos={};groups.forEach((g,gi)=>g.forEach((n,i)=>pos[n]={g:gi,i,len:g.length}));
  const nrm=(a,v)=>{const mi=Math.min(...a),ma=Math.max(...a);return ma===mi?.5:(v-mi)/(ma-mi)};
  const C={pts:R.map(x=>x.pts),win:R.map(x=>x.win),top2:R.map(x=>x.top2),top3:R.map(x=>x.top3),b:R.map(x=>x.b),s:R.map(x=>x.s),h:R.map(x=>x.h)};
  const leaderNums=new Set(groups.length?groups.map(g=>g[0]):R.filter(x=>x.style!=='追').map(x=>x.num));if(!leaderNums.size)R.forEach(x=>leaderNums.add(x.num));
  R.forEach(x=>{const p=pos[x.num],attack=x.style==='逃'?1:x.style==='両'?.68:.18,lead=leaderNums.has(x.num)?1:0;x.hRaw=42*nrm(C.h,x.h)+20*nrm(C.b,x.b)+14*attack+10*lead+7*nrm(C.s,x.s)+7*nrm(C.pts,x.pts)-(p&&p.i>0?14+4*p.i:0);x.bRaw=50*nrm(C.b,x.b)+18*nrm(C.h,x.h)+15*attack+10*lead+5*nrm(C.pts,x.pts)+2*nrm(C.s,x.s)-(p&&p.i>0?17+5*p.i:0)});
  const cand=R.filter(x=>leaderNums.has(x.num));const sm=(key,T)=>{const mx=Math.max(...cand.map(x=>x[key])),e=cand.map(x=>Math.exp((x[key]-mx)/T)),z=e.reduce((a,b)=>a+b,0),u=1/Math.max(1,cand.length);R.forEach(x=>x[key==='hRaw'?'hp':'bp']=0);cand.forEach((x,i)=>x[key==='hRaw'?'hp':'bp']=.78*(e[i]/z)+.22*u)};sm('hRaw',15);sm('bRaw',15);
  const hPick=[...R].sort((a,b)=>b.hp-a.hp)[0],bPick=[...R].sort((a,b)=>b.bp-a.bp)[0],bg=groups.find(g=>g[0]===bPick.num)||[bPick.num],second=R.find(x=>x.num===bg[1]);
  R.forEach(x=>{const attack=x.style==='逃'?1:x.style==='両'?.6:.15,p=pos[x.num];let sc=34*nrm(C.pts,x.pts)+18*nrm(C.win,x.win)+14*nrm(C.top2,x.top2)+10*nrm(C.top3,x.top3)+8*nrm(C.b,x.b)+4*nrm(C.s,x.s)+4*nrm(C.h,x.h)+8*attack;if(p){if(p.i===0&&(x.style==='逃'||x.style==='両'))sc+=4.3;if(p.i===1)sc+=4;if(p.i>=2)sc+=1.3;if(p.len>=3)sc+=1}if(x.num===bPick.num&&bPick.bp>=.45)sc+=1.5+2*bPick.bp;if(x.num===hPick.num&&hPick.hp>=.45)sc+=.8+1.2*hPick.hp;if(second&&x.num===second.num&&bPick.bp>=.55)sc+=1.2*bPick.bp;x.ai=sc});
  const mx=Math.max(...R.map(x=>x.ai)),E=R.map(x=>Math.exp((x.ai-mx)/15)),sum=E.reduce((a,b)=>a+b,0),u=1/R.length;R.forEach((x,i)=>x.p=.9*(E[i]/sum)+.1*u);
  const rank=[...R].sort((a,b)=>b.ai-a.ai);let scenario='総合能力・連対率を優先／H・Bは補助評価';if(second&&bPick.bp>=.45)scenario+=`／${bPick.num}-${second.num}ラインを軽く加点`;
  const comb=[];R.forEach(a=>R.forEach(b=>R.forEach(c=>{if(new Set([a.num,b.num,c.num]).size<3)return;const den1=Math.max(.001,1-a.p),den2=Math.max(.001,1-a.p-b.p);let raw=a.p*(b.p/den1)*(c.p/den2),mul=1,label='総合AI上位';const A=pos[a.num],B=pos[b.num],C2=pos[c.num],sameAB=A&&B&&A.g===B.g,sameBC=B&&C2&&B.g===C2.g,allSame=sameAB&&sameBC;if(sameAB){mul*=1.15;label='ライン連係'}if(sameBC)mul*=1.08;if(allSame){mul*=1.08;label='ライン決着'}if(bPick.bp>=.5&&a.num===bPick.num){mul*=1.05;label=label==='総合AI上位'?'H/B補助・主導権候補':label+'＋H/B補助'}if(second&&bPick.bp>=.55&&a.num===second.num&&b.num===bPick.num){mul*=1.06;label='H/B補助・番手差し'}else if(second&&bPick.bp>=.55&&a.num===bPick.num&&b.num===second.num){mul*=1.06;label='H/B補助・先行残り'}if(hPick.hp>=.55&&a.num===hPick.num)mul*=1.03;comb.push({a:a.num,b:b.num,c:c.num,raw:raw*mul,label})})));
  const total=comb.reduce((a,b)=>a+b.raw,0);comb.forEach(x=>x.p=x.raw/total);comb.sort((a,b)=>b.raw-a.raw);const chosen=comb.slice(0,6),focus=rank.slice(0,3).reduce((a,b)=>a+b.p,0),gap=rank[0].ai-rank[1].ai;let grade='B';if(rank[0].p>=.28&&gap>=6&&focus>=.68)grade='S';else if(rank[0].p>=.21&&gap>=3&&focus>=.60)grade='A';
  return {grade,main:{num:rank[0].num,name:rank[0].name,p:rank[0].p},hPick:{num:hPick.num,name:hPick.name,p:hPick.hp},bPick:{num:bPick.num,name:bPick.name,p:bPick.bp},scenario,focus,gap,top:chosen.map(x=>({a:x.a,b:x.b,c:x.c,p:x.p,label:x.label}))};
}
async function autoFetchEntryRiders(id){
  const src=`https://keirin.netkeiba.com/race/entry/?race_id=${id}`;
  const r=await fetchHtml(src),rows=[],cap=new RowCapture(rows);
  const transformed=new HTMLRewriter().on('tr',cap.tr).on('td',cap.td).transform(r);await transformed.text();
  const riders=parseRiders(rows);
  if(riders.length<5)throw new Error(`entry parse ${riders.length}`);
  return riders;
}
async function autoFetchLine(id,riders){
  const src=`https://keirin.netkeiba.com/race/yoso/?race_id=${id}`;
  const r=await fetchHtml(src),body=new BodyText();
  await new HTMLRewriter().on('body',body).transform(r).text();
  return parseLineText(body.value,riders);
}
const AUTO_STATE_KEY=new Request('https://keirin-ai-v2.local/__auto_state');
const AUTO_LATEST_KEY=new Request('https://keirin-ai-v2.local/__auto_latest');
async function readStored(env,name,key){
  try{if(env&&env.AUTO_KV){const v=await env.AUTO_KV.get(name,'json');if(v)return v}}catch(e){console.log('AUTO_KV_READ',name,e?.message||String(e))}
  try{const r=await caches.default.match(key);if(r)return await r.json()}catch(_){}
  return null;
}
async function writeStored(env,name,key,v,ttl=86400){
  try{if(env&&env.AUTO_KV)await env.AUTO_KV.put(name,JSON.stringify(v),{expirationTtl:ttl})}catch(e){console.log('AUTO_KV_WRITE',name,e?.message||String(e))}
  try{await caches.default.put(key,new Response(JSON.stringify(v),{headers:{'content-type':'application/json','cache-control':`public,max-age=${ttl}`}}))}catch(_){}
}
async function readAutoState(env){return await readStored(env,'auto_state_v1',AUTO_STATE_KEY)}
async function writeAutoState(env,v){return await writeStored(env,'auto_state_v1',AUTO_STATE_KEY,v,86400)}
async function readAutoLatest(env){return await readStored(env,'auto_latest_v1',AUTO_LATEST_KEY)}
async function writeAutoLatest(env,v){return await writeStored(env,'auto_latest_v1',AUTO_LATEST_KEY,v,604800)}
async function fetchRaceResultDirect(id){
  const src=`https://keirin.netkeiba.com/race/result/?race_id=${id}`;
  const r=await fetchHtml(src),body=new BodyText();await new HTMLRewriter().on('body',body).transform(r).text();
  return parseRaceResult(body.value);
}
async function autoCheckOneResult(env){
  const latest=await readAutoLatest(env),st=await readAutoState(env),now=Date.now();
  let predictions=(latest&&Array.isArray(latest.predictions)&&latest.predictions.length)?latest.predictions.slice():(st&&Array.isArray(st.predictions)?st.predictions.slice():[]);
  if(!predictions.length)return false;
  const target=predictions.find(x=>!x.result&&x.raceId&&x.at&&now-new Date(x.at).getTime()>=40*60*1000&&(!x.resultCheckedAt||now-new Date(x.resultCheckedAt).getTime()>=20*60*1000));
  if(!target)return false;
  target.resultCheckedAt=new Date().toISOString();
  try{
    const rr=await fetchRaceResultDirect(target.raceId);
    if(rr){
      const finish=rr.finish.join('-'),hit=(target.top||[]).some(c=>`${c.a}-${c.b}-${c.c}`===finish),mainHit=!!(target.main&&+target.main.num===+rr.finish[0]),unit=100,stake=(target.top||[]).length*unit,returnAmount=hit?rr.payout:0;
      target.result={finish,payout:rr.payout,unit,stake,returnAmount,profit:returnAmount-stake,hit,mainHit,recordedAt:new Date().toISOString(),auto:true};
      console.log('AUTO_RESULT',target.raceId,finish,hit?'HIT':'MISS',rr.payout);
    }else console.log('AUTO_RESULT_WAIT',target.raceId);
  }catch(e){console.log('AUTO_RESULT_ERR',target.raceId,e?.message||String(e))}
  const ranAt=(latest&&latest.ranAt)||new Date().toISOString();
  await writeAutoLatest(env,{ok:true,ranAt,date:(latest&&latest.date)||(st&&st.date)||'',predictions});
  if(st&&Array.isArray(st.predictions)){
    const idx=st.predictions.findIndex(x=>x.raceId===target.raceId);
    if(idx>=0)st.predictions[idx]=target;
    st.updatedAt=new Date().toISOString();await writeAutoState(env,st);
  }
  return true;
}
function jstDateParts(date){return {y:+date.slice(0,4),m:+date.slice(4,6),d:+date.slice(6,8)}}
function jstIso(date,hh,mm){const p=jstDateParts(date);return `${String(p.y).padStart(4,'0')}-${String(p.m).padStart(2,'0')}-${String(p.d).padStart(2,'0')}T${String(hh).padStart(2,'0')}:${String(mm).padStart(2,'0')}:00+09:00`}
function parseVenueScheduleLinks(links,date,v){
  const out=[],seen=new Set(),prefix=date+v.code;
  for(const item of (links||[])){
    const idm=String(item.href||'').match(/race_id=(\d{12})/),id=idm?idm[1]:'';
    if(!id||!id.startsWith(prefix)||seen.has(id))continue;
    const t=txt(item.v||'');
    const tm=t.match(/(?:\d{1,2}R)?[\s\S]*?発走\s*(\d{1,2}):(\d{2})[\s\S]*?締切\s*(\d{1,2}):(\d{2})[\s\S]*?(\d+)車/);
    if(!tm)continue;
    const race=+id.slice(10,12);if(race<1||race>12)continue;seen.add(id);
    out.push({raceId:id,date,code:v.code,track:v.name,race,start:jstIso(date,+tm[1],+tm[2]),deadline:jstIso(date,+tm[3],+tm[4]),cars:+tm[5],status:'waiting'});
  }
  return out.sort((a,b)=>Date.parse(a.deadline)-Date.parse(b.deadline));
}
function parseVenueSchedule(bodyText,date,v){
  const all=txt(bodyText),out=[],seen=new Set();
  const re=/(\d{1,2})R\s+.{0,260}?発走\s*(\d{1,2}):(\d{2})\s+締切\s*(\d{1,2}):(\d{2})\s+(\d+)車/g;
  for(const m of all.matchAll(re)){
    const race=+m[1];if(race<1||race>12||seen.has(race))continue;seen.add(race);
    out.push({raceId:date+v.code+String(race).padStart(2,'0'),date,code:v.code,track:v.name,race,start:jstIso(date,+m[2],+m[3]),deadline:jstIso(date,+m[4],+m[5]),cars:+m[6],status:'waiting'});
  }
  return out.sort((a,b)=>Date.parse(a.deadline)-Date.parse(b.deadline));
}
async function autoFetchVenueSchedule(date,v){
  // 競輪場ページは複数日分を同時に含むため、race_id付きリンクから当日分だけを抽出する。
  const src=`https://keirin.netkeiba.com/race/course/entry.html?jyo_cd=${v.code}`;
  const r=await fetchHtml(src),links=new LinkCapture(),body=new BodyText();
  const transformed=new HTMLRewriter().on('a[href*="race_id="]',links.a).on('body',body).transform(r);await transformed.text();
  let out=parseVenueScheduleLinks(links.links,date,v);
  if(!out.length)out=parseVenueSchedule(body.value,date,v);
  if(!out.length)throw new Error('schedule parse 0');
  return out;
}
function mergeRaceSchedules(base,items){const m=new Map((base||[]).map(x=>[x.raceId,x]));for(const x of items){const old=m.get(x.raceId)||{};m.set(x.raceId,{...old,...x,status:old.status&&old.status!=='waiting'?old.status:x.status})}return [...m.values()].sort((a,b)=>Date.parse(a.deadline)-Date.parse(b.deadline))}
function refreshQueueStatuses(st,now){
  const pred=new Set((st.predictions||[]).map(x=>x.raceId));
  for(const q of (st.races||[])){
    if(pred.has(q.raceId)){q.status='predicted';continue}
    if(q.status==='entry'&&st.pending&&st.pending.raceId===q.raceId)continue;
    if(Date.parse(q.deadline)<=now){q.status='missed';continue}
    if(q.status==='retry'&&q.retryAfter&&q.retryAfter>now)continue;
    if(!['entry','predicted','missed'].includes(q.status))q.status='waiting';
  }
}
async function autoRun(env){
  const nowDate=new Date(),jst=new Date(nowDate.getTime()+9*3600000),now=nowDate.getTime(),date=`${jst.getUTCFullYear()}${String(jst.getUTCMonth()+1).padStart(2,'0')}${String(jst.getUTCDate()).padStart(2,'0')}`;
  // 15分ごとに結果未反映の自動予想を1件だけ確認。1回1ページでCPU負荷を抑える。
  if(jst.getUTCMinutes()%15===0){const checked=await autoCheckOneResult(env);if(checked)return}
  let st=await readAutoState(env);
  if(!st||st.date!==date||!Array.isArray(st.venues)||!st.venues.length){
    const tr=await apiToday(new URL(`https://local/api/today?date=${date}`)),tj=await tr.json();
    st={date,venues:tj.venues||[],scheduleIndex:0,races:[],phase:'schedule',pending:null,predictions:[],updatedAt:new Date().toISOString()};
    await writeAutoState(env,st);console.log('AUTO_STAGE calendar',JSON.stringify({date,venues:st.venues.length}));return;
  }
  st.races=Array.isArray(st.races)?st.races:[];st.scheduleIndex=Number.isInteger(st.scheduleIndex)?st.scheduleIndex:0;
  // 開催時刻は2会場ずつ取得。5分Cronでも従来の半分以下の時間で締切優先キューを作る。
  // race_idリンクから当日分だけ抽出するため、複数日開催ページでも別日の時刻を混ぜない。
  if(st.races.length===0&&st.scheduleIndex>0)st.scheduleIndex=0;
  if(st.scheduleIndex<st.venues.length){
    const batch=st.venues.slice(st.scheduleIndex,st.scheduleIndex+2);
    const got=await Promise.all(batch.map(async v=>{try{return {v,races:await autoFetchVenueSchedule(date,v)}}catch(e){return {v,races:[],error:e}}}));
    for(const g of got){if(g.races.length){st.races=mergeRaceSchedules(st.races,g.races);console.log('AUTO_STAGE schedule',g.v.name,g.races.length)}else console.log('AUTO_SKIP schedule',g.v.name,g.error?.message||'0 races')}
    st.scheduleIndex+=batch.length;st.phase=st.scheduleIndex>=st.venues.length?'queue':'schedule';st.updatedAt=new Date().toISOString();await writeAutoState(env,st);return;
  }
  refreshQueueStatuses(st,now);
  // entry取得済みのレースがあれば、次のCronでラインを取得して予想を完成させる。
  if(st.pending&&st.pending.raceId){
    const q=st.races.find(x=>x.raceId===st.pending.raceId),deadline=q?Date.parse(q.deadline):Infinity;
    if(deadline-now<=2*60*1000){if(q)q.status='missed';st.pending=null;st.phase='queue';st.updatedAt=new Date().toISOString();await writeAutoState(env,st);console.log('AUTO_SKIP deadline',q?.raceId||'');return}
    try{
      const lineText=await autoFetchLine(st.pending.raceId,st.pending.riders),pred=serverPredict(st.pending.riders,lineText);
      const item={raceId:st.pending.raceId,date,track:st.pending.track,race:st.pending.race,lineText,deadline:q?.deadline||null,start:q?.start||null,...pred,at:new Date().toISOString()};
      st.predictions=(st.predictions||[]).filter(x=>x.raceId!==item.raceId);st.predictions.push(item);st.predictions=st.predictions.slice(-50);if(q)q.status='predicted';
      const prev=await readAutoLatest(env),rolling=(prev&&Array.isArray(prev.predictions)?prev.predictions:[]).filter(x=>x.raceId!==item.raceId),old=prev&&Array.isArray(prev.predictions)?prev.predictions.find(x=>x.raceId===item.raceId):null;if(old&&old.result)item.result=old.result;rolling.push(item);await writeAutoLatest(env,{ok:true,ranAt:new Date().toISOString(),date,predictions:rolling.slice(-50)});console.log('AUTO_STAGE predict',JSON.stringify({raceId:item.raceId,track:item.track,race:item.race,deadline:item.deadline}));
    }catch(e){if(q){q.status='retry';q.retryAfter=now+5*60*1000;q.attempts=(q.attempts||0)+1}console.log('AUTO_SKIP line',st.pending.raceId,e?.message||String(e))}
    st.pending=null;st.phase='queue';st.updatedAt=new Date().toISOString();await writeAutoState(env,st);return;
  }
  // 未予想の未来レースを締切時刻の近い順に選ぶ。5分Cronで次回ライン取得する余裕を残す。
  const minLead=7*60*1000,maxAhead=120*60*1000;
  const candidates=st.races.filter(q=>q.status!=='predicted'&&q.status!=='missed'&&Date.parse(q.deadline)-now>minLead&&Date.parse(q.deadline)-now<=maxAhead&&(!q.retryAfter||q.retryAfter<=now)).sort((a,b)=>Date.parse(a.deadline)-Date.parse(b.deadline));
  const target=candidates[0];
  if(!target){st.phase='queue';st.updatedAt=new Date().toISOString();await writeAutoState(env,st);console.log('AUTO_WAIT queue',JSON.stringify({waiting:st.races.filter(x=>x.status==='waiting').length}));return}
  try{
    const riders=await autoFetchEntryRiders(target.raceId);st.pending={raceId:target.raceId,track:target.track,race:target.race,riders};target.status='entry';st.phase='line';console.log('AUTO_STAGE entry',JSON.stringify({raceId:target.raceId,track:target.track,race:target.race,deadline:target.deadline,riders:riders.length}));
  }catch(e){target.status='retry';target.retryAfter=now+10*60*1000;target.attempts=(target.attempts||0)+1;console.log('AUTO_SKIP entry',target.raceId,e?.message||String(e))}
  st.updatedAt=new Date().toISOString();await writeAutoState(env,st);
}

async function apiAutoStatus(env){
  const latest=await readAutoLatest(env),st=await readAutoState(env),now=Date.now();
  const predictions=(latest&&Array.isArray(latest.predictions)&&latest.predictions.length)?latest.predictions:(st&&Array.isArray(st.predictions)?st.predictions:[]);
  const races=st&&Array.isArray(st.races)?st.races:[],predSet=new Set(predictions.map(x=>x.raceId));
  const next=races.filter(x=>!predSet.has(x.raceId)&&Date.parse(x.deadline)>now).sort((a,b)=>Date.parse(a.deadline)-Date.parse(b.deadline))[0]||null;
  const queueInfo={totalVenues:st?.venues?.length||0,scheduledVenues:new Set(races.map(x=>x.code)).size,totalRaces:races.length,predicted:races.filter(x=>predSet.has(x.raceId)||x.status==='predicted').length,waiting:races.filter(x=>!predSet.has(x.raceId)&&Date.parse(x.deadline)>now).length,missed:races.filter(x=>x.status==='missed'||(!predSet.has(x.raceId)&&Date.parse(x.deadline)<=now)).length,next:next?{raceId:next.raceId,track:next.track,race:next.race,deadline:next.deadline,status:next.status}:null};
  if(predictions.length)return json({ok:true,ranAt:(latest&&latest.ranAt)||(st&&st.updatedAt)||null,date:(latest&&latest.date)||(st&&st.date)||'',predictions,queueInfo});
  return json({ok:false,message:'まだ自動予想がありません。締切優先キューから順に処理します。',ranAt:st?.updatedAt||null,date:st?.date||'',predictions:[],queueInfo,state:st?{date:st.date,phase:st.phase,scheduleIndex:st.scheduleIndex,updatedAt:st.updatedAt}:null});
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(autoRun(env));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/today") return await apiToday(url);
      if (url.pathname === "/api/entry") return await apiEntry(url);
      if (url.pathname === "/api/race-result") return await apiRaceResult(url);
      if (url.pathname === "/api/auto-status") return await apiAutoStatus(env);
      if (url.pathname === "/favicon.ico") return new Response(null, { status: 204 });
      return new Response(APP_HTML, {
        headers: {
          "content-type": "text/html; charset=utf-8",
          "cache-control": "no-store"
        }
      });
    } catch (e) {
      return json({ error: e?.message || String(e) }, 500);
    }
  }
};
