const {run,t,n}=require("./shadow.js");
const NEW=process.argv[2], OLD=process.argv[3];
const go=(f,code)=>run(f,"const fmt=new Intl","/* ── reading the quarterly report",{},"save=function(){};"+code+";calc();");
let fails=0;const ok=(c,m)=>{console.log((c?"  ✓ ":"  ✗ ")+m);if(!c)fails++;};
const a0=t(go(OLD,"").annNum), a1=t(go(NEW,"").annNum);
ok(a0===a1,"defaults unchanged (woman, 65): old "+a0+" = new "+a1);

const coefAt=(sex,age)=>{go(NEW,"S.sex='"+sex+"';S.retAge="+age+";syncCoef();global.__c=S.coef");return global.__c;};
console.log("  woman:",[60,62,64,65,67,70].map(a=>a+"→"+coefAt('f',a)).join("  "));
console.log("  man:  ",[60,62,65,67,70].map(a=>a+"→"+coefAt('m',a)).join("  "));
ok(coefAt('f',65)===212&&coefAt('m',67)===202,"anchors kept: 212 (woman 65), 202 (man 67)");
ok(coefAt('f',60)>coefAt('f',65)&&coefAt('f',65)>coefAt('f',70),"earlier retirement -> higher coefficient");
// retiring at 60 lowers the pension vs the old tool
const old60=n(t(go(OLD,"S.retAge=60").annNum)), new60=n(t(go(NEW,"S.retAge=60;syncCoef()").annNum));
console.log("  woman retiring at 60: old",old60,"new",new60);
ok(new60<old60,"at 60 the pension is no longer overstated");
// a manually typed coefficient is never overwritten
go(NEW,"S.coefAuto=false;S.coef=200;S.retAge=60;syncCoef();global.__c=S.coef"); ok(global.__c===200,"manual coefficient 200 survives an age change");
let bad=0;for(let k=0;k<300;k++){const sx=Math.random()<.5?'f':'m',ra=40+Math.floor(Math.random()*40);const rr=go(NEW,"S.sex='"+sx+"';S.retAge="+ra+";S.age="+(20+Math.floor(Math.random()*40))+";syncCoef()");const s=t(rr.annNum)+t(rr.capNum)+t(rr.gMon);if(/NaN|undefined|Infinity/.test(s)){bad++;if(bad<3)console.log("  bad",sx,ra,s);}}
ok(bad===0,"300 random ages clean ("+bad+")");
console.log(fails?"FAILED "+fails:"ALL PASS");
