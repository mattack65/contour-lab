import {BufferGeometry,BufferAttribute} from 'three';
import type {Manifold,ManifoldToplevel} from 'manifold-3d';
import type {RectangleRecipe} from './rectangles.ts';
import {outerSolid} from './outer-solid.ts';

/** Display-only outer skin with a nominal optical thickness. No inner offset
 * surface or print layers; never used for STL export or mesh validation. */
export function lampGeometry(source:BufferGeometry,recipe:RectangleRecipe,wasm:ManifoldToplevel) {
 const owned:Manifold[]=[],geometries:BufferGeometry[]=[];
 const keep=(m:Manifold)=>{owned.push(m);return m;};
 const meshOf=(s:Manifold)=>{const m=s.getMesh(),g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(m.vertProperties,3));g.setIndex(new BufferAttribute(m.triVerts,1));geometries.push(g);return g;};
 const pieces:{g:BufferGeometry;shell:number;indices?:number[]}[]=[];
 try {
  source.computeBoundingBox();const bounds=source.boundingBox!,top=bounds.max.z;
  const bottom=Math.max(bounds.min.z,recipe.bottomDisc?recipe.discThickness:0,recipe.smoothCavity?.floor??0);
  if(top-bottom<.2)throw new Error('There is no wall above the plate to illuminate.');
  const mesh=new wasm.Mesh({numProp:3,vertProperties:source.getAttribute('position').array as Float32Array,triVerts:Uint32Array.from(source.index!.array)});mesh.merge();
  const body=keep(new wasm.Manifold(mesh));
  const upper=keep(body.trimByPlane([0,0,1],bottom+(bottom>bounds.min.z?.01:0)));
  let filled:ReturnType<typeof outerSolid>;
  try {filled=outerSolid(meshOf(upper));}
  catch(e){if((e as Error).message.startsWith('Solid-body export'))throw new Error('Lamp preview needs a continuous outer wall. Close the gaps or enable Smooth interior with outer fill.');throw e;}
  geometries.push(filled.geometry);
  const wall=filled.geometry,p=wall.getAttribute('position'),ix=wall.index!,low=wall.boundingBox!.min.z;
  const indices:number[]=[];
  for(let i=0;i<ix.count;i+=3) {
   const a=ix.getX(i),b=ix.getX(i+1),c=ix.getX(i+2),z=p.getZ(a);
   if(z===p.getZ(b)&&z===p.getZ(c)&&(z===low||z===top))continue;
   indices.push(a,b,c);
  }
  // Restore the tiny temporary cut collar to meet the retained plate exactly.
  for(let i=0;i<p.count;i++)if(p.getZ(i)===low)p.setZ(i,bottom);
  pieces.push({g:wall,shell:1,indices});
  if(bottom>bounds.min.z)pieces.push({g:meshOf(keep(body.trimByPlane([0,0,-1],-bottom))),shell:0});
  // A small visible lip makes the open top read as a thin shell from above.
  const fullMesh=new wasm.Mesh({numProp:3,vertProperties:wall.getAttribute('position').array as Float32Array,triVerts:Uint32Array.from(wall.index!.array)});
  const full=keep(new wasm.Manifold(fullMesh));
  const section=full.slice(top-.001),inner=section.offset(-.4,'Round',2,16),ring=section.subtract(inner);
  try {
   if(section.toPolygons().length!==1||inner.toPolygons().length!==1)throw new Error('The top opening is too narrow for a 0.4 mm lamp rim.');
   const rim=keep(ring.extrude(.08));pieces.push({g:meshOf(keep(rim.translate([0,0,top-.08]))),shell:1});
  } finally {section.delete();inner.delete();ring.delete();}
  const positions:number[]=[],out:number[]=[],shell:number[]=[];
  for(const part of pieces) {
   const attr=part.g.getAttribute('position'),index=part.indices??Array.from(part.g.index!.array),remap=new Map<number,number>();
   for(const old of index) {
    let id=remap.get(old);
    if(id===undefined){id=positions.length/3;remap.set(old,id);positions.push(attr.getX(old),attr.getY(old),attr.getZ(old));shell.push(part.shell);}
    out.push(id);
   }
  }
  const geometry=new BufferGeometry();geometry.setAttribute('position',new BufferAttribute(new Float32Array(positions),3));geometry.setAttribute('lampShell',new BufferAttribute(new Float32Array(shell),1));geometry.setIndex(out);geometry.computeVertexNormals();geometry.computeBoundingBox();
  return geometry;
 } finally {owned.forEach(s=>s.delete());geometries.forEach(g=>g.dispose());}
}
