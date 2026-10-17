import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,BufferAttribute} from 'three';
import {rectangleDefaults,validateRectangles,sectionSizeAt,baseSectionSizeAt,rectangleCorners,generateRectangles} from '../src/rectangles.ts';
import {thicknessScaleAt} from '../src/strand-thickness.ts';
import {previewBaseKey} from '../src/preview-settings.ts';
import {buildRectangles} from '../src/rectangle-build.ts';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';
import {geometrySTL} from '../src/export.ts';
const base={...rectangleDefaults,height:20,diameter:60,topDiameter:60,section:'circle' as const,width:4,depth:4,count:8,orbitTwist:0,layerHeight:.5,bulgePoints:[]};
const near=(a:number,b:number,t=1e-8)=>assert.ok(Math.abs(a-b)<t,`${a} != ${b}`);
const wave={...base,thicknessModulation:'sine' as const,thicknessAmplitude:30,thicknessCycles:1,alternateThickness:true};

test('sine percentages, opposite phases, taper/perimeter/morph composition and legacy off behavior',()=>{
 const r=validateRectangles(wave);
 for(const [z,a,b] of [[0,4,4],[5,5.2,2.8],[10,4,4],[15,2.8,5.2],[20,4,4]]){
   near(sectionSizeAt(r,z,0).width,a);near(sectionSizeAt(r,z,1).width,b);
 }
 for(const extra of [{taperSection:true,topWidth:8},{topSection:'rectangle' as const,topWidth:8,topDepth:6},{scaleWithPerimeter:true,topDiameter:100}]){
   const recipe={...r,...extra};
   for(const z of [0,3,5,11,17,20])for(const i of [0,1]){
     const b=baseSectionSizeAt(recipe,z),s=sectionSizeAt(recipe,z,i),f=thicknessScaleAt(recipe,z,i);
     near(s.width,b.width*f);near(s.depth,b.depth*f);
   }
 }
 const legacy=validateRectangles({...base,thicknessModulation:undefined,thicknessAmplitude:undefined,thicknessCycles:undefined,alternateThickness:undefined});
 for(const z of [0,5,10,20])assert.deepEqual(rectangleCorners(legacy,1,z),rectangleCorners(base,1,z));
 assert.deepEqual(rectangleCorners({...wave,thicknessAmplitude:0},1,5),rectangleCorners(base,1,5));
 assert.deepEqual(validateRectangles(JSON.parse(JSON.stringify(r))),r);
 assert.notEqual(previewBaseKey(r),previewBaseKey({...r,thicknessCycles:2}));
 for(const invalid of [{thicknessAmplitude:100},{thicknessAmplitude:-1},{thicknessCycles:0},{thicknessCycles:NaN},{thicknessModulation:'bad'},{alternateThickness:'yes'},{count:7}])assert.throws(()=>validateRectangles({...r,...invalid}));
});

test('actual sections keep their modulated dimensions and nominal outer boundary for both phases',()=>{
 for(const section of ['rectangle','ellipse','circle'] as const)for(const index of [0,1]){
   const r={...wave,section,width:4,depth:6};
   for(const z of [5,15]){
     const ring=rectangleCorners(r,index,z),angle=index*2*Math.PI/r.count;
     const x=ring.map(p=>p[0]*Math.cos(angle)+p[1]*Math.sin(angle));
     const y=ring.map(p=>-p[0]*Math.sin(angle)+p[1]*Math.cos(angle));
     const size=sectionSizeAt(r,z,index);
     near(Math.max(...x)-Math.min(...x),size.depth);near(Math.max(...y)-Math.min(...y),size.width);
     near(Math.max(...ring.map(p=>Math.hypot(...p))),30,1e-6);
   }
 }
});

test('high-frequency waves cannot alias to straight prisms in preview or full export',()=>{
 const r={...wave,height:10,thicknessCycles:12,layerHeight:1};
 for(const quality of ['preview','export'] as const){
   const result=generateRectangles(r,{quality,contours:false});
   try{
     inspectRectangleMesh(result.geometry);
     const pos=result.geometry.getAttribute('position');
     const heights=new Set(Array.from({length:pos.count},(_,i)=>pos.getZ(i)));
     assert.ok(heights.size>=193,`Only ${heights.size} rings`);
     const stl=geometrySTL(result.geometry);assert.ok(stl.getUint32(80,true)>r.count*128);
   }finally{result.geometry.dispose();}
 }
});

test('modulated strands fuse with a plate and smooth cavity and serialize closed STL',async()=>{
 const r=validateRectangles({...wave,count:16,width:5,thicknessAmplitude:20,bottomDisc:true,discHole:0,smoothCavity:{inset:5,floor:2,repairInset:1}});
 for(const quality of ['preview','export'] as const){
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
