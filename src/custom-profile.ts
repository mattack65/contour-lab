export type ProfilePoint = [number, number];
export const defaultCustomProfile: ProfilePoint[] = [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]];
export const MAX_PROFILE_POINTS = 64;
const cross=(a:ProfilePoint,b:ProfilePoint,c:ProfilePoint)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
export function profileArea(points:ProfilePoint[]) {
  return points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-p[1]*q[0];},0)/2;
}
/** Simple closed polygon, CCW, centred bounding box with unit depth and width.
 * Store only unique corners: the last-to-first edge is implicit. */
export function validateCustomProfile(value:unknown,label='Custom polygon'):ProfilePoint[] {
  if(!Array.isArray(value)||value.length<3||value.length>MAX_PROFILE_POINTS)
    throw new Error(`${label}: use 3–${MAX_PROFILE_POINTS} corners.`);
  const raw:ProfilePoint[]=value.map(p=>{
    if(!Array.isArray(p)||p.length!==2||p.some(v=>typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>1e6))
      throw new Error(`${label}: every corner needs two finite coordinates.`);
    return [p[0],p[1]];
  });
  const xs=raw.map(p=>p[0]),ys=raw.map(p=>p[1]);
  const loX=Math.min(...xs),loY=Math.min(...ys),dx=Math.max(...xs)-loX,dy=Math.max(...ys)-loY;
  if(dx<1e-8||dy<1e-8)throw new Error(`${label}: the shape needs both width and depth.`);
  const points:ProfilePoint[]=raw.map(([x,y])=>[(x-loX)/dx-.5,(y-loY)/dy-.5]);
  const eps=1e-9;
  const on=(a:ProfilePoint,b:ProfilePoint,p:ProfilePoint)=>Math.abs(cross(a,b,p))<eps&&p[0]>=Math.min(a[0],b[0])-eps&&p[0]<=Math.max(a[0],b[0])+eps&&p[1]>=Math.min(a[1],b[1])-eps&&p[1]<=Math.max(a[1],b[1])+eps;
  for(let i=0;i<points.length;i++) {
    const a=points[i],b=points[(i+1)%points.length],c=points[(i+2)%points.length];
    if(Math.hypot(a[0]-b[0],a[1]-b[1])<1e-6)throw new Error(`${label}: corners ${i+1} and ${(i+1)%points.length+1} are too close.`);
    if(Math.abs(cross(a,b,c))<eps)throw new Error(`${label}: three consecutive corners lie on a straight line. Move or remove the middle corner.`);
    for(let j=i+1;j<points.length;j++) {
      if(j===i+1||(i===0&&j===points.length-1))continue;
      const c=points[j],d=points[(j+1)%points.length];
      if((cross(a,b,c)*cross(a,b,d)<0&&cross(c,d,a)*cross(c,d,b)<0)||on(a,b,c)||on(a,b,d)||on(c,d,a)||on(c,d,b))
        throw new Error(`${label}: edges cross or touch. Move the corners to make one simple closed outline.`);
    }
  }
  if(Math.abs(profileArea(points))<1e-6)throw new Error(`${label}: the enclosed area is too small.`);
  return profileArea(points)<0?points.reverse():points;
}
export function isConvexProfile(points:ProfilePoint[]) {
  return points.every((p,i)=>cross(p,points[(i+1)%points.length],points[(i+2)%points.length])>1e-9);
}
export function supportsProfileTransition(points:ProfilePoint[]) {
  return isConvexProfile(points)&&points.every((p,i)=>cross(p,points[(i+1)%points.length],[0,0])>1e-9);
}
