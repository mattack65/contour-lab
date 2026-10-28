import {test} from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {rectangleDefaults,type RectangleRecipe} from '../src/rectangles.ts';
import {assertCavityPlateHoleClear,cavityControlsPlateHole} from '../src/cavity-plate-hole.ts';
import {previewBaseKey} from '../src/preview-settings.ts';
import {buildRectangles} from '../src/rectangle-build.ts';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';

const recipe:RectangleRecipe={...rectangleDefaults,count:44,width:5,depth:5,diameter:70,topDiameter:82,height:14,
  bulgePoints:[],strandPlacement:'fixed',twist:0,orbitTwist:0,bottomDisc:true,discFollowStrands:true,discThickness:2,discHole:60,
  smoothCavity:{inset:3,floor:0,repairInset:2}};

test('cavity containment covers diameter, moving centres and the whole plate thickness',async()=>{
 const wasm=await Module();wasm.setup();
 assert.doesNotThrow(()=>assertCavityPlateHoleClear(recipe,wasm,'export',.2));
 assert.throws(()=>assertCavityPlateHoleClear({...recipe,discHole:65},wasm,'preview',.2),/does not fit inside the smooth cavity/);
 assert.throws(()=>assertCavityPlateHoleClear({...recipe,topCenterX:40},wasm,'export',.2),/does not fit inside the smooth cavity/);
 assert.equal(cavityControlsPlateHole({...recipe,smoothCavity:{inset:3,floor:2}}),false);
 assert.equal(cavityControlsPlateHole({...recipe,smoothCavity:undefined}),false);
 assert.notEqual(previewBaseKey(recipe),previewBaseKey({...recipe,smoothCavity:undefined}));
 assert.notEqual(previewBaseKey(recipe),previewBaseKey({...recipe,smoothCavity:{...recipe.smoothCavity!,floor:2}}));
 assert.equal(previewBaseKey(recipe),previewBaseKey({...recipe,smoothCavity:{...recipe.smoothCavity!,inset:4}}));
});

test('both plate modes keep a complete 60 mm bore after cavity cutting, at both qualities',async()=>{
 const wasm=await Module();wasm.setup();
 for(const discFollowStrands of [false,true])for(const quality of ['preview','export'] as const) {
  const r={...recipe,discFollowStrands};
  const result=await buildRectangles(r,quality,wasm,()=>{},{contours:false});
  const g=result.geometry;
  let body:InstanceType<typeof wasm.Manifold>|undefined;
  try {
   const audit=inspectRectangleMesh(g);assert.equal(audit.components,1);assert.equal(audit.euler,0);
   body=new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:g.getAttribute('position').array as Float32Array,triVerts:new Uint32Array(g.getIndex()!.array)}));
   // The final Boolean cleanup allows 0.001 mm surface simplification and
   // Float32 rounding. Probe 0.002 mm inside the requested radial boundary.
   const bore=wasm.Manifold.cylinder(2,29.998,29.998,512),overlap=body.intersect(bore);
   try {assert.ok(overlap.isEmpty(),'strand ends must not obstruct the requested bore');}finally{overlap.delete();bore.delete();}
   const section=body.slice(1);
   try {assert.ok(section.area()>500,'the plate ring was retained');}finally{section.delete();}
   assert.equal(g.boundingBox!.min.z,0);assert.equal(g.boundingBox!.max.z,r.height);
  } finally {body?.delete();g.dispose();}
 }
 await assert.rejects(()=>buildRectangles({...recipe,smoothCavity:undefined},'preview',wasm),/bottom hole intersects strand/);
});
