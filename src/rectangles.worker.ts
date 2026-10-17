import {setNativeJobId} from './native-union.ts';
import type {ProgressWork} from './build-progress.ts';
import {parsePreviewDetail} from './preview-settings.ts';
import Module from 'manifold-3d';
import wasmURL from 'manifold-3d/manifold.wasm?url';
import { buildRectangles } from './rectangle-build.ts';
import {BufferGeometry,BufferAttribute} from 'three';
import {outerSolid} from './outer-solid.ts';
import {smoothCavity,smoothWallModifier} from './smooth-cavity.ts';
import {previewMesh,rectanglePreviewContours,previewGeometry} from './rectangle-preview.ts';
import type {RectanglePreviewMesh} from './rectangle-preview.ts';

self.onmessage = async event => {
  setNativeJobId(event.data.jobId);
  let failedBase:RectanglePreviewMesh|undefined;
  try {
    if(event.data.operation==='contours') {
      const geometry=previewGeometry(event.data.mesh);
      try {
        const lines=rectanglePreviewContours(geometry,event.data.height);
        self.postMessage({lines},{transfer:[lines.buffer]});
      } finally {geometry.dispose();}
      return;
    }
    self.postMessage({ progress: event.data.operation==='smooth-wall' ? 'Building the smooth wall modifier…' : event.data.quality === 'export' ? 'Building full-resolution strands…' : 'Building a lighter strand preview…' });
    const detail=event.data.quality==='preview'?parsePreviewDetail(event.data.previewDetail):1;
    const progress=(progress:string,work?:ProgressWork)=>self.postMessage({progress,work});
    let result;
    let uncored:RectanglePreviewMesh|undefined;
    if(event.data.operation==='smooth-wall') {
      const wasm=await Module({locateFile:()=>wasmURL});wasm.setup();
      result=await smoothWallModifier(event.data.recipe,wasm,progress);
    } else if(event.data.quality==='preview' && event.data.mesh && (event.data.solidBody || event.data.recipe.smoothCavity || event.data.reuseBase)) {
      const geometry=new BufferGeometry();
      geometry.setAttribute('position',new BufferAttribute(event.data.mesh.positions,3));
      geometry.setIndex(new BufferAttribute(event.data.mesh.indices,1));
      try {
        if(event.data.recipe.smoothCavity) {
          const wasm=await Module({locateFile:()=>wasmURL});wasm.setup();
          const sampleStep=event.data.sampleStep;
          uncored=previewMesh(geometry,sampleStep,event.data.components);
          const converted=await smoothCavity(geometry,event.data.recipe,event.data.quality,sampleStep,wasm,progress,detail);
          const lines=event.data.contours===true?rectanglePreviewContours(converted.geometry,event.data.recipe.height):new Float32Array();
          result={...converted,lines,sampleStep};
        } else if(event.data.reuseBase) {
          const restored=geometry.clone();restored.computeVertexNormals();restored.computeBoundingBox();
          result={geometry:restored,lines:new Float32Array(),sampleStep:event.data.sampleStep,
            triangles:restored.index!.count/3,components:event.data.components};
        } else result={...outerSolid(geometry,progress),lines:new Float32Array(),sampleStep:0};
      }
      finally{geometry.dispose();}
    } else {
      const wasm = await Module({ locateFile: () => wasmURL });
      wasm.setup();
      result = await buildRectangles(event.data.recipe, event.data.quality, wasm, progress,
        {previewDetail:event.data.quality==='preview'?detail:undefined,contours:event.data.contours===true,keepUncored:event.data.quality==='preview',onBase:mesh=>{failedBase=mesh;}});
      uncored=result.uncored;
      if(event.data.solidBody && !event.data.recipe.smoothCavity) {
        const original=result.geometry;
        try {result={...result,...outerSolid(original,progress)};}
        finally{original.dispose();}
      }
    }
    progress('Preparing display…',{phase:'display'});
    const lines = result.lines;
    const positions = result.geometry.getAttribute('position').array;
    const normals = result.geometry.getAttribute('normal').array;
    const indices = result.geometry.getIndex()!.array;
    self.postMessage({ positions, normals, indices, lines, uncored, filledPockets:'filledPockets' in result?result.filledPockets:undefined, filledVolume:'filledVolume' in result?result.filledVolume:undefined, triangles: result.triangles, components: result.components, sampleStep: result.sampleStep },
      { transfer: [positions.buffer, normals.buffer, indices.buffer, lines.buffer,...(uncored?[uncored.positions.buffer,uncored.indices.buffer]:[])] });
    result.geometry.dispose();
  } catch (error) { self.postMessage({error:(error as Error).message,uncored:failedBase}, {transfer:failedBase?[failedBase.positions.buffer,failedBase.indices.buffer]:[]}); }
};
