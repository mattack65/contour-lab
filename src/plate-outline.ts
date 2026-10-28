import type {CrossSection,ManifoldToplevel} from 'manifold-3d';

type Point=[number,number];
const area=(ring:Point[])=>ring.reduce((sum,a,i)=>{const b=ring[(i+1)%ring.length];return sum+a[0]*b[1]-b[0]*a[1];},0)/2;
function contains(ring:Point[],[x,y]:Point) {
  let inside=false;
  for(let i=0,j=ring.length-1;i<ring.length;j=i++) {
    const a=ring[i],b=ring[j];
    if((a[1]>y)!==(b[1]>y)&&x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }
  return inside;
}

/** Keep a closed outer contour exactly, including its concave valleys. Separate
 * feet (or an open arc) instead get an enclosing convex boundary. Inner loops
 * are deliberately filled; the requested centre hole is cut separately. */
export function plateFootprint(sections:CrossSection[],center:Point,wasm:ManifoldToplevel) {
  const combined=wasm.CrossSection.union(sections);
  try {
    const outer=combined.toPolygons().filter(r=>area(r)>0);
    if(outer.length===1&&contains(outer[0],center))
      return {section:new wasm.CrossSection([outer[0]]),mode:'contour' as const};
    return {section:combined.hull(),mode:'envelope' as const};
  } finally {combined.delete();}
}

export {followingPlateVolume as strandOutlinePlate} from './plate-volume.ts';
