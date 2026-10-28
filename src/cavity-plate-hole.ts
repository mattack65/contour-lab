import type {Manifold,ManifoldToplevel} from 'manifold-3d';
import type {RectangleRecipe,RectangleQuality} from './rectangles.ts';
import type {PreviewDetail} from './preview-settings.ts';
import {centerAt} from './centreline.ts';
import {cavityCoreMesh} from './cavity-core.ts';

export function cavityControlsPlateHole(r:RectangleRecipe) {
  return r.bottomDisc&&r.discHole>0&&r.smoothCavity?.floor===0;
}

function plateBore(r:RectangleRecipe,wasm:ManifoldToplevel) {
  const center=centerAt(r,0),cylinder=wasm.Manifold.cylinder(r.discThickness,r.discHole/2,r.discHole/2,512);
  try {return cylinder.translate([center.x,center.y,0]);}finally{cylinder.delete();}
}

/** Check the whole plate-height cavity envelope, including scaled insets and
 * moving centres. Run on every cavity conversion, including cached-base edits. */
export function assertCavityPlateHoleClear(r:RectangleRecipe,wasm:ManifoldToplevel,quality:RectangleQuality,
  step:number,detail:PreviewDetail=1) {
  if(!cavityControlsPlateHole(r))return;
  const geometry=cavityCoreMesh(r,quality,step,r.smoothCavity!.inset,r.discThickness,0,[],detail);
  let core:Manifold|undefined,bore:Manifold|undefined,outside:Manifold|undefined;
  try {
    core=new wasm.Manifold(new wasm.Mesh({numProp:3,
      vertProperties:geometry.getAttribute('position').array as Float32Array,
      triVerts:new Uint32Array(geometry.getIndex()!.array)}));
    bore=plateBore(r,wasm);outside=bore.subtract(core);
    if(core.status()!=='NoError'||outside.status()!=='NoError')throw new Error('Could not check the bottom hole against the smooth cavity.');
    if(!outside.isEmpty())throw new Error(`The ${r.discHole} mm bottom hole does not fit inside the smooth cavity throughout the ${r.discThickness} mm plate thickness. Reduce the hole diameter or cavity radial inset, enlarge the lower outline, or reduce its centre offset near the plate.`);
  } finally {outside?.delete();bore?.delete();core?.delete();geometry.dispose();}
}

/** Cut the requested hole through all retained plate-height material, including
 * overlapping strand ends. The caller owns both input and returned solids. */
export function cutCavityPlateHole(plate:Manifold,r:RectangleRecipe,wasm:ManifoldToplevel) {
  const bore=plateBore(r,wasm);
  try {return plate.subtract(bore);}finally{bore.delete();}
}
