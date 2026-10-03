const {run,t}=require("./ta.js");
const first=s=>{const m=String(s).match(/[\d,]*\d/);return m?+m[0].replace(/,/g,""):0;};
const pct=r=>{const m=t(r.tTotS).match(/([\d.]+)%/);return m?+m[1]:0;};
let R=12345; const rnd=()=>(R=(R*1103515245+12345)&0x7fffffff)/0x7fffffff;
const pick=a=>a[Math.floor(rnd()*a.length)];
let errs=0,n=0,contra=0,over=0;
for(let i=0;i<600;i++){
  const o={income:String(Math.round((5000+rnd()*45000)/500)*500),
           capital:String(Math.round(rnd()*300000/1000)*1000),
           price:String(Math.round(rnd()*250000/1000)*1000),
           rate:(2+rnd()*12).toFixed(1), term:String(pick([0,12,36,48,60,72,84,100])),
           insType:pick(["full","third","only"]), newDriver:rnd()<.3, cleanPol:rnd()<.3,
           firstCar:rnd()<.5, kmByCommute:rnd()<.4, ownRun:rnd()<.3};
  o.down=String(Math.round(rnd()*(+o.price.replace(/,/g,""))/1000)*1000);
  if(!o.firstCar) o.tradein=String(Math.round(rnd()*120000/1000)*1000);
  if(o.ownRun){o.fuel=String(Math.round(rnd()*2000));o.insur=String(Math.round(rnd()*1500));o.maint=String(Math.round(rnd()*1200));}
  let r; try{ r=run(o); n++; }catch(e){ errs++; if(errs<4) console.log("  THROW:",e.message,JSON.stringify(o)); continue; }
  const ct=t(r.m10), P=+o.price.replace(/,/g,""), p=pct(r);
  // CONTRADICTION: a real ceiling >= the price, yet the verdict is not green
  if(!/במזומן|חורגת/.test(ct)){
    const C=first(ct);
    if(P>0&&P<=C-1&&p>10.051){contra++;if(contra<5)console.log("  CONTRA: price",P,"<= ceiling",C,"but",p+"%",JSON.stringify(o));}
    // above the ceiling but still green is only honest when a DIFFERENT rule
    // binds: the 25% down payment. Then the card says so and that row is red.
    if(P>0&&P>=C+2000&&p<=10.0){
      const capped=/\u05de\u05d5\u05d2\u05d1\u05dc \u05d1\u05de\u05e7\u05d3\u05de\u05d4/.test(ct);
      // the cap can only bind when the down payment really is under 25%,
      // and that rule must be flagged red on the checklist
      const D=+o.down.replace(/,/g,"");
      const downRed=D<P*0.25&&/\ud83d\udea9/.test(t(r.rules));
      if(!(capped&&downRed)){contra++;if(contra<5)console.log("  CONTRA-REV: price",P,"> ceiling",C,"yet",p+"% | capped",capped,"| downRed",downRed,JSON.stringify(o));}
    }
  }
  // DOCTRINE: nothing on the page may offer a car costing over 15% of net
  for(const id of ["m10","vsRecCar"]){
    const m=t(r[id]).match(/([\d.]+)% מהנטו/);
    if(m&&+m[1]>15.05){over++;if(over<4)console.log("  OVER15:",id,t(r[id]));}
  }
  // no NaN / undefined anywhere visible
  for(const id of ["m10","lmm15","lmm20","vsRecCar","vMsg","tTot","capIns","breakdown"]){
    const x=t(r[id]); if(/NaN|undefined|Infinity/.test(x)){errs++;if(errs<6)console.log("  JUNK:",id,x.slice(0,80),JSON.stringify(o));}
  }
}
console.log(n+" random profiles · "+errs+" errors · "+contra+" contradictions · "+over+" over-15% offers");
