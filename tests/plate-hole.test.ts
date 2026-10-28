import {test} from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {rectangleDefaults,generateRectangles,type RectangleRecipe} from '../src/rectangles.ts';
import {assertPlateHoleClear} from '../src/plate-hole.ts';

const recipe:RectangleRecipe={...rectangleDefaults,count:44,width:5,depth:5,diameter:72,topDiameter:72,height:150,
  strandPlacement:'fixed',scaleWithPerimeter:true,thicknessModulation:'sine',thicknessAmplitude:50,thicknessCycles:4,alternateThickness:true,
  twist:0,orbitTwist:0,bottomDisc:true,discFollowStrands:true,discThickness:2,discHole:60,
  bulgePoints:[{height:100/3,sizeX:145.7,sizeY:145.7,bulge:0,offset:0,seed:1},{height:200/3,sizeX:145.7,sizeY:145.7,bulge:0,offset:0,seed:2}]};

test('actual wave geometry clears a 60 mm hole but rejects a real intrusion at 64 mm',async()=>{
 const wasm=await Module();wasm.setup();
 for(const quality of ['preview','export'] as const)for(const discFollowStrands of [true,false]) {
  const r={...recipe,discFollowStrands},g=generateRectangles(r,{quality,contours:false}).geometry;
  const p=g.getAttribute('position').array as Float32Array,ix=g.getIndex()!.array,nv=p.length/3/r.count,ni=ix.length/r.count;
  const solids=Array.from({length:r.count},(_,i)=>new wasm.Manifold(new wasm.Mesh({numProp:3,
   vertProperties:p.slice(i*nv*3,(i+1)*nv*3),triVerts:Uint32Array.from(ix.slice(i*ni,(i+1)*ni),n=>n-i*nv)})));
  try {
   assert.doesNotThrow(()=>assertPlateHoleClear(r,solids,wasm));
   assert.throws(()=>assertPlateHoleClear({...r,discHole:64},solids,wasm),/64 mm bottom hole intersects strand .* heights/);
  } finally {solids.forEach(s=>s.delete());g.dispose();}
 }
});

test('check follows the bottom centre and detects an intrusion inside the plate height',async()=>{
 const wasm=await Module();wasm.setup();
 const r={...recipe,bottomCenterX:17,bottomCenterY:-9,discThickness:2};
 const above=wasm.Manifold.cube([2,2,2]).translate([16,-10,3]);
 const middle=wasm.Manifold.cube([2,2,.2]).translate([16,-10,.8]);
 try {
  assert.doesNotThrow(()=>assertPlateHoleClear(r,[above],wasm));
  assert.throws(()=>assertPlateHoleClear(r,[middle],wasm),/0.80 and 1.00/);
  assert.doesNotThrow(()=>assertPlateHoleClear({...r,discHole:0},[middle],wasm));
 } finally {above.delete();middle.delete();}
});
