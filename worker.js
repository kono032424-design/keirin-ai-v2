const VENUES = {
  "11":"函館","12":"青森","13":"いわき平","21":"弥彦","22":"前橋","23":"取手","24":"宇都宮","25":"大宮","26":"西武園","27":"京王閣","28":"立川",
  "31":"松戸","32":"千葉","34":"川崎","35":"平塚","36":"小田原","37":"伊東温泉","38":"静岡","42":"名古屋","43":"岐阜","44":"大垣","45":"豊橋","46":"富山","47":"松阪","48":"四日市",
  "51":"福井","53":"奈良","54":"向日町","55":"和歌山","56":"岸和田","61":"玉野","62":"広島","63":"防府","71":"高松","73":"小松島","74":"高知","75":"松山","81":"小倉","83":"久留米","84":"武雄","85":"佐世保","86":"別府","87":"熊本"
};
const json=(x,status=200)=>new Response(JSON.stringify(x),{status,headers:{"content-type":"application/json; charset=utf-8","cache-control":"no-store"}});
const txt=x=>String(x||'').replace(/\s+/g,' ').trim();
class BodyText { constructor(){this.value=''} text(t){this.value+=t.text+' '} }
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

const APP_HTML = "<!doctype html>\n<html lang=\"ja\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1,viewport-fit=cover\"><meta name=\"theme-color\" content=\"#0b1220\"><title>競輪AI予想 V2</title>\n<style>\n:root{--bg:#09111d;--card:#121d2c;--card2:#17263a;--text:#f6f8fb;--muted:#91a3bc;--line:#2b3d57;--blue:#42b7ff;--green:#54d58c;--yellow:#ffd166;--red:#ff7070}\n*{box-sizing:border-box}body{margin:0;background:linear-gradient(180deg,#07101a,#0d1725 45%,#09111c);color:var(--text);font-family:-apple-system,BlinkMacSystemFont,\"Segoe UI\",\"Noto Sans JP\",sans-serif}.wrap{max-width:980px;margin:auto;padding:14px 12px 70px}h1{font-size:24px;margin:8px 0 3px}.sub,.muted{color:var(--muted)}.sub{font-size:12px;margin-bottom:12px}.card{background:rgba(18,29,44,.97);border:1px solid var(--line);border-radius:16px;padding:13px;margin:10px 0;box-shadow:0 10px 30px rgba(0,0,0,.16)}.row{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}.row2{display:grid;grid-template-columns:1fr 1fr;gap:8px}label{display:block;font-size:11px;color:var(--muted);margin:2px 0 5px}input,select,button{width:100%;padding:11px;border-radius:11px;border:1px solid var(--line);background:#0a1422;color:var(--text);font-size:15px}button{font-weight:800;background:#16314b;cursor:pointer}.primary{border:0;background:linear-gradient(135deg,#0878b9,#334fb8)}.good{background:#15482e;border-color:#26794f}.status{font-size:12px;margin-top:8px;min-height:18px}.ok{color:var(--green)}.err{color:var(--red)}.pills{display:flex;gap:6px;flex-wrap:wrap;margin-top:9px}.pill{border:1px solid var(--line);border-radius:999px;padding:5px 8px;font-size:11px;color:#cbd7e7}.grid{overflow-x:auto}.rider{min-width:860px;display:grid;grid-template-columns:48px 1.6fr 86px 64px 64px 64px 52px 52px 52px 70px;gap:5px;margin:5px 0;align-items:center}.hdr{font-size:10px;color:var(--muted)}.num{text-align:center;font-weight:900;border-radius:9px;padding:10px 0}.n1{background:#fff;color:#111}.n2{background:#171717}.n3{background:#dc3f3f}.n4{background:#3864cc}.n5{background:#ebc439;color:#111}.n6{background:#4d9955}.n7{background:#e884ac;color:#111}.n8{background:#e88532}.n9{background:#7650a2}.scores{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.score{background:var(--card2);border-radius:12px;padding:11px}.score b{font-size:23px}.S{color:var(--red)}.A{color:var(--yellow)}.B{color:#81cfff}table{border-collapse:collapse;width:100%;font-size:13px}th,td{padding:8px 5px;border-bottom:1px solid var(--line);text-align:left}th{color:var(--muted)}.combo{font-size:17px;font-weight:900}.hidden{display:none}.footer{font-size:10px;line-height:1.6;color:#74859d;margin-top:14px}.badge{display:inline-block;padding:4px 7px;border-radius:7px;background:#263a55;font-size:11px}.source{font-size:11px;color:#8194ad;margin-top:6px}.statgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.historyItem{background:var(--card2);border-radius:12px;padding:10px;margin:7px 0}.hit{color:var(--green);font-weight:900}.miss{color:var(--muted);font-weight:900}\n@media(max-width:650px){.row{grid-template-columns:1fr 1fr}.scores{grid-template-columns:1fr}.wrap{padding:10px 9px 60px}}\n</style></head><body><div class=\"wrap\">\n<h1>🚴 競輪AI予想 V2</h1><div class=\"sub\">今日の開催 → 出走表自動取得 → AI採点 → 3連単候補</div>\n<div class=\"card\"><b>① 今日のレースを選ぶ</b><div class=\"row\" style=\"margin-top:10px\">\n<div><label>日付</label><input id=\"date\" type=\"date\"></div><div><label>競輪場</label><select id=\"track\"><option value=\"\">取得してください</option></select></div><div><label>R</label><select id=\"race\"></select></div><div><label>データ</label><button id=\"todayBtn\">今日の開催を取得</button></div></div>\n<button class=\"primary\" id=\"entryBtn\" style=\"margin-top:9px\">出走表を自動取得</button><div id=\"autoStatus\" class=\"status muted\"></div><div class=\"source\">データ取込は試作版。最終確認は主催者発表を優先してください。</div></div>\n<div class=\"card\"><b>② ライン・並び</b><label style=\"margin-top:8px\">例：1-4-8 / 3-9 / 6-2 / 5 / 7</label><input id=\"lines\" placeholder=\"並びが取れない場合だけ入力\"><div class=\"pills\"><span class=\"pill\">競走得点 34%</span><span class=\"pill\">勝率 18%</span><span class=\"pill\">2連対 14%</span><span class=\"pill\">3連対 10%</span><span class=\"pill\">B 8%</span><span class=\"pill\">捲り/逃げ 8%</span><span class=\"pill\">S/H 4%</span><span class=\"pill\">ライン補正</span></div></div>\n<div class=\"card\"><b>③ 選手データ</b><div class=\"muted\" style=\"font-size:11px;margin:5px 0 9px\">自動取得後も数値は修正できます。</div><div class=\"grid\"><div class=\"rider hdr\"><div>車</div><div>選手</div><div>得点</div><div>勝%</div><div>2連%</div><div>3連%</div><div>S</div><div>H</div><div>B</div><div>脚質</div></div><div id=\"riders\"></div></div><button class=\"primary\" id=\"predictBtn\" style=\"margin-top:10px\">AI予想する</button></div>\n<div id=\"result\" class=\"card hidden\"><div class=\"scores\"><div class=\"score\"><small class=\"muted\">勝負度</small><br><b id=\"grade\">-</b><div id=\"gradeNote\" class=\"muted\"></div></div><div class=\"score\"><small class=\"muted\">◎ 本命</small><br><b id=\"main\">-</b><div id=\"mainP\" class=\"muted\"></div></div><div class=\"score\"><small class=\"muted\">上位3車集中度</small><br><b id=\"focus\">-</b><div class=\"muted\">軸の絞りやすさ</div></div></div><h3>AIランキング</h3><div style=\"overflow:auto\"><table><thead><tr><th>印</th><th>車</th><th>選手</th><th>AI</th><th>1着推定</th><th>脚質</th></tr></thead><tbody id=\"rank\"></tbody></table></div><h3>3連単 上位6点</h3><div style=\"overflow:auto\"><table><thead><tr><th>#</th><th>買い目</th><th>推定確率</th><th>評価</th></tr></thead><tbody id=\"combos\"></tbody></table></div><div class=\"row2\" style=\"margin-top:10px\"><button class=\"good\" id=\"saveBtn\">予想保存</button><button id=\"copyBtn\">note用コピー</button></div></div>\n<div class=\"card\"><b>④ 予想成績・結果入力</b><div class=\"muted\" style=\"font-size:11px;margin:5px 0 9px\">保存した予想に実際の結果を記録します。初期設定は上位6点×各100円＝600円です。</div><div class=\"row\"><div><label>保存レース</label><select id=\"resultRace\"></select></div><div><label>1着</label><select id=\"finish1\"></select></div><div><label>2着</label><select id=\"finish2\"></select></div><div><label>3着</label><select id=\"finish3\"></select></div></div><div class=\"row2\" style=\"margin-top:8px\"><div><label>3連単払戻（100円あたり）</label><input id=\"payout\" type=\"number\" min=\"0\" step=\"10\" placeholder=\"例：12840\"></div><div><label>1点あたり購入額</label><input id=\"stakePerBet\" type=\"number\" min=\"100\" step=\"100\" value=\"100\"></div></div><button class=\"good\" id=\"recordBtn\" style=\"margin-top:9px\">結果を記録</button><h3>累計成績</h3><div class=\"statgrid\"><div class=\"score\"><small class=\"muted\">検証済み</small><br><b id=\"testedCount\">0</b></div><div class=\"score\"><small class=\"muted\">本命1着率</small><br><b id=\"mainHitRate\">0%</b></div><div class=\"score\"><small class=\"muted\">3連単6点的中率</small><br><b id=\"trifectaHitRate\">0%</b></div><div class=\"score\"><small class=\"muted\">購入額</small><br><b id=\"totalStake\">¥0</b></div><div class=\"score\"><small class=\"muted\">払戻</small><br><b id=\"totalReturn\">¥0</b></div><div class=\"score\"><small class=\"muted\">回収率</small><br><b id=\"roi\">0%</b></div></div><div id=\"history\"></div></div><div class=\"card\"><b>保存状況</b><div class=\"row\" style=\"margin-top:9px\"><div><small class=\"muted\">保存予想</small><div id=\"saveCount\" style=\"font-size:22px;font-weight:900\">0</div></div><div><small class=\"muted\">バージョン</small><div style=\"font-size:18px;font-weight:900\">V2 AUTO FIX5.1</div></div></div></div>\n<div class=\"footer\">※統計モデルの参考値です。的中や利益を保証するものではありません。<br>※公開サイトの自動取込は相手サイトの仕様変更で動かなくなる場合があります。商用運用では利用条件に適合したデータ供給方法へ切り替えてください。</div>\n</div><script>\nconst $=x=>document.getElementById(x); let latest=null;\nconst venueFallback={\"11\":\"函館\",\"12\":\"青森\",\"13\":\"いわき平\",\"21\":\"弥彦\",\"22\":\"前橋\",\"23\":\"取手\",\"24\":\"宇都宮\",\"25\":\"大宮\",\"26\":\"西武園\",\"27\":\"京王閣\",\"28\":\"立川\",\"31\":\"松戸\",\"32\":\"千葉\",\"34\":\"川崎\",\"35\":\"平塚\",\"36\":\"小田原\",\"37\":\"伊東温泉\",\"38\":\"静岡\",\"42\":\"名古屋\",\"43\":\"岐阜\",\"44\":\"大垣\",\"45\":\"豊橋\",\"46\":\"富山\",\"47\":\"松阪\",\"48\":\"四日市\",\"51\":\"福井\",\"53\":\"奈良\",\"54\":\"向日町\",\"55\":\"和歌山\",\"56\":\"岸和田\",\"61\":\"玉野\",\"62\":\"広島\",\"63\":\"防府\",\"71\":\"高松\",\"73\":\"小松島\",\"74\":\"高知\",\"75\":\"松山\",\"81\":\"小倉\",\"83\":\"久留米\",\"84\":\"武雄\",\"85\":\"佐世保\",\"86\":\"別府\",\"87\":\"熊本\"};\nfunction init(){let d=new Date(),z=n=>String(n).padStart(2,'0');$('date').value=`${d.getFullYear()}-${z(d.getMonth()+1)}-${z(d.getDate())}`;for(let i=1;i<=12;i++)$('race').innerHTML+=`<option value=\"${i}\">${i}R</option>`;render([]);stats();}\nfunction render(data){$('riders').innerHTML='';(data.length?data:Array.from({length:7},(_,i)=>({num:i+1}))).forEach(x=>{let d=document.createElement('div');d.className='rider';d.dataset.num=x.num;d.innerHTML=`<div class=\"num n${x.num}\">${x.num}</div><input class=\"name\" value=\"${esc(x.name||'')}\" placeholder=\"選手\"><input class=\"pts\" type=\"number\" step=\".01\" value=\"${x.score??''}\"><input class=\"win\" type=\"number\" step=\".1\" value=\"${x.win??''}\"><input class=\"top2\" type=\"number\" step=\".1\" value=\"${x.top2??''}\"><input class=\"top3\" type=\"number\" step=\".1\" value=\"${x.top3??''}\"><input class=\"s\" type=\"number\" value=\"${x.s??''}\"><input class=\"h\" type=\"number\" value=\"${x.h??''}\"><input class=\"b\" type=\"number\" value=\"${x.b??''}\"><select class=\"style\"><option ${x.style==='逃'?'selected':''}>逃</option><option ${x.style==='両'?'selected':''}>両</option><option ${x.style==='追'?'selected':''}>追</option></select>`;$('riders').appendChild(d)});}\nfunction esc(s){return String(s).replace(/[&<>\"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[m]))}\nasync function today(){setStatus('開催一覧を取得中…');try{let d=$('date').value.replaceAll('-','');let r=await fetch(`/api/today?date=${d}`);let j=await r.json();if(!r.ok)throw Error(j.error||'取得失敗');$('track').innerHTML='';j.venues.forEach(v=>$('track').innerHTML+=`<option value=\"${v.code}\">${v.name}${v.grade?' '+v.grade:''}</option>`);setStatus(`${j.venues.length}場を取得しました`,'ok')}catch(e){setStatus('開催取得に失敗：'+e.message,'err')}}\nasync function entry(){let code=$('track').value;if(!code){setStatus('先に開催一覧を取得してください','err');return}setStatus('出走表を取得中…');try{let date=$('date').value.replaceAll('-',''),race=String($('race').value).padStart(2,'0');let id=date+code+race;let r=await fetch(`/api/entry?race_id=${id}`);let j=await r.json();if(!r.ok)throw Error(j.error||'取得失敗');render(j.riders);$('lines').value=j.lineText||'';setStatus(`${j.track||venueFallback[code]||''} ${$('race').value}R：${j.riders.length}車を自動取得${j.lineText?'・ラインも取得':'・ラインは手入力'}`,'ok');predict()}catch(e){setStatus('出走表取得に失敗：'+e.message,'err')}}\nfunction setStatus(t,c='muted'){$('autoStatus').className='status '+c;$('autoStatus').textContent=t}\nfunction lines(){let groups=$('lines').value.trim().split('/').map(x=>x.trim()).filter(Boolean).map(x=>x.split('-').map(Number).filter(Boolean)),pos={};groups.forEach((g,gi)=>g.forEach((n,i)=>pos[n]={g:gi,i,len:g.length}));return{groups,pos}}\nfunction data(){return[...document.querySelectorAll('#riders .rider')].map(r=>({num:+r.dataset.num,name:r.querySelector('.name').value||('選手'+r.dataset.num),pts:+r.querySelector('.pts').value||0,win:+r.querySelector('.win').value||0,top2:+r.querySelector('.top2').value||0,top3:+r.querySelector('.top3').value||0,s:+r.querySelector('.s').value||0,h:+r.querySelector('.h').value||0,b:+r.querySelector('.b').value||0,style:r.querySelector('.style').value}))}\nfunction nrm(a,v){let mi=Math.min(...a),ma=Math.max(...a);return ma===mi?.5:(v-mi)/(ma-mi)}\nfunction predict(){let R=data();if(!R.length||R.every(x=>!x.pts)){alert('出走表を取得するかデータを入力してね');return}let L=lines(),C={pts:R.map(x=>x.pts),win:R.map(x=>x.win),top2:R.map(x=>x.top2),top3:R.map(x=>x.top3),b:R.map(x=>x.b),s:R.map(x=>x.s),h:R.map(x=>x.h)};R.forEach(x=>{let attack=x.style==='逃'?1:x.style==='両'?.6:.15;let sc=34*nrm(C.pts,x.pts)+18*nrm(C.win,x.win)+14*nrm(C.top2,x.top2)+10*nrm(C.top3,x.top3)+8*nrm(C.b,x.b)+4*nrm(C.s,x.s)+4*nrm(C.h,x.h)+8*attack;let p=L.pos[x.num];if(p){if(p.i===0&&(x.style==='逃'||x.style==='両'))sc+=4.3;if(p.i===1)sc+=4;if(p.i>=2)sc+=1.3;if(p.len>=3)sc+=1.0}x.ai=sc});let mx=Math.max(...R.map(x=>x.ai)),T=13,E=R.map(x=>Math.exp((x.ai-mx)/T)),sum=E.reduce((a,b)=>a+b,0);R.forEach((x,i)=>x.p=E[i]/sum);let rank=[...R].sort((a,b)=>b.ai-a.ai),comb=[];R.forEach(a=>R.forEach(b=>R.forEach(c=>{if(new Set([a.num,b.num,c.num]).size<3)return;let p=a.p*(b.p/(1-a.p))*(c.p/(1-a.p-b.p));let A=L.pos[a.num],B=L.pos[b.num],C2=L.pos[c.num];if(A&&B&&A.g===B.g)p*=1.15;if(B&&C2&&B.g===C2.g)p*=1.08;if(A&&B&&C2&&A.g===B.g&&B.g===C2.g)p*=1.08;comb.push({a:a.num,b:b.num,c:c.num,p})})));let sp=comb.reduce((s,x)=>s+x.p,0);comb.forEach(x=>x.p/=sp);comb.sort((a,b)=>b.p-a.p);let top=comb.slice(0,6),focus=rank.slice(0,3).reduce((s,x)=>s+x.p,0),gap=rank[0].ai-rank[1].ai,g='B';if(rank[0].p>=.28&&gap>=6&&focus>=.68)g='S';else if(rank[0].p>=.21&&gap>=3&&focus>=.60)g='A';$('grade').textContent=g+'評価';$('grade').className=g;$('gradeNote').textContent=`軸差 ${gap.toFixed(1)}pt`;$('main').textContent=`${rank[0].num}番 ${rank[0].name}`;$('mainP').textContent=`1着推定 ${(rank[0].p*100).toFixed(1)}%`;$('focus').textContent=(focus*100).toFixed(1)+'%';let M=['◎','○','▲','△','☆'];$('rank').innerHTML=rank.map((x,i)=>`<tr><td><b>${M[i]||''}</b></td><td>${x.num}</td><td>${esc(x.name)}</td><td>${x.ai.toFixed(1)}</td><td>${(x.p*100).toFixed(1)}%</td><td>${x.style}</td></tr>`).join('');$('combos').innerHTML=top.map((x,i)=>`<tr><td>${i+1}</td><td class=\"combo\">${x.a}-${x.b}-${x.c}</td><td>${(x.p*100).toFixed(2)}%</td><td>${i<2?'本線':i<4?'対抗':'押さえ'}</td></tr>`).join('');latest={date:$('date').value,track:$('track').selectedOptions[0]?.textContent||'',race:+$('race').value,grade:g,rank,top,lines:$('lines').value,at:new Date().toISOString()};$('result').classList.remove('hidden');}\nfunction save(){if(!latest)return;let a=JSON.parse(localStorage.getItem('keirinV2')||'[]');latest.id=latest.id||Date.now();a.push(JSON.parse(JSON.stringify(latest)));localStorage.setItem('keirinV2',JSON.stringify(a));stats();alert('予想を保存しました')}\nfunction saved(){return JSON.parse(localStorage.getItem('keirinV2')||'[]')}\nfunction yen(n){return '¥'+Math.round(n||0).toLocaleString('ja-JP')}\nfunction resultOptions(){let a=saved(),sel=$('resultRace');if(!sel)return;let cur=sel.value;sel.innerHTML='<option value=\"\">保存レースを選択</option>'+a.map((x,i)=>`<option value=\"${i}\">${x.date} ${esc(x.track)} ${x.race}R${x.result?' ✓':''}</option>`).join('');if(cur!==''&&a[+cur])sel.value=cur;let nums='<option value=\"\">車番</option>'+Array.from({length:9},(_,i)=>`<option value=\"${i+1}\">${i+1}</option>`).join('');['finish1','finish2','finish3'].forEach(id=>{if($(id))$(id).innerHTML=nums})}\nfunction stats(){let a=saved();$('saveCount').textContent=a.length;resultOptions();let done=a.filter(x=>x.result),tested=done.length,mainHits=done.filter(x=>x.result.mainHit).length,hits=done.filter(x=>x.result.hit).length,stake=done.reduce((s,x)=>s+(x.result.stake||0),0),ret=done.reduce((s,x)=>s+(x.result.returnAmount||0),0);if($('testedCount')){$('testedCount').textContent=tested;$('mainHitRate').textContent=tested?(mainHits/tested*100).toFixed(1)+'%':'0%';$('trifectaHitRate').textContent=tested?(hits/tested*100).toFixed(1)+'%':'0%';$('totalStake').textContent=yen(stake);$('totalReturn').textContent=yen(ret);$('roi').textContent=stake?(ret/stake*100).toFixed(1)+'%':'0%';$('history').innerHTML=done.slice().reverse().slice(0,10).map(x=>`<div class=\"historyItem\"><b>${esc(x.date)} ${esc(x.track)} ${x.race}R</b>　<span class=\"${x.result.hit?'hit':'miss'}\">${x.result.hit?'的中':'不的中'}</span><br><span class=\"muted\">${x.result.finish} / 購入 ${yen(x.result.stake)} / 払戻 ${yen(x.result.returnAmount)} / 収支 ${x.result.profit>=0?'+':''}${yen(x.result.profit)}</span></div>`).join('')}}\nfunction recordResult(){let raw=$('resultRace').value;if(raw===''){alert('保存レースを選んでね');return}let idx=+raw,f1=+$('finish1').value,f2=+$('finish2').value,f3=+$('finish3').value,payout=+$('payout').value||0,unit=+$('stakePerBet').value||100,a=saved();if(!a[idx]){alert('保存レースを選んでね');return}if(!f1||!f2||!f3||new Set([f1,f2,f3]).size<3){alert('1着・2着・3着を正しく選んでね');return}let x=a[idx],key=`${f1}-${f2}-${f3}`,hit=(x.top||[]).some(c=>`${c.a}-${c.b}-${c.c}`===key),mainHit=!!(x.rank&&x.rank[0]&&x.rank[0].num===f1),stake=(x.top||[]).length*unit,returnAmount=hit?payout*(unit/100):0;x.result={finish:key,payout,unit,stake,returnAmount,profit:returnAmount-stake,hit,mainHit,recordedAt:new Date().toISOString()};a[idx]=x;localStorage.setItem('keirinV2',JSON.stringify(a));stats();alert(hit?'🎯 3連単6点 的中！':'結果を記録しました')}\nfunction copy(){if(!latest)return;let r=latest.rank,c=latest.top,t=`🚴 競輪AI予想\\n${latest.track} ${latest.race}R\\n勝負度：${latest.grade}\\nライン：${latest.lines||'未入力'}\\n\\n◎ ${r[0].num} ${r[0].name}\\n○ ${r[1].num} ${r[1].name}\\n▲ ${r[2].num} ${r[2].name}\\n\\n【3連単 上位6点】\\n${c.map((x,i)=>`${i+1}. ${x.a}-${x.b}-${x.c}（推定${(x.p*100).toFixed(2)}%）`).join('\\n')}\\n\\n※的中・利益を保証するものではありません。`;navigator.clipboard.writeText(t).then(()=>alert('コピーしました'))}\n$('todayBtn').onclick=today;$('entryBtn').onclick=entry;$('predictBtn').onclick=predict;$('saveBtn').onclick=save;$('copyBtn').onclick=copy;$('recordBtn').onclick=recordResult;init();\n</script></body></html>";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    try {
      if (url.pathname === "/api/today") return await apiToday(url);
      if (url.pathname === "/api/entry") return await apiEntry(url);
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
