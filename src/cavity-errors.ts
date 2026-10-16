import type {RectangleRecipe} from './rectangles.ts';

export type CavityStage = 'preparing the body' | 'adding the outer repair fill'
  | 'filling enclosed wall pockets' | 'checking wall clearance' | 'cutting the interior'
  | 'restoring the bottom plate and centre hole' | 'checking the finished cavity mesh';

/** Report what the operation actually established, without guessing a bad setting. */
export function cavityFailure(error:unknown,recipe:RectangleRecipe,stage:CavityStage,
  clearancePassed:boolean,topologyFailure:boolean):Error {
  const cause=error instanceof Error?error:new Error(String(error));
  const c=recipe.smoothCavity!;
  const mm=(value:number)=>String(Number(value.toFixed(3)));
  const settings=`Radial inset ${mm(c.inset)} mm; Bottom thickness ${mm(c.floor)} mm`
    +(c.repairInset===undefined?'; outer repair off':`; Outer fill inset ${mm(c.repairInset)} mm`)+(c.fillPockets?'; Fill enclosed wall pockets on':'')
    +(recipe.scaleWithPerimeter?'; inset values are at the bottom and scale with outline perimeter; bottom thickness stays fixed':'');
  let detail=cause.message;
  if(topologyFailure) {
    detail='The resulting surface failed the closed-mesh check: '+(cause.message.includes('collapsed triangle')?'a collapsed triangle. ':'an open or inconsistently wound seam. ')
      +(clearancePassed?'The wall-clearance check passed. ':'')
      +'No specific setting has been identified as invalid. This is a geometry-processing failure. '
      +'Disable Smooth interior to build the original strands, or save this recipe for investigation.';
  }
  return new Error(`Smooth interior failed while ${stage}. ${detail} Settings: ${settings}.`,{cause});
}
