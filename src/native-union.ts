import type {Manifold,ManifoldToplevel} from 'manifold-3d';
let nativeJobId:string|undefined;
export function setNativeJobId(id:string|undefined){nativeJobId=id;}

/** Preserve the exact sampled plank inputs; only their Boolean union runs natively. */
export async function nativeUnion(solids:Manifold[],wasm:ManifoldToplevel,bottomDisc:boolean,progress:(s:string)=>void,quality:'preview'|'export'='preview',options:{consumeInputs?:boolean}={}) {
  if(solids.length>32769)throw new Error('Too many separate solids. Increase Block height or reduce strand count.');
  const meshes=solids.map(s=>s.getMesh());
  const header=new TextEncoder().encode(JSON.stringify({version:1,bottomDisc,quality,parts:meshes.map(m=>({vertices:m.vertProperties.length/3,indices:m.triVerts.length}))}));
  const begin=(4+header.length+3)&~3;
  const bytes=begin+meshes.reduce((n,m)=>n+(m.vertProperties.length+m.triVerts.length)*4,0);
  if(bytes>512*1024*1024)throw new Error(`Native fusion input is ${(bytes/1024/1024).toFixed(1)} MB, exceeding the 512 MB limit. Increase the STL step or reduce strand count or round sides.`);
  const packet=new Uint8Array(bytes);
  new DataView(packet.buffer).setUint32(0,header.length,true);packet.set(header,4);
  let offset=begin;
  for(const mesh of meshes) {
    packet.set(new Uint8Array(mesh.vertProperties.buffer,mesh.vertProperties.byteOffset,mesh.vertProperties.byteLength),offset);offset+=mesh.vertProperties.byteLength;
    packet.set(new Uint8Array(mesh.triVerts.buffer,mesh.triVerts.byteOffset,mesh.triVerts.byteLength),offset);offset+=mesh.triVerts.byteLength;
  }
  // The packet owns independent copies. Release source solids before importing
  // the joined mesh into the same bounded WASM heap, not after the whole audit.
  meshes.length=0;
  if(options.consumeInputs)while(solids.length)solids.pop()!.delete();
  progress('Fusing planks with the native engine…');
  const response=await fetch('/api/native/union',{method:'POST',headers:{'Content-Type':'application/octet-stream',...(nativeJobId?{'X-Contour-Job-ID':nativeJobId}:{})},body:packet,signal:AbortSignal.timeout(quality==='export'?610000:185000)});
  if(!response.ok) {
    const detail=await response.json().catch(()=>({error:response.statusText}));
    throw new Error('Native fusion: '+detail.error);
  }
  const buffer=await response.arrayBuffer();
  if(buffer.byteLength<4)throw new Error('Truncated native mesh response.');
  const length=new DataView(buffer).getUint32(0,true);
  if(length>65536||length+4>buffer.byteLength)throw new Error('Invalid native mesh header.');
  const meta=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,length)));
  const part=meta.parts?.[0],start=(4+length+3)&~3;
  if(meta.version!==1||meta.parts.length!==1||!part||!Number.isSafeInteger(part.vertices)||!Number.isSafeInteger(part.indices)||part.vertices<4||part.indices<12||part.indices%3!==0||start+(part.vertices*3+part.indices)*4!==buffer.byteLength)throw new Error('Invalid native mesh response.');
  const positions=new Float32Array(buffer,start,part.vertices*3),indices=new Uint32Array(buffer,start+part.vertices*12,part.indices);
  progress('Native fusion finished in '+(meta.metrics.totalMs/1000).toFixed(2)+' s ('+meta.metrics.threads+' CPU cores); checking the joined mesh…');
  try {return new wasm.Manifold(new wasm.Mesh({numProp:3,vertProperties:positions,triVerts:indices}));}
  catch(error) {
    const detail=error instanceof Error?error.message:String(error);
    throw new Error(`The browser geometry engine failed while loading ${(part.indices/3).toLocaleString('en-US')} fused triangles: ${detail}. Try a larger STL step or fewer round sides to reduce browser memory use.`,{cause:error});
  }
}
