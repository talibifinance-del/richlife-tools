const {run,t,n}=require("./shadow.js");
const F=process.argv[2];
const go=v=>run(F,"const fmt=new Intl","function drawChart",v,"drawChart=function(o){global.__ch=o};calc();");
let fails=0;const ok=(c,m)=>{console.log((c?"  ✓ ":"  ✗ ")+m);if(!c)fails++;};
function exact(P0,PMT,p,yrs){const r=Math.pow(1+p/100,1/12)-1;let b=P0;for(let k=0;k<yrs*12;k++)b=b*(1+r)+PMT;return b;}
let r=go({initial:"50,000",monthly:"2,000",ret:"7",years:"20"});
console.log("50k+2000/mo 7% 20y:",t(r.rFinal),"|",t(r.rReal));
ok(Math.abs(n(t(r.rFinal))-Math.round(exact(50000,2000,7,20)))<=1,"final == exact monthly "+Math.round(exact(50000,2000,7,20))+" (was 1,246,248)");
ok(Math.abs(n(t(r.rReal).replace(/^[^\d]*/,""))-Math.round(exact(50000,2000,7,20)/Math.pow(1.025,20)))<=1,"real value line correct");
// annuity closed form cross-check
const rm=Math.pow(1.07,1/12)-1, cf=50000*Math.pow(1+rm,240)+2000*(Math.pow(1+rm,240)-1)/rm;
ok(Math.abs(cf-exact(50000,2000,7,20))<1e-3,"closed-form ordinary annuity agrees");
// fees: 0.5% acc only, no deposits: P0*(1.07)^n*(0.995)^n
r=go({initial:"100,000",monthly:"0",ret:"7",years:"10",feeAcc:"0.5"});
const want=100000*Math.pow(1.07,10)*Math.pow(0.995,10);
ok(Math.abs(n(t(r.rFinal))-want)/want<0.0005,"0.5% annual fee on lump sum "+t(r.rFinal)+" ~ "+Math.round(want));
ok(!r.feeBreak.hidden,"fee breakdown shown");
const sumParts=n(t(r.fbDep))+n(t(r.fbAcc))+n(t(r.fbLost)), tot=n(t(r.fbTotal));
ok(Math.abs(sumParts-tot)<=2,"fee parts add up: "+sumParts+" vs "+tot);
// deposit fee 2%: every deposit shrinks 2%
r=go({initial:"0",monthly:"1,000",ret:"0",years:"1",feeDep:"2"}); ok(n(t(r.rFinal))===11760,"0% return, 2% deposit fee, 12x1000 -> 11,760: "+t(r.rFinal));
// chart series last == final
r=go({}); ok(Math.abs(global.__ch.withSeries[global.__ch.withSeries.length-1]-n(t(r.rFinal)))<1,"chart ends at the headline number");
let bad=0;for(let k=0;k<400;k++){const v={initial:String(Math.round(Math.random()*1e6)),monthly:String(Math.round(Math.random()*2e4)),ret:(Math.random()*15).toFixed(1),years:String(Math.round(Math.random()*50)),feeDep:(Math.random()*6).toFixed(1),feeAcc:(Math.random()*2).toFixed(2),inf:(Math.random()*8).toFixed(1)};
 const rr=go(v);const s=Object.values(rr).map(t).join(" ");if(/NaN|undefined|Infinity/.test(s)){bad++;if(bad<3)console.log("   bad",JSON.stringify(v));}}
ok(bad===0,"400 random inputs clean ("+bad+")");
console.log(fails?"FAILED "+fails:"ALL PASS");
