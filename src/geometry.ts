import { BufferGeometry, Float32BufferAttribute } from 'three';

export interface Recipe {
  seed: number;
  height: number;
  radius: number;
  twist: number;
  noise: number;
  lobes: number;
  layerHeight: number;
}

export const defaults: Recipe = { seed: 42, height: 80, radius: 19, twist: 100, noise: 0.35, lobes: 5, layerHeight: 0.2 };
export const limits = {
  seed: [0, 999999], height: [20, 150], radius: [8, 35], twist: [-240, 240],
  noise: [0, 0.8], lobes: [3, 9], layerHeight: [0.1, 1],
} as const;

export function validateRecipe(value: unknown): Recipe {
  if (!value || typeof value !== 'object') throw new Error('Recipe must be a JSON object.');
  const result = {} as Recipe;
  for (const key of Object.keys(limits) as (keyof Recipe)[]) {
    const n = (value as Record<string, unknown>)[key];
    const [min, max] = limits[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
      throw new Error(`${key} must be between ${min} and ${max}.`);
    }
    if ((key === 'seed' || key === 'lobes') && !Number.isInteger(n)) throw new Error(`${key} must be an integer.`);
    result[key] = n;
  }
  return result;
}

function random(seed: number) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let n = state;
    n = Math.imul(n ^ (n >>> 15), n | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}

/** Pure, seeded, periodic spatial field. No independent randomness per layer. */
export function contourSampler(recipe: Recipe) {
  const rng = random(recipe.seed);
  const phases = Array.from({ length: 6 }, () => rng() * Math.PI * 2);
  return (theta: number, z: number): [number, number, number] => {
    const t = z / recipe.height;
    const angle = theta - recipe.twist * Math.PI / 180 * t;
    const envelope = 0.85 + 0.15 * Math.cos(t * Math.PI * 2 - 0.5);
    const ribs = 0.14 * Math.cos(recipe.lobes * angle + phases[0]);
    const field = 0.13 * Math.sin(3 * angle + 5 * t + phases[1])
      + 0.08 * Math.cos(2 * angle - 8 * t + phases[2])
      + 0.04 * Math.sin(7 * angle + 4 * t + phases[3]);
    const r = recipe.radius * envelope * (1 + ribs + recipe.noise * field);
    const sway = recipe.noise * recipe.radius * 0.13 * Math.sin(Math.PI * t);
    return [r * Math.cos(theta) + sway * Math.sin(4 * t + phases[4]),
      r * Math.sin(theta) + sway * Math.cos(3 * t + phases[5]), z];
  };
}

export function layerHeights(recipe: Recipe): number[] {
  const count = Math.ceil(recipe.height / recipe.layerHeight);
  return Array.from({ length: count + 1 }, (_, i) => Math.min(i * recipe.layerHeight, recipe.height));
}

export function contour(recipe: Recipe, z: number, segments = 96): number[] {
  const sample = contourSampler(recipe);
  const points: number[] = [];
  for (let j = 0; j < segments; j++) points.push(...sample(j / segments * Math.PI * 2, z));
  return points;
}

/** A single star-shaped outline per Z. Indexed seams and planar caps are shared. */
export function generateTower(input: Recipe, quality: 'preview' | 'export' = 'preview') {
  const recipe = validateRecipe(input);
  const allHeights = layerHeights(recipe);
  const stride = quality === 'export' ? 1 : Math.max(1, Math.ceil((allHeights.length - 1) / 120));
  const heights = allHeights.filter((_, i) => i % stride === 0 || i === allHeights.length - 1);
  const segments = quality === 'export' ? 192 : 96;
  const sample = contourSampler(recipe);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const z of heights) {
    for (let j = 0; j < segments; j++) positions.push(...sample(j * Math.PI * 2 / segments, z));
  }
  for (let i = 0; i < heights.length - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j, b = i * segments + (j + 1) % segments;
      const c = a + segments, d = b + segments;
      indices.push(a, b, c, b, d, c);
    }
  }
  // At both endpoints sway is zero, so the origin lies inside each cap.
  const bottom = positions.length / 3;
  positions.push(0, 0, 0, 0, 0, recipe.height);
  const topRing = (heights.length - 1) * segments;
  for (let j = 0; j < segments; j++) {
    const k = (j + 1) % segments;
    indices.push(bottom, k, j, bottom + 1, topRing + j, topRing + k);
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  return { geometry, heights, segments, triangles: indices.length / 3 };
}
