import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,BufferAttribute} from 'three';
import {rectangleDefaults,validateRectangles,rectangleCorners,sectionSizeAt} from '../src/rectangles.ts';
import {previewBaseKey} from '../src/preview-settings.ts';
import {buildRectangles} from '../src/rectangle-build.ts';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';
import {geometrySTL} from '../src/export.ts';
const base={...rectangleDefaults,height:20,diameter:60,topDiameter:100,section:'circle' as const,width:4,depth:4,count:8,orbitTwist:0,layerHeight:.5,bulgePoints:[]};
const centre=(r:typeof base,i:number,z:number)=>{
 const p=rectangleCorners(r,i,z);return p.reduce((a,p)=>[a[0]+p[0]/32,a[1]+p[1]/32],[0,0]);
 // Circle test profiles have 32 equally spaced vertices.
};

const near=(a:number,b:number,tol=1e-7)=>assert.ok(Math.abs(a-b)<tol,`${a} != ${b}`);
test('fixed centres share one circle regardless of sine phase or perimeter scaling',()=>{
 const r={...base,strandPlacement:'fixed' as const,thicknessModulation:'sine' as const,thicknessAmplitude:60,thicknessCycles:2,alternateThickness:true};
 for(const z of [0,1.25,3.75,9,20])for(let i=0;i<r.count;i++){
  const unscaled=centre(r,i,z),scaled=centre({...r,scaleWithPerimeter:true},i,z);
  near(Math.hypot(...unscaled),30+z-2);near(scaled[0],unscaled[0]);near(scaled[1],unscaled[1]);
 }
 const z=2.5;
 near(sectionSizeAt(r,z,0).width,6.4);near(sectionSizeAt(r,z,1).width,1.6);
 assert.ok(rectangleCorners(r,0,z).some(p=>Math.hypot(...p)>32.5),'Growth should extend outside nominal envelope');
});
test('fixed centre paths also ignore taper and section morph, preserving offsets and translations',()=>{
 const r={...base,strandPlacement:'fixed' as const,topCenterX:7,bottomTangential:15,topTangential:20,topInset:5};
 for(const extra of [{taperSection:true,topWidth:8},{topSection:'rectangle' as const,topWidth:8,topDepth:6},{scaleWithPerimeter:true}])for(const z of [0,5,13,20]){
  const expected=centre(r,1,z),ring=rectangleCorners({...r,...extra},1,z);
  // These symmetric profiles retain their centre even when correspondence adds vertices.
  const actual=ring.reduce((a,p)=>[a[0]+p[0]/ring.length,a[1]+p[1]/ring.length],[0,0]);
  near(actual[0],expected[0]);near(actual[1],expected[1]);
 }
});
test('legacy recipes preserve fitted placement; explicit choice round trips and changes cache',()=>{
 const legacy=validateRectangles({...base,strandPlacement:undefined,scaleWithPerimeter:true,thicknessModulation:'sine',thicknessAmplitude:60,alternateThickness:true});
 assert.equal(legacy.strandPlacement,'inside');
 for(const z of [0,5,15,20])for(const i of [0,1])assert.deepEqual(rectangleCorners(legacy,i,z),rectangleCorners({...legacy,strandPlacement:'inside'},i,z));
 const fixed=validateRectangles({...legacy,strandPlacement:'fixed'});
 assert.deepEqual(validateRectangles(JSON.parse(JSON.stringify(fixed))),fixed);
 assert.notEqual(previewBaseKey(legacy),previewBaseKey(fixed));
 assert.throws(()=>validateRectangles({...base,strandPlacement:'bad'}),/placement/);
});
test('fixed-centre modulation with plate and smooth interior has closed preview and serialized full STL',async()=>{
 const r=validateRectangles({...base,topDiameter:60,count:16,width:5,strandPlacement:'fixed',scaleWithPerimeter:true,thicknessModulation:'sine',thicknessAmplitude:20,alternateThickness:true,bottomDisc:true,discHole:0,smoothCavity:{inset:5,floor:2,repairInset:1}});
 for(const quality of ['preview','export'] as const){
  const result=await buildRectangles(r,quality,undefined,()=>{},{contours:false});
  try{
   assert.equal(inspectRectangleMesh(result.geometry).components,1);
   const stl=geometrySTL(result.geometry),n=stl.getUint32(80,true),positions=new Float32Array(n*9);
   for(let i=0;i<n;i++)for(let j=0;j<9;j++)positions[9*i+j]=stl.getFloat32(84+50*i+12+4*j,true);
   const mesh=new BufferGeometry();mesh.setAttribute('position',new BufferAttribute(positions,3));mesh.setIndex(Array.from({length:n*3},(_,i)=>i));
   try{assert.equal(inspectRectangleMesh(mesh).components,1);}finally{mesh.dispose();}
  }finally{result.geometry.dispose();}
 }
});
