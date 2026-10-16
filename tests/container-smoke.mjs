import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {rectangleDefaults,validateRectangles} from '../src/rectangles.ts';
import {buildRectangles} from '../src/rectangle-build.ts';
import {geometrySTL} from '../src/export.ts';
import {reduceSTL} from '../src/reduced-export.ts';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';

const endpoint=process.env.NATIVE_TEST_URL??'http://127.0.0.1:5173/api/native';
const originalFetch=globalThis.fetch;
globalThis.fetch=(url,options)=>originalFetch(typeof url==='string'&&url.startsWith('/api/native/')?endpoint+url.slice('/api/native'.length):url,options);
assert.equal((await (await fetch(endpoint+'/health')).json()).engine,'native Manifold');
const small=validateRectangles({...rectangleDefaults,count:12,width:6,depth:6,section:'circle',diameter:60,topDiameter:80,height:20,bulgePoints:[],orbitTwist:0,layerHeight:.5,
 strandSpacing:'perimeter',scaleWithPerimeter:true,smoothCavity:{inset:6,floor:2,repairInset:3}});
for(const [recipe,quality] of [[small,'preview'],[small,'export']]){
 const result=await buildRectangles(recipe,quality,undefined,()=>{},{contours:false});
 try{
  assert.equal(inspectRectangleMesh(result.geometry).components,1);
  const stl=geometrySTL(result.geometry),bytes=Buffer.from(stl.buffer,stl.byteOffset,stl.byteLength);
  console.log(JSON.stringify({quality,triangles:stl.getUint32(80,true),sha256:createHash('sha256').update(bytes).digest('hex')}));
  if(quality==='export'){
   const reduced=await reduceSTL(stl,new AbortController().signal);
   assert.ok(reduced.data.getUint32(80,true)<stl.getUint32(80,true));
   console.log(JSON.stringify({reducedTriangles:reduced.data.getUint32(80,true)}));
  }
 }finally{result.geometry.dispose();}
}
