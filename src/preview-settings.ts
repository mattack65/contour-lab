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
 return JSON.stringify({detail,base});
}
