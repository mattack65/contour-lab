import {test} from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {rectangleDefaults,validateRectangles,generateRectangles} from '../src/rectangles.ts';
import {centerAt} from '../src/centreline.ts';
import {plateFootprint,strandOutlinePlate} from '../src/plate-outline.ts';
import {cavityCoreMesh} from '../src/cavity-core.ts';
import {BufferGeometry,BufferAttribute} from 'three';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';

test('plate slices track changing size, rotation and centre throughout their height',async()=>{
 const wasm=await Module();wasm.setup();
 for(const count of [24,6])for(const repair of [false,true]) {
  const recipe=validateRectangles({...rectangleDefaults,count,section:'circle',width:12,depth:12,
   diameter:70,topDiameter:110,height:18,orbitTwist:60,layerHeight:.2,
   topCenterX:9,topCenterY:-6,bottomDisc:true,discFollowStrands:true,discThickness:6,discHole:0,
   smoothCavity:repair?{inset:10,floor:0,repairInset:5}:undefined});
  const generated=generateRectangles(recipe),p=generated.geometry.getAttribute('position').array as Float32Array,
    indices=generated.geometry.getIndex()!.array,nv=p.length/3/count,ni=indices.length/count;
  const strands=Array.from({length:count},(_,i)=>new wasm.Manifold(new wasm.Mesh({numProp:3,
   vertProperties:p.slice(i*nv*3,(i+1)*nv*3),triVerts:Uint32Array.from(indices.slice(i*ni,(i+1)*ni),n=>n-i*nv)})));
  generated.geometry.dispose();
  const plate=strandOutlinePlate(recipe,strands,wasm);
  let core:ReturnType<typeof wasm.Manifold.union>|undefined;
  if(repair){const g=cavityCoreMesh(recipe,'export',.2,5,6,0);try{core=new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:g.getAttribute('position').array as Float32Array,triVerts:g.getIndex()!.array as Uint32Array}));}finally{g.dispose();}}
  const areas:number[]=[];
  try {
   for(const z of [.073,1.327,3.123,5.973]) {
    const slices=strands.map(s=>s.slice(z));if(core)slices.push(core.slice(z));
    const c=centerAt(recipe,z),footprint=plateFootprint(slices,[c.x,c.y],wasm),expected=footprint.section,actual=plate.slice(z);
    const extra=actual.subtract(expected),missing=expected.subtract(actual);
    try {
     areas.push(expected.area());
     if(footprint.mode==='contour')assert.ok(extra.area()+missing.area()<.2,`closed contour at ${z}: slice area difference ${extra.area()+missing.area()} mm²`);
     else {
      // Enclosing spans interpolate over at most one STL step. Check physical
      // boundary displacement, not area (which scales with the plate size).
      const distance=(p:number[],rings:number[][][])=>Math.min(...rings.flatMap(r=>r.map((a,i)=>{
       const b=r[(i+1)%r.length],dx=b[0]-a[0],dy=b[1]-a[1],t=Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(dx*dx+dy*dy)));
       return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
      })));
      const a=actual.toPolygons(),e=expected.toPolygons();
      const deviation=Math.max(...a.flat().map(p=>distance(p,e)),...e.flat().map(p=>distance(p,a)));
      assert.ok(deviation<.05,`enclosing boundary at ${z}: deviation ${deviation} mm`);
     }
    }finally {extra.delete();missing.delete();expected.delete();actual.delete();slices.forEach(s=>s.delete());}
   }
   assert.ok(areas[3]-areas[0]>100,'this case must distinguish a changing plate from a straight extrusion');
   const m=plate.getMesh(),g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(m.vertProperties,3));g.setIndex(new BufferAttribute(m.triVerts,1));
   try {const audit=inspectRectangleMesh(g);assert.equal(audit.components,1);assert.equal(audit.euler,2);g.computeBoundingBox();assert.equal(g.boundingBox!.min.z,0);assert.equal(g.boundingBox!.max.z,6);}finally{g.dispose();}
  }finally {plate.delete();core?.delete();strands.forEach(s=>s.delete());}
 }
});

test('a changing open-strand outline fuses and exports with the full-height plate and bore',async()=>{
 const {buildRectangles}=await import('../src/rectangle-build.ts');
 const recipe=validateRectangles({...rectangleDefaults,count:6,section:'circle',width:12,depth:12,
  diameter:70,topDiameter:110,height:18,orbitTwist:60,layerHeight:.2,
  topCenterX:9,topCenterY:-6,bottomDisc:true,discFollowStrands:true,discThickness:6,discHole:20});
 for(const quality of ['preview','export'] as const) {
  const built=await buildRectangles(recipe,quality,undefined,()=>{},{contours:false});
  try {const audit=inspectRectangleMesh(built.geometry);assert.equal(audit.components,1);assert.equal(audit.euler,0);
   built.geometry.computeBoundingBox();assert.equal(built.geometry.boundingBox!.min.z,0);assert.equal(built.geometry.boundingBox!.max.z,18);
  }finally{built.geometry.dispose();}
 }
});
