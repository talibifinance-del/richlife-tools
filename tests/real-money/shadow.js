// runs the REAL calc() of a tool file in a fake DOM; returns the element map
const fs=require("fs");
function el(){const cl={_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},toggle(c,f){f===undefined?(this._s.has(c)?this._s.delete(c):this._s.add(c)):(f?this._s.add(c):this._s.delete(c))},contains(c){return this._s.has(c)}};
 return {querySelector:()=>null,querySelectorAll:()=>[],insertBefore(){},appendChild(){},firstChild:null,setAttribute(){},getAttribute(){},removeAttribute(){},value:"",textContent:"",innerHTML:"",className:"",hidden:true,checked:false,style:{},addEventListener(){},selectionStart:0,setSelectionRange(){},classList:cl,closest(){return el()},getBoundingClientRect(){return {left:0,top:0,width:100,height:100}},parentNode:{classList:cl,insertBefore(){}}};}
function run(file,startMarker,endMarker,vals,extra){
  const html=fs.readFileSync(file,"utf8");
  const s=html.indexOf(startMarker), e=html.indexOf(endMarker,s);
  if(s<0||e<0) throw new Error("markers not found "+startMarker+" / "+endMarker);
  const app=html.slice(s,e);
  const ids={};
  for(const m of html.matchAll(/id="([^"]+)"/g)) ids[m[1]]=el();
  for(const m of html.matchAll(/<input id="([^"]+)"[^>]*value="([^"]*)"/g)) ids[m[1]].value=m[2];
  for(const k in vals) ids[k].value=String(vals[k]);
  global.document={getElementById:i=>ids[i]||null,addEventListener(){},querySelectorAll:()=>[],querySelector:()=>null,createElement:()=>el(),readyState:"complete",body:el()};
  global.window=global; global.location={hash:"",pathname:"/",search:"",origin:""}; global.history={replaceState(){}};
  global.localStorage={getItem(){return null},setItem(){},removeItem(){}};
  global.syncLive=()=>{}; global.fetch=async()=>({ok:false,status:500});
  global.__ids=ids;
  (0,eval)(app+"\n;"+(extra||"calc();"));
  return ids;
}
const t=e=>String(e.textContent||e.innerHTML||"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim();
const n=s=>{const m=String(s).match(/-?[\d,]*\.?\d+/);return m?+m[0].replace(/,/g,""):NaN;};
module.exports={run,t,n};
