/** Enough for hundreds of editable levels, while rejecting accidental mesh uploads. */
export const MAX_RECIPE_FILE_BYTES=1024*1024;
export interface NamedRecipe {base:string;signature:string;filename?:string}

/** Sort top-level fields; validated bulge points have a canonical field order. */
export function recipeSignature(model:string,recipe:object):string {
  return JSON.stringify([model,Object.entries(recipe).filter(([,value])=>value!==undefined).sort(([a],[b])=>a.localeCompare(b))]);
}
export function recipeFileBase(filename:string):string {
  return filename.trim().replace(/\.json$/i,'').replace(/[<>:"/\\|?*\u0000-\u001f]/g,'-').trim();
}
export function matchingRecipeBase(named:NamedRecipe|undefined,model:string,recipe:object):string|undefined {
  return named?.signature===recipeSignature(model,recipe)?named.base:undefined;
}

export interface RecipeFileHandle {
  name:string;
  createWritable():Promise<{write(data:Blob):Promise<void>;close():Promise<void>}>;
}
/** Remember a native filename only after the complete write succeeds. */
export async function writeRecipeFile(handle:RecipeFileHandle,data:Blob):Promise<string> {
  const stream=await handle.createWritable();
  await stream.write(data);
  await stream.close();
  return handle.name;
}
