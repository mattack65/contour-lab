import type {RectangleRecipe} from './rectangles.ts';

/** Independent multiplicative thickness modifiers, applied after base sizing. */
export function hasThicknessModulation(r:RectangleRecipe) {
  return !!r.thicknessModulation && r.thicknessModulation!=='none' && (r.thicknessAmplitude??30)>0;
}
export function thicknessScaleAt(r:RectangleRecipe,z:number,index=0):number {
  if(!hasThicknessModulation(r))return 1;
  const t=Math.max(0,Math.min(1,z/r.height));
  const phase=2*Math.PI*(r.thicknessCycles??1)*t;
  const alternate=!!r.alternateThickness&&index%2===1;
  const amplitude=(r.thicknessAmplitude??30)/100;
  if(r.thicknessModulation==='sineSquared') {
    // One visible bulge per wave. Complement rather than shifting by pi:
    // sin²(x+pi) would give the same pattern, not an inverse neighbour.
    const value=Math.sin(phase/2)**2;
    return 1+amplitude*(alternate?1-value:value);
  }
  const value=r.thicknessModulation==='triangle'?2/Math.PI*Math.asin(Math.sin(phase))
    :Math.sin(phase);
  return 1+(alternate?-1:1)*amplitude*value;
}
export function thicknessMaximumScale(r:RectangleRecipe) {
  return hasThicknessModulation(r)?1+(r.thicknessAmplitude??30)/100:1;
}
/** Prevent frequency aliasing at coarse preview/export steps. */
export function thicknessSamplingStep(r:RectangleRecipe) {
  if(!hasThicknessModulation(r))return Infinity;
  return r.height/(16*(r.thicknessCycles??1));
}
/** Exact triangle corners must survive all sampling grids. */
export function thicknessKnots(r:RectangleRecipe):number[] {
  if(!hasThicknessModulation(r))return [];
  if(r.thicknessModulation!=='triangle')return [];
  const cycles=r.thicknessCycles??1,knots:number[]=[];
  for(let q=.25;q<cycles;q+=.5)knots.push(r.height*q/cycles);
  return knots;
}
