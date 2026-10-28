import {weldCollapsedLatticeSliver} from './rectangle-union.ts';
import type {Manifold,ManifoldToplevel} from 'manifold-3d';
import {BufferGeometry,BufferAttribute} from 'three';
import type {RectangleRecipe,RectangleQuality} from './rectangles.ts';
import type {PreviewDetail} from './preview-settings.ts';
import {centerAt} from './centreline.ts';
import {cavityCoreMesh} from './cavity-core.ts';
import {outerSolid} from './outer-solid.ts';

function fromGeometry(geometry:BufferGeometry,wasm:ManifoldToplevel) {
  return new wasm.Manifold(new wasm.Mesh({numProp:3,
    vertProperties:geometry.getAttribute('position').array as Float32Array,
    triVerts:new Uint32Array(geometry.getIndex()!.array)}));
}

/** Fill a continuous tube without replacing any of its exterior triangles. */
function fillTube(body:Manifold,wasm:ManifoldToplevel):Manifold|undefined {
  const mesh=body.getMesh(),geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(mesh.vertProperties,3));
  geometry.setIndex(new BufferAttribute(mesh.triVerts,1));
  try {
    const filled=outerSolid(geometry);
    try {return fromGeometry(filled.geometry,wasm);}finally{filled.geometry.dispose();}
  } catch(error) {
    // Only an open/non-tubular outline permits the enclosing-boundary fallback.
    // A failed mesh audit is not permission to smooth away genuine details.
    if(error instanceof Error&&error.message.startsWith('Solid-body export'))return;
    throw error;
  } finally {geometry.dispose();}
}

/** Build the plate from the actual lower body, not an extrusion of one slice.
 * Closed tubes retain the original outside surface. Where the outline is open,
 * short convex spans bridge the feet while still following their height changes. */
export function followingPlateVolume(recipe:RectangleRecipe,strands:Manifold[],wasm:ManifoldToplevel,
  progress:(message:string)=>void=()=>{},quality:RectangleQuality='export',previewDetail:PreviewDetail=1,sampleStep=recipe.layerHeight) {
  const parts:Manifold[]=[],spans:Manifold[]=[];
  let lower:Manifold|undefined,filled:Manifold|undefined,bore:Manifold|undefined;
  try {
    progress('Following the body through the full plate thickness…');
    for(const strand of strands)parts.push(strand.trimByPlane([0,0,-1],-recipe.discThickness));
    if(recipe.smoothCavity?.repairInset!==undefined) {
      const core=cavityCoreMesh(recipe,quality,Math.min(sampleStep,quality==='export'?.5:2),recipe.smoothCavity.repairInset,
        recipe.discThickness,0,[],previewDetail);
      try {parts.push(fromGeometry(core,wasm));}finally{core.dispose();}
    }
    lower=wasm.Manifold.union(parts);
    filled=fillTube(lower,wasm);
    if(!filled) {
      // Preserve strand sampling knots; additionally bound the length of each
      // enclosing span so a changing silhouette cannot become a vertical skirt.
      const zValues=new Set<number>([0,recipe.discThickness]);
      const vertices=strands[0].getMesh().vertProperties;
      for(let i=2;i<vertices.length;i+=3)if(vertices[i]>0&&vertices[i]<recipe.discThickness)zValues.add(vertices[i]);
      const steps=Math.ceil(recipe.discThickness/Math.min(recipe.layerHeight,.05));
      for(let i=1;i<steps;i++)zValues.add(Math.fround(recipe.discThickness*i/steps));
      const heights=[...zValues].sort((a,b)=>a-b).filter((z,i,all)=>i===0||z-all[i-1]>1e-5);
      for(let i=0;i<heights.length-1;i++) {
        // A one-micron overlap avoids coincident cap sheets when adjacent
        // clipped hulls round to slightly different planes.
        const overlap=Math.min(.001,(heights[i+1]-heights[i])/20);
        const above=lower.trimByPlane([0,0,1],Math.max(0,heights[i]-overlap));
        const band=above.trimByPlane([0,0,-1],-Math.min(recipe.discThickness,heights[i+1]+overlap));above.delete();
        try {spans.push(fillTube(band,wasm)??band.hull());}finally{band.delete();}
        progress(`Following plate outline: section ${i+1} of ${heights.length-1}…`);
      }
      const joined=wasm.Manifold.union(spans);
      try {filled=joined.simplify(.001);}finally{joined.delete();}
      // Resolve Float32-coincident hull vertices before the final body union,
      // using the same bounded microscopic repair as the main export pipeline.
      for(let pass=0;pass<2;pass++) {
        const mesh=filled.getMesh();
        const positions=weldCollapsedLatticeSliver(mesh.vertProperties,mesh.triVerts)??mesh.vertProperties;
        const rounded=new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:positions,triVerts:mesh.triVerts}));
        filled.delete();filled=rounded;
      }
    }
    if(recipe.discHole>0) {
      const center=centerAt(recipe,0),cylinder=wasm.Manifold.cylinder(recipe.discThickness,recipe.discHole/2,recipe.discHole/2,512);
      try {bore=cylinder.translate([center.x,center.y,0]);}finally{cylinder.delete();}
      const outside=bore.subtract(filled);
      try {if(!outside.isEmpty())throw new Error('The centre hole reaches outside the strand-following plate. Reduce the hole diameter or use the simple plate outline.');}
      finally{outside.delete();}
      const cut=filled.subtract(bore);filled.delete();filled=cut;
    }
    if(filled.status()!=='NoError')throw new Error('The strand-following bottom plate could not form a closed solid.');
    const result=filled;filled=undefined;return result;
  } finally {filled?.delete();bore?.delete();lower?.delete();spans.forEach(s=>s.delete());parts.forEach(s=>s.delete());}
}
