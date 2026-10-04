const fs=require("fs");
const html=fs.readFileSync(require("path").join(__dirname,"../../car/index.html"),"utf8");
const app=html.slice(html.indexOf("const fmt=new Intl"),html.indexOf("// save / share"));
function run(o){
  const ids={};
  for(const m of html.matchAll(/id="([^"]+)"/g)) ids[m[1]]={querySelector:()=>null,insertBefore(){},firstChild:null,setAttribute(){},getAttribute(){},value:"",textContent:"",innerHTML:"",className:"",hidden:true,checked:false,readOnly:false,style:{},addEventListener(){},selectionStart:0,setSelectionRange(){},classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},toggle(c,f){f===undefined?(this._s.has(c)?this._s.delete(c):this._s.add(c)):(f?this._s.add(c):this._s.delete(c))},contains(c){return this._s.has(c)}},parentNode:{classList:{_s:new Set(),add(c){this._s.add(c)},remove(c){this._s.delete(c)},toggle(c,f){f===undefined?(this._s.has(c)?this._s.delete(c):this._s.add(c)):(f?this._s.add(c):this._s.delete(c))},contains(c){return this._s.has(c)}}}};
  for(const m of html.matchAll(/<input id="([^"]+)"[^>]*value="([^"]*)"/g)) ids[m[1]].value=m[2];
  /* every run starts clean. These are module globals, so leaving a previous
     run's toggles in place quietly tested a state the caller never asked for. */
  let first=true; global.__kmc=false; global.__ins=null; global.__nd=false; global.__cp=false;
  for(const k in o){ if(k==="ownRun") ids[k].checked=o[k]; else if(k==="firstCar") first=o[k]; else if(k==="kmByCommute") global.__kmc=o[k]; else if(k==="insType") global.__ins=o[k]; else if(k==="newDriver") global.__nd=o[k]; else if(k==="cleanPol") global.__cp=o[k]; else ids[k].value=String(o[k]); }
  global.__first=first;
  global.document={getElementById:i=>ids[i]||null,addEventListener(){},querySelectorAll:()=>[],createElement:()=>({style:{},setAttribute(){},appendChild(){}}),readyState:"complete"};
  global.syncLive=()=>{};
  eval(app+"\nfirstCar=global.__first;kmByCommute=!!global.__kmc;insType=global.__ins||\"full\";newDriver=!!global.__nd;cleanPol=!!global.__cp;\ncalc();");
  return ids;
}
const t=e=>(e.textContent||e.innerHTML).replace(/<[^>]+>/g,"").replace(/\s+/g," ").trim();
const n=s=>+String(s).replace(/[^\d.]/g,"");
module.exports={run,t,n};
if(require.main===module){
  console.log("=== HER DEMO: 12,000 net / 50,000 capital / 1,000 km ===");
  let r=run({});
  for(const lv of [["10","זהיר"],["15","מאוזן"],["20","על הקצה"]])
    console.log("  "+lv[1].padEnd(9)+" תקציב "+t(r["b"+lv[0]]).padStart(9)+"  אחזקה "+t(r["r"+lv[0]]).padStart(10)+
      "  להחזר "+t(r["p"+lv[0]]).padStart(8)+"  הלוואה "+t(r["l"+lv[0]]).padStart(9)+"  רכב עד "+t(r["m"+lv[0]]).padStart(9));
  console.log("\n  estimated upkeep fields: דלק "+r.fuel.value+" · ביטוח "+r.insur.value+" · טיפולים "+r.maint.value);
  console.log("  capIns: "+t(r.capIns));

  console.log("\n=== INVARIANT: a car AT the 15% ceiling, recommended down, must pass 4/4 ===");
  const profs=[
    {income:"12,000",capital:"50,000",km:"1,000"},
    {income:"12,000",capital:"50,000",km:"2,500"},
    {income:"25,000",capital:"30,000",km:"1,500"},
    {income:"9,000", capital:"120,000",km:"800"},
    {income:"40,000",capital:"20,000",km:"2,000"},
    {income:"18,000",capital:"200,000",km:"1,200"},
    {income:"12,000",capital:"50,000",km:"1,000",tradein:"25,000"},
    {income:"8,000", capital:"30,000",km:"1,200"},
  ];
  let bad=0;
  for(const pr of profs){
    const b=run(Object.assign({term:"48",rate:"6.5"},pr));
    const ceil=Math.floor(n(t(b.m15))), dn=Math.round(n(t(b.d15)));
    if(ceil<=0){ console.log("  n/a   income "+pr.income+" km "+pr.km+" -> no car fits: "+t(b.capIns).slice(0,60)+"..."); continue; }
    const at=run(Object.assign({term:"48",rate:"6.5",price:String(ceil),down:String(Math.min(dn,ceil))},pr));
    const fails=t(at.rules).split("🚩").length-1;
    if(fails) {bad++; console.log("   "+t(at.rules));}
    console.log((fails?"  FAIL":"  PASS")+"  income "+pr.income.padStart(7)+" km "+String(pr.km).padStart(5)+
      (pr.tradein?" trade "+pr.tradein:"")+" -> ceiling "+String(ceil).padStart(7)+
      "  total "+t(at.tTot).padStart(9)+" ("+t(at.tTotS)+")");
  }
  console.log("\n=== MONOTONICITY: every car BELOW the ceiling must also pass ===");
  const b=run({term:"48",rate:"6.5"}); const ceil=Math.floor(n(t(b.m15))), dn=Math.round(n(t(b.d15)));
  let mono=0;
  for(let f=0.2;f<=1.0001;f+=0.1){
    const P=Math.floor(ceil*f), D=Math.min(dn,P);
    const at=run({term:"48",rate:"6.5",price:String(P),down:String(D)});
    const fails=t(at.rules).split("🚩").length-1;
    if(fails){mono++;console.log("  FAIL at "+Math.round(f*100)+"% of ceiling ("+P+"): "+t(at.rules));}
  }
  console.log(mono?"  "+mono+" FAILURES":"  every price from 20% to 100% of the ceiling passes");
  console.log("\n"+((bad+mono)?"PROBLEMS FOUND":"ALL CONSISTENT"));
}
