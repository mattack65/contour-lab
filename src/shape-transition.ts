/** Convex profile transitions using a blend of the two radial gauges.
 * Matching polar directions prevent twisting and keep every polygon corner.
 * The weighted sum of convex gauges stays convex and has no inward folds. */
export type Point = [number,number];
export function smoothTransition(t:number) { t=Math.max(0,Math.min(1,t));return t*t*(3-2*t); }
function angle([x,y]:Point) { const a=Math.atan2(y,x);return a<0?a+2*Math.PI:a; }
function uniqueAngles(values:number[]) {
  return values.sort((a,b)=>a-b).filter((v,i,a)=>i===0||v-a[i-1]>1e-10);
}
function polygonGauge(points:Point[],x:number,y:number) {
  let gauge=0;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],nx=b[1]-a[1],ny=a[0]-b[0];
    gauge=Math.max(gauge,(nx*x+ny*y)/(nx*a[0]+ny*a[1]));
  }
  return gauge;
}
const pairs=new WeakMap<Point[],WeakMap<Point[],{c:number;s:number;a:number;b:number}[]>>();
export function morphProfile(bottom:Point[],top:Point[],t:number):Point[] {
  let cache=pairs.get(bottom);if(!cache){cache=new WeakMap();pairs.set(bottom,cache);}
  let rays=cache.get(top);
  if(!rays) {
    rays=uniqueAngles([...bottom.map(angle),...top.map(angle)]).map(a=>{
      const c=Math.cos(a),s=Math.sin(a);
      return {c,s,a:polygonGauge(bottom,c,s),b:polygonGauge(top,c,s)};
    });cache.set(top,rays);
  }
  return rays.map(({c,s,a,b})=>{const r=1/((1-t)*a+t*b);return [c*r,s*r];});
}
export function outlineGauge(shape:string,x:number,y:number) {
  if(shape==='circle'||shape==='ellipse')return 2*Math.hypot(x,y);
  if(shape==='hexagon')return Math.max(2*Math.abs(y),2*Math.abs(x)+Math.abs(y));
  return 2*Math.max(Math.abs(x),Math.abs(y));
}
const outlineRays=new Map<string,number[]>();
export function outlineMorphPoints(bottom:string,top:string,t:number,segments:number):Point[] {
  const key=bottom+':'+top+':'+segments;
  let angles=outlineRays.get(key);
  if(!angles) {
    const corners=(shape:string):Point[]=>shape==='hexagon'
      ? [[-.5,0],[-.25,-.5],[.25,-.5],[.5,0],[.25,.5],[-.25,.5]]
      : shape==='rectangle'||shape==='square'?[[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]]:[];
    angles=uniqueAngles([...Array.from({length:segments},(_,i)=>2*Math.PI*i/segments),...corners(bottom).map(angle),...corners(top).map(angle)]);
    outlineRays.set(key,angles);
  }
  return angles.map(a=>{const c=Math.cos(a),s=Math.sin(a),r=1/((1-t)*outlineGauge(bottom,c,s)+t*outlineGauge(top,c,s));return [c*r,s*r];});
}
