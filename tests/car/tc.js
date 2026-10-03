const {run,t}=require("./ta.js");
const first=s=>{const m=String(s).match(/[\d,]*\d/);return m?+m[0].replace(/,/g,""):0;};
const pct=r=>{const m=t(r.tTotS).match(/([\d.]+)%/);return m?+m[1]:0;};
const flags=r=>({red:(t(r.rules).match(/🚩/g)||[]).length,orange:(t(r.rules).match(/🟠/g)||[]).length});

console.log("=== HER CASE: 30,000 net / 50,000 capital / car 60,000 / down 15,000 / 6.5% / 48 / upkeep 2,000 ===");
let her=run({income:"30,000",capital:"50,000",price:"60,000",down:"15,000",rate:"6.5",term:"48",
             ownRun:true,fuel:"0",insur:"0",maint:"2,000",park:"0"});
console.log("  רכב עד (10%)   :",t(her.m10));
console.log("  vs card ceiling:",t(her.vsRecCar),"| plan:",t(her.vsPlanCar));
console.log("  total/month    :",t(her.tTot),"("+t(her.tTotS)+")");
console.log("  verdict        :",t(her.vMsg).slice(0,140));

console.log("\n=== INVARIANT: ceiling is the inverse of the verdict (planned mode) ===");
const profs=[
 {income:"30,000",capital:"50,000",down:"15,000"},
 {income:"12,000",capital:"50,000",down:"16,000"},
 {income:"25,000",capital:"30,000",down:"10,000"},
 {income:"9,000", capital:"120,000",down:"40,000"},
 {income:"40,000",capital:"20,000",down:"6,000"},
 {income:"18,000",capital:"200,000",down:"66,000"},
 {income:"8,000", capital:"30,000",down:"10,000"},
 {income:"15,000",capital:"0",down:"0"},
 {income:"22,000",capital:"80,000",down:"80,000"},
];
const variants=[
 {tag:"model upkeep, 6.5%/48", o:{rate:"6.5",term:"48"}},
 {tag:"model upkeep, 9%/72  ", o:{rate:"9",term:"72"}},
 {tag:"manual upkeep 2,000  ", o:{rate:"6.5",term:"48",ownRun:true,fuel:"0",insur:"0",maint:"2,000",park:"0"}},
 {tag:"third-party ins, new drv", o:{rate:"6.5",term:"48",insType:"third",newDriver:true}},
 {tag:"compulsory only       ", o:{rate:"6.5",term:"48",insType:"only"}},
 {tag:"trade-in 25,000       ", o:{rate:"6.5",term:"48",firstCar:false,tradein:"25,000"}},
];
let bad=0,n=0;
for(const v of variants) for(const p of profs){
  const probe=run(Object.assign({price:"100"},p,v.o));
  const txt=t(probe.m10);
  if(/\u05d1\u05de\u05d6\u05d5\u05de\u05df|\u05d7\u05d5\u05e8\u05d2\u05ea/.test(txt)){
    // not a ceiling: 10% is unreachable. Doctrine check: never offer over 15%.
    const m=txt.match(/([\d.]+)% \u05de\u05d4\u05e0\u05d8\u05d5/);
    if(m&&+m[1]>15.05){bad++;console.log("  FAIL-OVER15",v.tag,"inc",p.income,"offers",txt);}
    continue;
  }
  const C=first(txt);
  if(C<=100) continue;
  const at=run(Object.assign({},p,v.o,{price:String(Math.floor(C))}));
  const C2=first(t(at.m10)), pc=pct(at), f=flags(at);
  n++;
  const stable=Math.abs(C2-C)<=2, green=pc<=10.051;
  if(!stable||!green){bad++;console.log("  FAIL",v.tag,"inc",p.income,"down",p.down,"| ceiling",Math.round(C),"->",Math.round(C2),"| pc",pc,"| red",f.red);}
  // and one shekel below the ceiling must never be worse
  const under=run(Object.assign({},p,v.o,{price:String(Math.max(1,Math.floor(C*0.75)))}));
  if(pct(under)>10.051){bad++;console.log("  FAIL-UNDER",v.tag,"inc",p.income,"75% of ceiling ->",pct(under)+"%");}
}
console.log("  "+n+" profile/variant pairs tested, "+bad+" failures");

console.log("\n=== never print a 0 ₪ car ===");
let zeros=0;
for(const v of variants) for(const p of profs) for(const pr of ["0","100","60,000"]){
  const r=run(Object.assign({},p,v.o,{price:pr}));
  for(const id of ["m10","lmm15","lmm20","vsRecCar"]){
    const s=t(r[id]);
    if(/^0(\s|$)/.test(s)||s==="0 ₪"||/\b0 ₪/.test(s.split("·")[0])){zeros++;console.log("  ZERO",id,"=",s,"| inc",p.income,v.tag,"price",pr);}
  }
}
console.log("  "+(zeros?zeros+" zero-shekel cars printed":"no zero-shekel car anywhere"));
