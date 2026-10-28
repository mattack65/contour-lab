import {cavityControlsPlateHole} from './cavity-plate-hole.ts';
import type {Manifold,ManifoldToplevel} from 'manifold-3d';
import type {RectangleRecipe} from './rectangles.ts';
import {centerAt} from './centreline.ts';

/** Check the actual sampled strands against the same bore used by both plate modes.
 * A maximum-thickness bounding disk is too pessimistic for untwisted profiles,
 * fixed centres and waves whose maxima occur well above the plate. */
export function assertPlateHoleClear(recipe:RectangleRecipe,strands:Manifold[],wasm:ManifoldToplevel) {
  if(!recipe.bottomDisc||recipe.discHole===0)return;
  // The cavity conversion checks its envelope and bores the retained plate.
  if(cavityControlsPlateHole(recipe))return;
  const center=centerAt(recipe,0),radius=recipe.discHole/2;
  const cylinder=wasm.Manifold.cylinder(recipe.discThickness,radius,radius,512);
  const bore=cylinder.translate([center.x,center.y,0]);cylinder.delete();
  try {
    for(let i=0;i<strands.length;i++) {
      const lower=strands[i].trimByPlane([0,0,-1],-recipe.discThickness);
      try {
        if(lower.isEmpty())continue;
        const bounds=lower.boundingBox();
        const dx=Math.max(bounds.min[0]-center.x,0,center.x-bounds.max[0]);
        const dy=Math.max(bounds.min[1]-center.y,0,center.y-bounds.max[1]);
        if(dx*dx+dy*dy>radius*radius)continue;
        const overlap=lower.intersect(bore);
        try {
          if(overlap.status()!=='NoError')throw new Error('Could not check the bottom hole against the strand geometry.');
          if(!overlap.isEmpty()) {
            const b=overlap.boundingBox();
            throw new Error(`The ${recipe.discHole} mm bottom hole intersects strand ${i+1} between heights ${b.min[2].toFixed(2)} and ${b.max[2].toFixed(2)} mm. Reduce the hole diameter, move the strand outward, or reduce its thickness near the plate.`);
          }
        } finally {overlap.delete();}
      } finally {lower.delete();}
    }
  } finally {bore.delete();}
}
