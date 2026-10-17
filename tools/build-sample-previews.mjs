// Run inside the app container. Generate viewing STLs; never use these as print masters.
import {readFileSync,writeFileSync,mkdirSync,readdirSync,existsSync,mkdtempSync,rmSync,renameSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {execFileSync} from 'node:child_process';
import {BufferGeometry,BufferAttribute} from 'three';
import {validateRectangles} from '../src/rectangles.ts';
import {buildRectangles} from '../src/rectangle-build.ts';
import {geometrySTL} from '../src/export.ts';
import {inspectRectangleMesh} from '../src/rectangle-union.ts';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const samples=join(root,'samples'),models=join(samples,'models');
const names=process.argv.slice(2);
if(!names.length)names.push(...readdirSync(samples).filter(n=>n.endsWith('.json')&&!existsSync(join(models,n.replace(/\.json$/,'.stl')))).map(n=>n.slice(0,-5)));
const originalFetch=globalThis.fetch;
globalThis.fetch=(url,options)=>originalFetch(typeof url==='string'&&url.startsWith('/api/native/')?(process.env.NATIVE_TEST_URL??'http://127.0.0.1:8000')+'/'+url.slice('/api/native/'.length):url,options);
mkdirSync(models,{recursive:true});
for(const name of names){
 if(!/^[a-zA-Z0-9_-]+$/.test(name))throw new Error('Use a simple recipe basename, without .json: '+name);
 const recipe=validateRectangles(JSON.parse(readFileSync(join(samples,name+'.json'),'utf8')).recipe);
 const start=performance.now();
 console.log(name+': building Standard preview');
 let lastProgress='';
 const result=await buildRectangles(recipe,'preview',undefined,m=>{if(m!==lastProgress){console.log(name+': '+m);lastProgress=m;}},{previewDetail:1,contours:false});
 const temporary=mkdtempSync(join(tmpdir(),'sample-preview-'));
 try{
  inspectRectangleMesh(result.geometry);
  const stl=geometrySTL(result.geometry),input=join(temporary,'input.stl');
  writeFileSync(input,Buffer.from(stl.buffer,stl.byteOffset,stl.byteLength));
  let bytes=readFileSync(input);
  // Stay comfortably below GitHub's 10 MB STL viewer limit.
  if(bytes.length>9_000_000){
   const triangles=bytes.readUInt32LE(80),ratio=Math.min(.8,150000/triangles),output=join(temporary,'reduced.stl');
   console.log(name+': simplifying '+triangles+' faces for the viewer');
   const report=execFileSync(join(root,'native/reduce_mesh'),[input,output,String(ratio)],{
    env:{...process.env,SECTION_MAX_FACES:'2000000'},timeout:600000,encoding:'utf8',maxBuffer:1024*1024,
   });
   console.log(report.trim());bytes=readFileSync(output);
  }
  if(bytes.length>9_000_000)throw new Error(name+': preview still exceeds 9 MB; do not publish it yet.');
  const count=bytes.readUInt32LE(80);
  if(bytes.length!==84+50*count)throw new Error('Invalid binary STL length');
  const positions=new Float32Array(count*9);
  for(let i=0;i<count;i++)for(let j=0;j<9;j++)positions[9*i+j]=bytes.readFloatLE(84+50*i+12+4*j);
  const mesh=new BufferGeometry();mesh.setAttribute('position',new BufferAttribute(positions,3));mesh.setIndex(Array.from({length:count*3},(_,i)=>i));
  try{inspectRectangleMesh(mesh);}finally{mesh.dispose();}
  const dest=join(models,name+'.stl');writeFileSync(dest+'.tmp',bytes);renameSync(dest+'.tmp',dest);
  console.log(JSON.stringify({name,triangles:count,bytes:bytes.length,seconds:(performance.now()-start)/1000}));
 }finally{result.geometry.dispose();rmSync(temporary,{recursive:true,force:true});}
}
