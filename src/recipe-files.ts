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
  createWritable():Promise<{write(data:Blob):Promise<void>;close():Promise<void>;abort?():Promise<void>}>;
}
/** Remember a native filename only after the complete write succeeds. */
export async function writeRecipeFile(handle:RecipeFileHandle,data:Blob):Promise<string> {
  const stream=await handle.createWritable();
  try {
    await stream.write(data);
    await stream.close();
  } catch(error) {
    try {await stream.abort?.();}catch { /* Preserve the original write error. */ }
    throw error;
  }
  return handle.name;
}

/** A handle refers to the selected file, not just its name or Downloads folder. */
export interface OpenRecipeHandle extends RecipeFileHandle {getFile():Promise<File>}
export interface RecipePickerHost {
  showSaveFilePicker?:(options:object)=>Promise<RecipeFileHandle>;
  showOpenFilePicker?:(options:object)=>Promise<OpenRecipeHandle[]>;
}
export const recipePickerOptions={
  id:'contour-lab-recipes',
  types:[{description:'Contour Lab recipe',accept:{'application/json':['.json']}}],
  excludeAcceptAllOption:true,
};
/** Keep a file association only after a successful load or completed save. */
export class RecipeFileSession {
  private handle:RecipeFileHandle|undefined;
  get filename(){return this.handle?.name;}
  use(handle:RecipeFileHandle|undefined){this.handle=handle;}
  async save(host:RecipePickerHost,data:Blob,suggestedName:string,saveAs=false):Promise<string>{
    let handle=saveAs?undefined:this.handle;
    if(!handle){
      if(!host.showSaveFilePicker)throw new Error('Direct file saving is unavailable in this browser.');
      handle=await host.showSaveFilePicker({...recipePickerOptions,suggestedName});
    }
    const filename=await writeRecipeFile(handle,data);
    this.handle=handle;
    return filename;
  }
}
