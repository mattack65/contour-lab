import {cavityControlsPlateHole} from './cavity-plate-hole.ts';
import type {RectangleRecipe} from './rectangles.ts';
export type PreviewDetail = 1 | 2 | 4;
export function parsePreviewDetail(value:unknown):PreviewDetail {
 return value===2||value==='2'?2:value===4||value==='4'?4:1;
}
/** Independent preview sampling floor; never inherit full-STL step changes. */
export function previewParameters(recipe:RectangleRecipe,detail:PreviewDetail=1):RectangleRecipe {
 return {...recipe,layerHeight:detail===1?.2:.1};
}
export function previewKey(recipe:RectangleRecipe,detail:PreviewDetail=1){
 return JSON.stringify({detail,recipe:previewParameters(recipe,detail)});
}
/** Cavity changes can reuse the fused base, but detail changes cannot. */
export function previewBaseKey(recipe:RectangleRecipe,detail:PreviewDetail=1){
 const {smoothCavity:_cavity,...base}=previewParameters(recipe,detail);
 // Repair fill contributes to a strand-following plate's actual outline.
 const plateRepairInset=recipe.bottomDisc&&recipe.discFollowStrands?recipe.smoothCavity?.repairInset:undefined;
 // A raw base may contain strand ends awaiting the cavity-stage bore cut.
 // Never reuse it as an unchecked uncored model after disabling that cut.
 const cavityPlateHole=cavityControlsPlateHole(recipe);
 return JSON.stringify({detail,base,plateRepairInset,cavityPlateHole});
}
