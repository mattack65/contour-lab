import {previewParameters,parsePreviewDetail} from './preview-settings.ts';
import type {PreviewDetail} from './preview-settings.ts';
import type { ManifoldToplevel } from 'manifold-3d';
import { generateRectangles, hasPhaseShift, rectangleClearance, rectangleSamplingStep, validateRectangles } from './rectangles.ts';
import type { RectangleRecipe, RectangleQuality } from './rectangles.ts';
import { unionRectangles, LatticeSeamError } from './rectangle-union.ts';
import type {RectanglePreviewMesh} from './rectangle-preview.ts';
import {previewMesh,rectanglePreviewContours} from './rectangle-preview.ts';
import {smoothCavity} from './smooth-cavity.ts';

async function joinedRectangles(recipe: RectangleRecipe, quality: RectangleQuality,
  runtime: ManifoldToplevel | undefined, progress: (message: string) => void, coarseStep:number, detail:PreviewDetail) {
  // A different sampling grid can expose slivers or coincident contact edges even
  // when the fine STL is valid. Retry once at half spacing, then use the
  // original export grid. Never drop triangles or bypass topology checks.
  for (let attempt = 0; ; attempt++) {
    const full = quality === 'export' || attempt === 2 || coarseStep / 2 ** attempt <= recipe.layerHeight;
    try {
      return await unionRectangles(recipe, runtime, progress, full ? 'export' : 'preview', attempt, coarseStep,
        quality==='export'&&recipe.smoothCavity?.repairInset!==undefined,detail);
    } catch (error) {
      const samplingFailure=error instanceof LatticeSeamError
        || (error instanceof Error && error.message.includes('collapsed triangle'));
      if (full || !samplingFailure) throw error;
      progress(attempt === 0 ? 'Refining the preview around tight crossings…' : 'Using full detail for this preview…');
    }
  }
}

/** Shared worker/test entry point: print export always uses full density; sharing may serialize a preview. */
export async function buildRectangles(input: RectangleRecipe, quality: RectangleQuality,
  runtime?: ManifoldToplevel, progress: (message: string) => void = () => {},
  options:{previewDetail?:PreviewDetail;contours?:boolean;keepUncored?:boolean;onBase?:(mesh:RectanglePreviewMesh)=>void}={}) {
  const detail=quality==='preview'?parsePreviewDetail(options.previewDetail):1;
  const recipe = validateRectangles(quality==='preview'&&options.previewDetail!==undefined?previewParameters(input,detail):input);
  const sampleStep=Math.max(recipe.layerHeight,rectangleSamplingStep(recipe,quality)/detail);
  // Only skip the union when bounding disks prove the actual sampled planks
  // disjoint. Preview chords can move centres farther inward than export chords.
  const mustJoin = recipe.alternateOrbit || recipe.bottomDisc || hasPhaseShift(recipe)
    || rectangleClearance(recipe, sampleStep) <= 0;
  let result = mustJoin
    ? await joinedRectangles(recipe, quality, runtime, progress, sampleStep, detail)
    : { ...generateRectangles(recipe, { quality, contours: false, previewStep:sampleStep }), components: recipe.count };
  let filledPockets:number|undefined,filledVolume:number|undefined;
  try {
    const uncored=quality==='preview'&&options.keepUncored&&recipe.smoothCavity
      ? previewMesh(result.geometry,result.sampleStep,result.components):undefined;
    if(uncored)options.onBase?.(uncored);
    if(recipe.smoothCavity) {
      const original=result.geometry;
      const cavity=await smoothCavity(original,recipe,quality,result.sampleStep,runtime,progress,detail);
      result={...result,...cavity};filledPockets=cavity.filledPockets;filledVolume=cavity.filledVolume;
      original.dispose();
    }
    let lines:Float32Array=new Float32Array();
    if (quality === 'preview' && options.contours!==false) {
      progress('Preparing preview contours…');
      lines=rectanglePreviewContours(result.geometry,recipe.height);
    }
    return { ...result, lines, uncored, filledPockets, filledVolume };
  } catch (error) {
    result.geometry.dispose();
    throw error;
  }
}
