import {BufferGeometry,BufferAttribute} from 'three';
import type {RectangleRecipe} from './rectangles.ts';
import {sliceMesh} from './tree.ts';

export interface RectanglePreviewMesh {
  positions: Float32Array;
  indices: Uint32Array;
  sampleStep: number;
  components: number;
}

/** Only cavity settings can reuse a fused base. All geometry/export settings stay in the key. */
export function rectangleBaseKey(recipe: RectangleRecipe): string {
  const {smoothCavity: _cavity,...base}=recipe;
  return JSON.stringify(base);
}

export function previewMesh(geometry:BufferGeometry,sampleStep:number,components:number):RectanglePreviewMesh {
  return {positions:new Float32Array(geometry.getAttribute('position').array),
    indices:new Uint32Array(geometry.getIndex()!.array),sampleStep,components};
}

export function previewGeometry(mesh:RectanglePreviewMesh):BufferGeometry {
  const geometry=new BufferGeometry();
  geometry.setAttribute('position',new BufferAttribute(mesh.positions,3));
  geometry.setIndex(new BufferAttribute(mesh.indices,1));
  return geometry;
}

export function rectanglePreviewContours(geometry:BufferGeometry,height:number):Float32Array {
  const points:number[]=[];
  for(let i=0;i<=60;i++)for(const n of sliceMesh(geometry,height*i/60))points.push(n);
  return new Float32Array(points);
}
