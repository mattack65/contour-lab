import {test} from 'node:test';
import assert from 'node:assert/strict';
import {previewParameters,previewKey,previewBaseKey,parsePreviewDetail} from '../src/preview-settings.ts';
import {rectangleDefaults,validateRectangles,rectangleCorners} from '../src/rectangles.ts';
import {buildRectangles} from '../src/rectangle-build.ts';
import {geometrySTL} from '../src/export.ts';
const recipe=validateRectangles({...rectangleDefaults,section:'circle',count:8,width:4,diameter:100,topDiameter:100,height:30,orbitTwist:60,layerHeight:.5});
test('preview detail invalidates geometry and cache independently of STL step and cavity settings',()=>{
 for(const detail of [1,2,4] as const){
  const changed={...recipe,layerHeight:1};
  assert.equal(previewKey(recipe,detail),previewKey(changed,detail));
  assert.equal(previewBaseKey(recipe,detail),previewBaseKey(changed,detail));
  const cavity={...recipe,smoothCavity:{inset:3,floor:2}};
  assert.equal(previewBaseKey(recipe,detail),previewBaseKey(cavity,detail));
  assert.notEqual(previewKey(recipe,detail),previewKey(cavity,detail));
 }
 assert.notEqual(previewKey(recipe,1),previewKey(recipe,2));
 assert.notEqual(previewKey(recipe,2),previewKey(recipe,4));
 assert.notEqual(previewBaseKey(recipe,2),previewBaseKey(recipe,4));
 assert.equal(parsePreviewDetail('4'),4);assert.equal(parsePreviewDetail('invalid'),1);
 assert.equal(recipe.layerHeight,.5);
});
test('standard retains current geometry; higher detail refines height without changing 32-sided strands',async()=>{
 const standard=await buildRectangles(previewParameters(recipe),'preview',undefined,()=>{},{contours:false});
 let previousStep=Infinity,previousFaces=0;
 try{
  for(const previewDetail of [1,2,4] as const){
   const result=await buildRectangles(recipe,'preview',undefined,()=>{},{contours:false,previewDetail});
   try{
    if(previewDetail===1)assert.deepEqual(new Uint8Array(geometrySTL(result.geometry).buffer),new Uint8Array(geometrySTL(standard.geometry).buffer));
    assert.ok(result.sampleStep<previousStep);assert.ok(result.triangles>previousFaces);
    assert.equal(result.components,recipe.count);assert.equal(result.geometry.boundingBox!.max.z,recipe.height);
    assert.equal(rectangleCorners(previewParameters(recipe,previewDetail),0,0).length,32);
    console.log(JSON.stringify({previewDetail,step:result.sampleStep,faces:result.triangles}));
    previousStep=result.sampleStep;previousFaces=result.triangles;
   }finally{result.geometry.dispose();}
  }
 }finally{standard.geometry.dispose();}
});
test('full STL geometry is byte-identical regardless of preview detail',async()=>{
 const low=await buildRectangles(recipe,'export',undefined,()=>{},{contours:false,previewDetail:1});
 const high=await buildRectangles(recipe,'export',undefined,()=>{},{contours:false,previewDetail:4});
 try{
  assert.equal(low.sampleStep,.5);assert.equal(high.sampleStep,.5);
  assert.deepEqual(new Uint8Array(geometrySTL(low.geometry).buffer),new Uint8Array(geometrySTL(high.geometry).buffer));
 }finally{low.geometry.dispose();high.geometry.dispose();}
});
test('fused smooth cavity follows preview detail and preserves the floor-free bottom hole',async()=>{
 const r=validateRectangles({...rectangleDefaults,count:48,width:8,diameter:80,topDiameter:80,height:12,orbitTwist:10,
  bottomDisc:true,discHole:30,discThickness:2,smoothCavity:{inset:3,floor:0,repairInset:0}});
 let faces=0;
 for(const previewDetail of [1,2,4] as const){
  const result=await buildRectangles(r,'preview',undefined,()=>{},{contours:false,previewDetail});
  try{
   assert.equal(result.components,1);
   assert.ok('euler' in result);assert.equal(result.euler,0);
   assert.ok(result.triangles>faces);faces=result.triangles;
   console.log(JSON.stringify({cavityPreviewDetail:previewDetail,step:result.sampleStep,faces}));
  }finally{result.geometry.dispose();}
 }
});