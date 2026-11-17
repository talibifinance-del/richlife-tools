const {run,t,n}=require("./shadow.js");
const F=process.argv[2], RVB=process.argv[3];
const go=(v,pti)=>run(F,"const fmt=new Intl","// save / share",v,(pti?"PTI="+pti+";":"")+"calc();");
let fails=0;const ok=(c,m)=>{console.log((c?"  ✓ ":"  ✗ ")+m);if(!c)fails++;};
let r=go({});
console.log("DEFAULTS:",t(r.maxNum),"|",t(r.gates),"|",t(r.gateMsg));
console.log("  lever:",t(r.lever)); console.log("  deal:",t(r.deal)); console.log("  month:",t(r.month)); console.log("  comfort:",t(r.comfort));
// 1. same engine as rent-vs-buy: eval its maxPrice on the same inputs
const fs=require("fs");const h=fs.readFileSync(RVB,"utf8");
const s=h.indexOf("const BR_SINGLE"),e=h.indexOf("function simulate");
const rvb=new Function(h.slice(s,e)+";return {maxPrice,costsAt};")();
for(const v of [{equity:500000,income:18000},{equity:900000,income:14000},{equity:400000,income:30000}]){
  const p={price:0,equity:v.equity,rate:4.8,years:30,lawyerPct:0.5,brokerPct:2,appraiser:2500,advisor:0,reno:0,income:v.income,single:true};
  const R=Math.floor(rvb.maxPrice(p).max/10000)*10000;
  const A=n(t(go({equity:String(v.equity),income:String(v.income)}).maxNum));
  ok(A===R,`equity ${v.equity}, income ${v.income}: apartment ${A} == rent-vs-buy ${R}`);
}
// 2. independent check of the binding price at defaults
r=go({}); const M=n(t(r.maxNum));
const tax=x=>{const B=[[1978745,0],[2347040,3.5],[6055070,5],[20183565,8],[1e18,10]];let T=0,pv=0;for(const [to,rr] of B){if(x>pv)T+=(Math.min(x,to)-pv)*rr/100;pv=to;if(x<=to)break;}return T;};
const costs=x=>tax(x)+x*0.005*1.18+x*0.02*1.18+2500;
const pmt=L=>{const r=0.048/12,N=360;return L*r/(1-Math.pow(1+r,-N));};
const eqOK=x=>500000-costs(x)>=0.25*x, incOK=x=>pmt(Math.max(0,x-(500000-costs(x))))<=0.4*18000;
ok(eqOK(M)||incOK(M),"default price passes both gates at "+M);
ok(eqOK(M)&&incOK(M)&&!(eqOK(M+20000)&&incOK(M+20000)),"and 20,000 more fails one of them (it is the max)");
// 3. PTI chips move only the income gate
const m30=n(t(go({},30).maxNum)), m40=n(t(go({},40).maxNum)); ok(m30<=m40,"30% <= 40%: "+m30+" <= "+m40);
// 4. existing loans count against the ratio
const withLoan=n(t(go({loans:"1,500"}).maxNum)); ok(withLoan<=M,"a 1,500/mo car loan lowers or keeps the price: "+withLoan);
// 5. edge cases
r=go({equity:"5,000"}); ok(t(r.maxNum)==="-"&&/לא מכסה/.test(t(r.gateMsg)),"tiny equity -> clear message");
r=go({income:"0"}); ok(/חסרה הכנסה/.test(t(r.gates)),"no income -> equity-only + asks for income");
r=go({equity:"0",income:"0"}); ok(/מתחילים/.test(t(r.gateMsg)),"empty -> start prompt");
let bad=0;for(let k=0;k<400;k++){const v={equity:String(Math.round(Math.random()*4e6)),income:String(Math.round(Math.random()*60000)),loans:String(Math.round(Math.random()*5000)),rate:(Math.random()*8).toFixed(2),years:String(5+Math.round(Math.random()*30)),brokerPct:(Math.random()*2.5).toFixed(1),reno:String(Math.round(Math.random()*150000))};
 const rr=go(v,[30,35,40][k%3]);const s2=Object.values(rr).map(t).join(" ");if(/NaN|undefined|Infinity/.test(s2)){bad++;if(bad<3)console.log("  bad",JSON.stringify(v));}
 const MM=n(t(rr.maxNum)); if(MM>0){const deal=t(rr.deal);/* down >= 25% */const m=deal.match(/\((\d+)%\)/);if(m&&+m[1]<24){bad++;console.log("  down<25",JSON.stringify(v),deal);}}}
ok(bad===0,"400 random inputs: no NaN, down payment never under 25% ("+bad+")");
console.log(fails?"FAILED "+fails:"ALL PASS");
