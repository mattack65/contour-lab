import type {Manifold,ManifoldToplevel} from 'manifold-3d';
import {BufferGeometry,BufferAttribute} from 'three';
import type {RectangleRecipe} from './rectangles.ts';
import {outerSolid} from './outer-solid.ts';

export const VASE_WALL_MM=.4;
export const VASE_LAYER_MM=.2;
function geometryOf(solid:Manifold) {
  const mesh=solid.getMesh(),g=new BufferGeometry();
  g.setAttribute('position',new BufferAttribute(mesh.vertProperties,3));
  g.setIndex(new BufferAttribute(mesh.triVerts,1));return g;
}
function solidOf(g:BufferGeometry,wasm:ManifoldToplevel) {
  const mesh=new wasm.Mesh({numProp:3,vertProperties:g.getAttribute('position').array as Float32Array,
    triVerts:Uint32Array.from(g.getIndex()!.array)});
  mesh.merge();return new wasm.Manifold(mesh);
}

/** Display-only simulated layers, NOT an export mesh or spiral G-code. Each
 * independently closed ring is 0.4 mm wide in XY. Keeping the layers separate
 * avoids loft interpolation inventing holes across sharp, moving valleys.
 * Normal build/export validation is unchanged; these rings never reach export. */
export function vasePreview(source:BufferGeometry,recipe:RectangleRecipe,wasm:ManifoldToplevel,
  progress:(s:string)=>void=()=>{},detail=1) {
  const owned:Manifold[]=[];
  const keep=(m:Manifold)=>{owned.push(m);return m;};
  const meshes:{vertProperties:Float32Array;triVerts:Uint32Array}[]=[];
  let vertices=0,triangles=0;
  const append=(solid:Manifold)=>{
    if(solid.status()!=='NoError'||solid.isEmpty())throw new Error('A preview layer could not be generated for this outline.');
    const mesh=solid.getMesh();vertices+=mesh.vertProperties.length/3;triangles+=mesh.triVerts.length/3;
    if(triangles>3_000_000)throw new Error('This layered preview exceeds 3 million faces. Try Standard preview detail or a shorter model.');
    meshes.push(mesh);
  };
  try {
    progress('Vase preview: checking for a continuous outer wall…');
    source.computeBoundingBox();const bounds=source.boundingBox!;
    const floor=Math.max(recipe.bottomDisc?recipe.discThickness:0,recipe.smoothCavity?.floor??0);
    const bottom=Math.max(bounds.min.z,floor),top=bounds.max.z;
    if(top-bottom<VASE_LAYER_MM)throw new Error('There is no wall above the bottom plate to preview.');
    const original=keep(solidOf(source,wasm));
    // Avoid a coincident Float32 seam at the plate's upper surface during the
    // continuity check. A 0.001 mm cut can retain branched microscopic edges;
    // 0.01 mm clears that collar and stays below the first layer centre (0.1 mm).
    // The retained plate still ends at its exact height.
    const upper=keep(original.trimByPlane([0,0,1],bottom+(floor>bounds.min.z?.01:0)));
    const upperGeometry=geometryOf(upper);
    let outside:ReturnType<typeof outerSolid>;
    try {outside=outerSolid(upperGeometry,()=>{});}
    catch(error) {
      if((error as Error).message.startsWith('Solid-body export'))
        throw new Error('The strands do not form one continuous outer wall above the plate. Close the gaps (for example with wider strands or outer fill) before using vase preview.');
      throw error;
    }finally {upperGeometry.dispose();}
    let full:Manifold;
    try {full=keep(solidOf(outside.geometry,wasm));}finally {outside.geometry.dispose();}
    if(floor>bounds.min.z) {
      const plate=original.trimByPlane([0,0,-1],-bottom);
      try {append(plate);}finally {plate.delete();}
    }
    const count=Math.ceil((top-bottom)/VASE_LAYER_MM);
    for(let i=0;i<count;i++) {
      const low=bottom+i*VASE_LAYER_MM,high=Math.min(top,bottom+(i+1)*VASE_LAYER_MM);
      const section=full.slice((low+high)/2);
      const clean=section.simplify(.025/detail);section.delete();
      let offset:ReturnType<typeof full.slice>|undefined,inner:typeof offset,ring:typeof offset;
      let layer:Manifold|undefined,placed:Manifold|undefined;
      try {
        if(clean.toPolygons().length!==1)
          throw new Error(`The outer contour splits or has gaps near Z ${low.toFixed(2)} mm. Vase mode needs one continuous outline at every layer.`);
        offset=clean.offset(-VASE_WALL_MM,'Round',2,16);inner=offset.simplify(.005/detail);
        if(inner.toPolygons().length!==1||inner.area()<.01)
          throw new Error(`A 0.4 mm wall pinches or splits near Z ${low.toFixed(2)} mm. Widen the narrow necks or reduce the deep valleys.`);
        ring=clean.subtract(inner);
        if(ring.toPolygons().length!==2)
          throw new Error(`The 0.4 mm perimeter is not continuous near Z ${low.toFixed(2)} mm.`);
        layer=ring.extrude(high-low);placed=layer.translate([0,0,low]);append(placed);
      } finally {placed?.delete();layer?.delete();ring?.delete();inner?.delete();offset?.delete();clean.delete();}
      if(i%20===0||i===count-1)progress(`Vase preview: preparing layer ${i+1} of ${count}…`);
    }
    // Concatenate for a single draw call. Shared layer caps deliberately stay:
    // this is a visualization of deposited layers, not a Boolean-unioned solid.
    const positions=new Float32Array(vertices*3),indices=new Uint32Array(triangles*3);
    let vertex=0,index=0;
    for(const mesh of meshes) {
      positions.set(mesh.vertProperties,vertex*3);
      for(let i=0;i<mesh.triVerts.length;i++)indices[index+i]=mesh.triVerts[i]+vertex;
      vertex+=mesh.vertProperties.length/3;index+=mesh.triVerts.length;
    }
    const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(positions,3));geometry.setIndex(new BufferAttribute(indices,1));
    geometry.computeVertexNormals();geometry.computeBoundingBox();
    return {geometry,triangles,components:meshes.length,lines:new Float32Array(),sampleStep:VASE_LAYER_MM};
  } finally {for(const m of owned)m.delete();}
}
