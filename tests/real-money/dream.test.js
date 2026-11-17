const {run,t,n}=require("./shadow.js");
const F=process.argv[2];
const go=v=>run(F,"const fmt=new Intl","function drawChart",v,"drawChart=function(c,tg,yy){global.__chart={c,tg,yy}};calc();");
let fails=0;const ok=(c,m)=>{console.log((c?"  ✓ ":"  ✗ ")+m);if(!c)fails++;};
// 1. defaults
let r=go({});
console.log("DEFAULTS: monthly",t(r.rMonthly),"|",t(r.rMonthlySub));
console.log("  conv:",t(r.yldConv));
const D=n(t(r.rMonthly));
// independent check in pure real terms (python-free): real monthly rate, constant real deposit within year, indexed yearly
function indep(P0,target,g,inf,yrs){const rm=Math.pow(1+g,1/12)-1;let lo=0,hi=1e6;for(let k=0;k<100;k++){const d=(lo+hi)/2;let b=P0,dep=d;for(let y=0;y<yrs;y++){for(let m=0;m<12;m++)b=b*(1+rm)+dep;dep*=1+inf;}if(b<target*Math.pow(1+inf,yrs))lo=d;else hi=d;}return (lo+hi)/2;}
const I=indep(50000,4500000,0.06,0.025,25);
ok(Math.abs(D-I)<=1,"defaults monthly "+D+" == independent bisection "+Math.round(I));
ok(D>9000,"monthly no longer the old understated 6,141");
const ch=global.__chart; ok(Math.abs(ch.c[ch.yy]-ch.tg)/ch.tg<0.001,"chart: final capital in today money "+Math.round(ch.c[ch.yy])+" meets the goal "+Math.round(ch.tg));
// 2. zero inflation = old nominal case, monthly exact
r=go({inf:"0"}); const D0=n(t(r.rMonthly));
let b=50000,rm=Math.pow(1.06,1/12)-1; const fromP=50000*Math.pow(1+rm,300), unit=(Math.pow(1+rm,300)-1)/rm;
ok(Math.abs(D0-Math.round((4500000-fromP)/unit))<=1,"inf 0 -> closed-form ordinary annuity "+D0);
// 3. already covered
r=go({have:"5,000,000"}); ok(t(r.rMonthly).startsWith("0"),"have 5M -> 0 to deposit, insight: "+t(r.insight).slice(0,40));
// 4. financing module runs and no NaN anywhere
r=go({loan:"200,000",loanRate:"7"}); const all=Object.values(r).map(t).join(" ");
ok(!/NaN|undefined|Infinity/.test(all),"no NaN/undefined/Infinity on screen with a loan");
console.log("  fin:",t(r.finOut).slice(0,160));
// 5. random sweep
let bad=0;for(let k=0;k<400;k++){const v={income:String(Math.round(Math.random()*40000)),wrate:String((Math.random()*6+1).toFixed(1)),have:String(Math.round(Math.random()*3e6)),yrs:String(Math.round(Math.random()*40+1)),grow:String((Math.random()*12).toFixed(1)),inf:String((Math.random()*6).toFixed(1)),loan:String(Math.random()<.3?Math.round(Math.random()*5e5):0)};
 const rr=go(v);const s=Object.values(rr).map(t).join(" ");if(/NaN|undefined|Infinity/.test(s)||n(t(rr.rMonthly))<0){bad++; if(bad<3)console.log("   bad",JSON.stringify(v));}}
ok(bad===0,"400 random inputs: no NaN/negative ("+bad+" bad)");
console.log(fails?"FAILED "+fails:"ALL PASS");
