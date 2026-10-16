import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,BufferAttribute} from 'three';
import {rectangleDefaults,validateRectangles,rectangleCorners,generateRectangles,outlinePolygon,outlineSizeAt,outlineRadiusAt,sectionSizeAt} from '../src/rectangles.ts';
import {outlineGauge,smoothTransition} from '../src/shape-transition.ts';
import {buildRectangles} from '../src/rectangle-build.ts';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';
import {cavityContour} from '../src/smooth-cavity.ts';
import {geometrySTL} from '../src/export.ts';
import {previewBaseKey} from '../src/preview-settings.ts';
const base={...rectangleDefaults,count:4,width:3,depth:6,topWidth:3,topDepth:6,height:16,diameter:80,topDiameter:80,orbitTwist:0,layerHeight:.5};
const sections=['rectangle','circle','ellipse','diamond','triangle','hexagon'] as const;
const outlines=['circle','square','rectangle','ellipse','hexagon'] as const;
function area(points:number[][]) {return Math.abs(points.reduce((sum,p,i)=>{const q=points[(i+1)%points.length];return sum+p[0]*q[1]-p[1]*q[0];},0))/2;}

test('legacy recipes stay unchanged; top shapes round trip and invalidate base geometry',()=>{
 const a=validateRectangles(base),b=validateRectangles({...base,topSection:'rectangle',topOutline:'circle'});
 const x=generateRectangles(a),y=generateRectangles(b);
 try{assert.deepEqual(geometrySTL(x.geometry),geometrySTL(y.geometry));}finally{x.geometry.dispose();y.geometry.dispose();}
 const r=validateRectangles({...base,topSection:'circle',topOutline:'square'});
 assert.deepEqual(validateRectangles(JSON.parse(JSON.stringify(r))),r);
 assert.notEqual(previewBaseKey(a),previewBaseKey(r));
 assert.throws(()=>validateRectangles({...base,topSection:'star'}),/top strand/);
 assert.throws(()=>validateRectangles({...base,topOutline:'triangle'}),/top outline/);
 assert.equal(smoothTransition(0),0);assert.equal(smoothTransition(1),1);
});

test('every strand shape pair retains endpoint areas, stable correspondence and closed swept geometry',()=>{
 for(const section of sections)for(const topSection of sections){
  if(section===topSection)continue;
  const r=validateRectangles({...base,section,topSection});
  const bottom=rectangleCorners(r,0,0),top=rectangleCorners(r,0,r.height);
  assert.equal(bottom.length,top.length,section+' to '+topSection);
  assert.ok(Math.abs(area(bottom)-area(rectangleCorners({...r,topSection:undefined},0,0)))<1e-8);
  assert.ok(Math.abs(area(top)-area(rectangleCorners({...r,section:topSection,topSection:undefined,width:r.topWidth,depth:r.topDepth},0,r.height)))<1e-8);
  for(const z of [0,4,8,12,16])assert.equal(rectangleCorners(r,0,z).length,bottom.length);
  const mesh=generateRectangles(r);
  try{assert.equal(inspectRectangleMesh(mesh.geometry).components,4);}finally{mesh.geometry.dispose();}
 }
});

test('every outline pair reaches exact endpoint boundaries; strands stay inside and cavity rings match',()=>{
 for(const outline of outlines)for(const topOutline of outlines){
  if(outline===topOutline)continue;
  const r=validateRectangles({...base,outline,topOutline,bottomSizeY:60,topSizeY:100});
  let count=0;
  for(const z of [0,4,8,12,16]){
   const size=outlineSizeAt(r,z),t=smoothTransition(z/r.height),ring=outlinePolygon(r,z);
   if(count)assert.equal(ring.length,count);count=ring.length;
   for(const [x,y] of ring)assert.ok(Math.abs((1-t)*outlineGauge(outline,x/size.x,y/size.y)+t*outlineGauge(topOutline,x/size.x,y/size.y)-1)<1e-10);
   for(let i=0;i<r.count;i++)for(const [x,y] of rectangleCorners(r,i,z))assert.ok((1-t)*outlineGauge(outline,x/size.x,y/size.y)+t*outlineGauge(topOutline,x/size.x,y/size.y)<=1+1e-8);
   assert.equal(cavityContour(r,z,3,128).length,cavityContour(r,0,3,128).length);
   assert.ok(outlineRadiusAt(r,.7,z)>0);
  }
  const mesh=generateRectangles(r);
  try{assert.equal(inspectRectangleMesh(mesh.geometry).components,4);}finally{mesh.geometry.dispose();}
 }
});

test('combined strand and outline transition fuses with a bottom plate and exports a closed STL',async()=>{
 for(const quality of ['preview','export'] as const){
  const r=validateRectangles({...base,section:'circle',topSection:'rectangle',outline:'square',topOutline:'circle',bottomDisc:true,discHole:20,twist:20});
  const result=await buildRectangles(r,quality,undefined,()=>{},{contours:false});
  try{
   assert.equal(result.components,1);assert.equal(inspectRectangleMesh(result.geometry).euler,0);
   const stl=geometrySTL(result.geometry),n=stl.getUint32(80,true),p=new Float32Array(n*9);
   for(let i=0;i<n;i++)for(let j=0;j<9;j++)p[i*9+j]=stl.getFloat32(84+i*50+12+j*4,true);
   const g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(p,3));g.setIndex(Array.from({length:n*3},(_,i)=>i));
   try{assert.equal(inspectRectangleMesh(g).euler,0);}finally{g.dispose();}
  }finally{result.geometry.dispose();}
 }
});

test('smooth interior and repair follow a square-to-circle outline and preserve the plate hole',async()=>{
 const r=validateRectangles({...base,count:12,section:'circle',topSection:'rectangle',outline:'square',topOutline:'circle',bottomDisc:true,discHole:20,
  smoothCavity:{inset:5,floor:0,repairInset:0}});
 for(const quality of ['preview','export'] as const){
  const result=await buildRectangles(r,quality,undefined,()=>{},{contours:false});
  try{assert.equal(result.components,1);assert.equal(inspectRectangleMesh(result.geometry).euler,0);}finally{result.geometry.dispose();}
 }
});

test('combined transitions support bulges, twist, taper and deterministic random offsets',()=>{
 const r=validateRectangles({...base,count:6,height:30,section:'triangle',topSection:'ellipse',outline:'hexagon',topOutline:'rectangle',
  bottomSizeY:70,topSizeY:60,topWidth:5,topDepth:8,twist:35,orbitTwist:15,topInset:10,bottomInset:5,
  bulgePoints:[{height:50,bulge:4,offset:5,seed:42}]});
 const a=generateRectangles(r),b=generateRectangles(validateRectangles(JSON.parse(JSON.stringify(r))));
 try{assert.equal(inspectRectangleMesh(a.geometry).components,6);assert.deepEqual(geometrySTL(a.geometry),geometrySTL(b.geometry));}
 finally{a.geometry.dispose();b.geometry.dispose();}
});
