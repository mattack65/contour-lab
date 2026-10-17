import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,BufferAttribute} from 'three';
import {rectangleDefaults,validateRectangles,generateRectangles} from '../src/rectangles.ts';
import {thicknessScaleAt,thicknessKnots} from '../src/strand-thickness.ts';
import {previewBaseKey} from '../src/preview-settings.ts';
import {buildRectangles} from '../src/rectangle-build.ts';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';
import {geometrySTL} from '../src/export.ts';
const base={...rectangleDefaults,height:20,diameter:60,topDiameter:60,section:'circle' as const,width:4,depth:4,count:8,orbitTwist:0,layerHeight:.7,bulgePoints:[],thicknessAmplitude:40,thicknessCycles:1,alternateThickness:true};
const near=(a:number,b:number,t=1e-7)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const modes=['sineSquared','triangle'] as const;

test('wave values, bounds and complementary neighbours',()=>{
 const squared={...base,thicknessModulation:'sineSquared' as const};
 const triangle={...base,thicknessModulation:'triangle' as const};
 for(const [z,v] of [[0,1],[10,1.4],[20,1]])near(thicknessScaleAt(squared,z),v);
 for(const [z,v] of [[0,1],[5,1.4],[10,1],[15,.6],[20,1]])near(thicknessScaleAt(triangle,z),v);
 for(const mode of modes){
  const r=validateRectangles({...base,thicknessModulation:mode});
  for(let z=0;z<=20;z+=.031){
   const a=thicknessScaleAt(r,z),b=thicknessScaleAt(r,z,1);
   assert.ok(a>=(mode==='sineSquared'?1:.6)-1e-9&&a<=1.4+1e-9);
   near(a+b,mode==='sineSquared'?2.4:2);
  }
 }
 for(let i=0;i<3;i++)near(thicknessScaleAt({...squared,thicknessCycles:3},20*(i+.5)/3),1.4);
});

test('retired random recipes load with modulation off and unrelated parameters intact',()=>{
 const input={...base,thicknessModulation:'random',thicknessRandomBends:6,thicknessSeed:123};
 const r=validateRectangles(input);
 const expected=validateRectangles({...base,thicknessModulation:'none'});
 assert.deepEqual(r,expected);
 assert.equal(input.thicknessModulation,'random','loading does not mutate the original recipe');
 assert.equal('thicknessSeed' in r,false);
 assert.equal('thicknessRandomBends' in r,false);
 for(const z of [0,5,10,20])assert.equal(thicknessScaleAt(r,z),1);
 assert.deepEqual(validateRectangles(JSON.parse(JSON.stringify(r))),r);
 assert.notEqual(previewBaseKey(r),previewBaseKey({...r,thicknessModulation:'triangle'}));
});

test('triangle corners survive non-dividing preview and export sampling',()=>{
 const r=validateRectangles({...base,thicknessModulation:'triangle',thicknessCycles:2.7});
 for(const quality of ['preview','export'] as const){
  const result=generateRectangles(r,{quality,contours:false});
  try{
   inspectRectangleMesh(result.geometry);
   const p=result.geometry.getAttribute('position');
   const heights=new Set(Array.from({length:p.count},(_,i)=>p.getZ(i)));
   for(const z of thicknessKnots(r))assert.ok(heights.has(Math.fround(z)),`Missing corner at ${z}`);
  }finally{result.geometry.dispose();}
 }
});

test('all new modes fuse with plate and smooth cavity and export closed meshes',async()=>{
 for(const mode of modes)for(const quality of ['preview','export'] as const){
  const r=validateRectangles({...base,thicknessModulation:mode,count:16,width:5,thicknessAmplitude:20,bottomDisc:true,discHole:0,smoothCavity:{inset:5,floor:2,repairInset:1}});
  const result=await buildRectangles(r,quality,undefined,()=>{},{contours:false});
  try{
   assert.equal(inspectRectangleMesh(result.geometry).components,1);
   const stl=geometrySTL(result.geometry),n=stl.getUint32(80,true),positions=new Float32Array(n*9);
   for(let i=0;i<n;i++)for(let j=0;j<9;j++)positions[i*9+j]=stl.getFloat32(84+50*i+12+4*j,true);
   const mesh=new BufferGeometry();mesh.setAttribute('position',new BufferAttribute(positions,3));mesh.setIndex(Array.from({length:n*3},(_,i)=>i));
   try{assert.equal(inspectRectangleMesh(mesh).components,1);}finally{mesh.dispose();}
  }finally{result.geometry.dispose();}
 }
});
