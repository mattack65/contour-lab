import Module from 'manifold-3d';
import wasmURL from 'manifold-3d/manifold.wasm?url';
import {previewGeometry} from './rectangle-preview.ts';
import {lampGeometry} from './lamp-geometry.ts';
self.onmessage=async event=>{
 const source=previewGeometry(event.data.mesh);
 try {
  const wasm=await Module({locateFile:()=>wasmURL});wasm.setup();
  const g=lampGeometry(source,event.data.recipe,wasm);
  try {
   const positions=g.getAttribute('position').array,normals=g.getAttribute('normal').array,shell=g.getAttribute('lampShell').array,indices=g.index!.array;
   self.postMessage({positions,normals,shell,indices},{transfer:[positions.buffer,normals.buffer,shell.buffer,indices.buffer]});
  }finally{g.dispose();}
 }catch(e){self.postMessage({error:(e as Error).message});}finally{source.dispose();}
};
