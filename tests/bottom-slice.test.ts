import {test} from 'node:test';
import assert from 'node:assert/strict';
import {BufferGeometry,Float32BufferAttribute} from 'three';
import {sliceMesh} from '../src/tree.ts';

// Closed square prism with a fan-triangulated bottom, like the smooth fill.
// Alternating sub-micron boundary heights expose wedges at an exact Z=0 cut.
function prism(jitter:number) {
 const g=new BufferGeometry();
 const p=[0,0,0,-10,-10,0,10,-10,jitter,10,10,0,-10,10,jitter,
  -10,-10,10,10,-10,10,10,10,10,-10,10,10];
 const faces:number[]=[];
 for(let i=0;i<4;i++){
  const a=1+i,b=1+(i+1)%4,c=b+4,d=a+4;
  faces.push(0,b,a,a,b,c,a,c,d);
 }
 faces.push(5,6,7,5,7,8);
 g.setAttribute('position',new Float32BufferAttribute(p,3));g.setIndex(faces);return g;
}
test('bottom inspector samples inside a numerically uneven cap without changing the mesh',()=>{
 const g=prism(.0007),before=Array.from(g.getAttribute('position').array);
 const slice=sliceMesh(g,0);
 assert.ok(slice.length>0);
 for(let i=0;i<slice.length;i+=3){
  assert.ok(Math.max(Math.abs(slice[i]),Math.abs(slice[i+1]))>9.999,'No internal fan rays');
  assert.equal(slice[i+2],0,'Displayed plane stays at the requested height');
 }
 assert.deepEqual(Array.from(g.getAttribute('position').array),before);
 assert.deepEqual(sliceMesh(g,-.001),[],'No section below the model');
 assert.deepEqual(sliceMesh(g,11),[],'No section above the model');
 g.dispose();
});
test('ordinary interior slices and translated lower boundaries stay correct',()=>{
 const g=prism(0);
 const middle=sliceMesh(g,5);
 assert.equal(middle.length/6,8);
 for(let i=0;i<middle.length;i+=3)assert.equal(middle[i+2],5);
 g.translate(0,0,7);
 const bottom=sliceMesh(g,7);
 assert.ok(bottom.length>0);
 for(let i=0;i<bottom.length;i+=3)assert.equal(bottom[i+2],7);
 g.dispose();
});
