export interface ReductionMetrics {
  passedExportChecks: true;
  selfIntersectionsChecked: false;
  originalTriangles: number;
  triangles: number;
  seconds: number;
  actualFraction: number;
}

/** Send actual full-detail STL bytes, including its cavity/plate/solid option. */
export async function reduceSTL(data: DataView, signal: AbortSignal): Promise<{data:DataView; metrics:ReductionMetrics}> {
  const originalTriangles=data.getUint32(80,true);
  const response=await fetch('/api/native/simplify', {
    method:'POST', headers:{'Content-Type':'model/stl'},
    body:new Uint8Array(data.buffer as ArrayBuffer,data.byteOffset,data.byteLength), signal,
  });
  if(!response.ok) {
    const detail=await response.json().catch(()=>({error:response.statusText}));
    throw new Error(detail.error||'Reduced STL processing failed.');
  }
  const buffer=await response.arrayBuffer();
  signal.throwIfAborted();
  if(buffer.byteLength<4)throw new Error('Incomplete reduced STL response.');
  const size=new DataView(buffer).getUint32(0,true);
  if(size>65536||size+4+84>buffer.byteLength)throw new Error('Invalid reduced STL response.');
  const metrics=JSON.parse(new TextDecoder().decode(new Uint8Array(buffer,4,size))) as ReductionMetrics;
  const result=new DataView(buffer,4+size);
  const faces=result.getUint32(80,true);
  if(metrics.passedExportChecks!==true||metrics.selfIntersectionsChecked!==false||!Number.isSafeInteger(metrics.triangles)||metrics.triangles!==faces||faces<4||
      metrics.originalTriangles!==originalTriangles||faces>=originalTriangles||result.byteLength!==84+50*faces||
      !Number.isFinite(metrics.seconds)||metrics.seconds<0)
    throw new Error('Reduced STL did not pass export checks. No file downloaded.');
  return {data:result,metrics};
}
