/** Horizontal level translations, interpolated independently of outline size. */
export interface CentreProfile {
 height:number; bottomCenterX?:number;bottomCenterY?:number;topCenterX?:number;topCenterY?:number;
 bulgePoints?:{height:number;centerX?:number;centerY?:number}[];
}
export const CENTER_LIMIT=280;
export function hasMovingCenters(r:CentreProfile) {
 const x=r.bottomCenterX??0,y=r.bottomCenterY??0;
 return (r.topCenterX??0)!==x||(r.topCenterY??0)!==y
   ||!!r.bulgePoints?.some(p=>(p.centerX??0)!==x||(p.centerY??0)!==y);
}
type Segment={start:number;span:number;x:number[];y:number[]};
const cache=new Map<string,Segment[]>();
function coefficients(heights:number[],values:number[]) {
 const n=values.length,h=heights.slice(1).map((z,i)=>z-heights[i]),m=Array(n).fill(0),b=Array(n).fill(0),rhs=Array(n).fill(0);
 for(let i=1;i<n-1;i++) {
  b[i]=2*(h[i-1]+h[i]);rhs[i]=6*((values[i+1]-values[i])/h[i]-(values[i]-values[i-1])/h[i-1]);
  if(i>1){const f=h[i-1]/b[i-1];b[i]-=f*h[i-1];rhs[i]-=f*rhs[i-1];}
 }
 for(let i=n-2;i>0;i--)m[i]=(rhs[i]-h[i]*m[i+1])/b[i];
 return h.map((s,i)=>[values[i],values[i+1]-values[i]-s*s*(2*m[i]+m[i+1])/6,m[i]*s*s/2,(m[i+1]-m[i])*s*s/6]);
}
export function centerAt(r:CentreProfile,z:number):{x:number;y:number} {
 const x=r.bottomCenterX??0,y=r.bottomCenterY??0;
 if(!hasMovingCenters(r))return {x,y};
 // Value-based key also remains correct when a recipe is edited in place.
 const nodes=[[0,x,y],...(r.bulgePoints??[]).map(p=>[p.height/100,p.centerX??0,p.centerY??0]),[1,r.topCenterX??0,r.topCenterY??0]];
 const key=JSON.stringify(nodes);let segments=cache.get(key);
 if(!segments){
  const heights=nodes.map(p=>p[0]),xs=coefficients(heights,nodes.map(p=>p[1])),ys=coefficients(heights,nodes.map(p=>p[2]));
  segments=xs.map((x,i)=>({start:heights[i],span:heights[i+1]-heights[i],x,y:ys[i]}));
  if(cache.size>=128)cache.clear();cache.set(key,segments);
 }
 const t=Math.max(0,Math.min(1,z/r.height)),s=segments.find(s=>t<=s.start+s.span)??segments[segments.length-1],u=(t-s.start)/s.span;
 const value=(c:number[])=>((c[3]*u+c[2])*u+c[1])*u+c[0];
 return {x:value(s.x),y:value(s.y)};
}
