import {centerAt} from './centreline.ts';
import {outlinePolygon,hasOutlineTransition,strandPerimeterScaleAt} from './rectangles.ts';
import type {RectangleRecipe} from './rectangles.ts';

/** Insets use the same bottom-relative scale as strands. The clearance guard's
 * outward expansion stays absolute, independent of proportional sizing. */
export function cavityContour(recipe:RectangleRecipe,z:number,inset:number,segments:number,radialExpansion=0) {
  inset=inset*strandPerimeterScaleAt(recipe,z)-radialExpansion;
  const ring=outlinePolygon(recipe,z,segments);
  const sampled=!hasOutlineTransition(recipe)&&ring.length===512?ring.filter((_,i)=>i%(512/segments)===0):ring;
  const center=centerAt(recipe,z);
  return sampled.map(([x,y])=>{
    const radius=Math.hypot(x,y);
    if(radius-inset<0.5)throw new Error('The cavity closes near the centre. Decrease Smooth interior > Radial inset, or enlarge the outline/bulge profile.');
    const scale=(radius-inset)/radius;
    return [x*scale+center.x,y*scale+center.y] as [number,number];
  });
}
