import {test} from 'node:test';
import assert from 'node:assert/strict';
import Module from 'manifold-3d';
import {BufferGeometry,BufferAttribute} from 'three';
import {lampGeometry} from '../src/lamp-geometry.ts';
import {rectangleDefaults} from '../src/rectangles.ts';
import {geometrySTL} from '../src/export.ts';
import {lampColor} from '../src/lamp-material.ts';

test('lamp skin keeps the plate hole, is open at the top and does not alter the export source',async()=>{
 const w=await Module();w.setup();
 const outer=w.Manifold.cylinder(20,20,20,96),cavity=w.Manifold.cylinder(18,16,16,96),raised=cavity.translate([0,0,2]),tube=outer.subtract(raised),bore=w.Manifold.cylinder(2,5,5,64),body=tube.subtract(bore);
 const m=body.getMesh(),g=new BufferGeometry();g.setAttribute('position',new BufferAttribute(m.vertProperties,3));g.setIndex(new BufferAttribute(m.triVerts,1));
 const before=Buffer.from(geometrySTL(g).buffer);
 const r=lampGeometry(g,{...rectangleDefaults,bottomDisc:true,discThickness:2,discHole:10},w);
 try {
  assert.deepEqual(Buffer.from(geometrySTL(g).buffer),before);
  const p=r.getAttribute('position'),s=r.getAttribute('lampShell'),ix=r.index!;
  assert.ok(ix.count/3<5000,'continuous skin stays compact');
  assert.equal(r.boundingBox!.min.z,0);assert.equal(r.boundingBox!.max.z,20);
  for(let i=0;i<ix.count;i+=3) {
   const a=ix.getX(i),b=ix.getX(i+1),c=ix.getX(i+2);
   if(s.getX(a)===0){assert.ok(p.getZ(a)<=2);assert.ok(Math.hypot(p.getX(a),p.getY(a))>=4.99);}
   if(p.getZ(a)===20&&p.getZ(b)===20&&p.getZ(c)===20)for(const j of [a,b,c])assert.ok(Math.hypot(p.getX(j),p.getY(j))>19.5,'only the narrow top rim is capped');
  }
 }finally{r.dispose();g.dispose();for(const x of [outer,cavity,raised,tube,bore,body])x.delete();}
});
test('LED warmth changes from amber toward white without invalid shader values',()=>{
 const warm=lampColor(2700),cool=lampColor(6500);
 assert.ok(warm.r>warm.b);assert.ok(cool.b>warm.b);
 for(const c of [warm,cool])for(const x of c.toArray())assert.ok(Number.isFinite(x)&&x>=0&&x<=1);
});
