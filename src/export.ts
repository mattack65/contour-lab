import { Mesh } from 'three';
import type { BufferGeometry } from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { generateTower } from './geometry.ts';
import type { Recipe } from './geometry.ts';

export function exportSTL(recipe: Recipe): DataView {
  const { geometry } = generateTower(recipe, 'export');
  try { return geometrySTL(geometry); } finally { geometry.dispose(); }
}

export function geometrySTL(geometry: BufferGeometry): DataView {
  const mesh = new Mesh(geometry);
  mesh.updateMatrixWorld(true);
  try { return new STLExporter().parse(mesh, { binary: true }); }
  finally { (mesh.material as { dispose(): void }).dispose(); }
}
