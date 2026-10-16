import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { rectangleDefaults, rectangleCorners, rectangleSlice, generateRectangles, validateRectangles, rectangleLimits, rectangleClearance } from '../src/rectangles.ts';
import { geometrySTL } from '../src/export.ts';
const defaults = { ...rectangleDefaults, twist: 0, orbitTwist: 0 };

test('36 radial 1 × 10 mm rectangles lie inside and touch the 200 mm circle', () => {
  for (let i = 0; i < 36; i++) {
    const corners = rectangleCorners(defaults, i);
    const distance = (a: number[], b: number[]) => Math.hypot(a[0] - b[0], a[1] - b[1]);
    assert.ok(Math.abs(distance(corners[0], corners[1]) - 10) < 1e-10);
    assert.ok(Math.abs(distance(corners[1], corners[2]) - 1) < 1e-10);
    for (const p of corners) assert.ok(Math.hypot(...p) <= 100 + 1e-12);
    for (const p of [corners[1], corners[2]]) assert.ok(Math.abs(Math.hypot(...p) - 100) < 1e-12);
    const angle = i * Math.PI / 18;
    const radial = [corners[1][0] - corners[0][0], corners[1][1] - corners[0][1]];
    assert.ok(Math.abs(radial[0] - 10 * Math.cos(angle)) < 1e-10);
    assert.ok(Math.abs(radial[1] - 10 * Math.sin(angle)) < 1e-10);
  }
  const base = rectangleSlice(defaults, 0), top = rectangleSlice(defaults, 200);
  assert.equal(base.length, 36 * 4 * 6);
  assert.ok(base.every((n, i) => i % 3 === 2 ? top[i] === 200 : top[i] === n));
});

test('serialized straight and helical STLs have independent watertight outward solids', () => {
  for (const recipe of [defaults, rectangleDefaults, { ...rectangleDefaults, orbitTwist: -90, height: 30.05 }, { ...defaults, twist: 90, height: 20 }]) {
    const { geometry } = generateRectangles(recipe);
    const stl = geometrySTL(geometry);
    geometry.dispose();
    const steps = recipe.twist === 0 && recipe.orbitTwist === 0 ? 1 : Math.ceil(recipe.height / recipe.layerHeight);
    const triangles = (8 * steps + 4) * recipe.count;
    assert.equal(stl.getUint32(80, true), triangles);
    assert.equal(stl.byteLength, 84 + 50 * triangles);
    const vertices = new Map<string, number>();
    const edges = new Map<string, { count: number; winding: number }>();
    const adjacency = new Map<number, Set<number>>();
    let volume = 0, minZ = Infinity, maxZ = -Infinity;
    for (let pos = 84; pos < stl.byteLength; pos += 50) {
      const tri = [0, 1, 2].map(j => new Vector3(...[0, 1, 2].map(k => stl.getFloat32(pos + 12 + j * 12 + k * 4, true)) as [number, number, number]));
      const ids = tri.map(p => {
        const key = p.toArray().join(',');
        if (!vertices.has(key)) vertices.set(key, vertices.size);
        minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
        assert.ok(Math.hypot(p.x, p.y) <= recipe.diameter / 2 + (recipe.twist ? 0.03 : 0) + 1e-5);
        return vertices.get(key)!;
      });
      const normal = tri[1].clone().sub(tri[0]).cross(tri[2].clone().sub(tri[0]));
      assert.ok(normal.length() > 1e-6);
      // Down-facing faces occur only on the build plate; all side walls are vertical.
      if (steps === 1 && normal.z < -1e-6) assert.ok(tri.every(p => p.z === 0));
      volume += tri[0].dot(tri[1].clone().cross(tri[2])) / 6;
      for (let j = 0; j < 3; j++) {
        const a = ids[j], b = ids[(j + 1) % 3], key = `${Math.min(a, b)},${Math.max(a, b)}`;
        const edge = edges.get(key) ?? { count: 0, winding: 0 };
        edge.count++; edge.winding += a < b ? 1 : -1; edges.set(key, edge);
        if (!adjacency.has(a)) adjacency.set(a, new Set());
        adjacency.get(a)!.add(b);
      }
    }
    assert.ok([...edges.values()].every(e => e.count === 2 && e.winding === 0));
    const unseen = new Set(adjacency.keys());
    let components = 0;
    while (unseen.size) {
      components++;
      const stack = [unseen.values().next().value!];
      let size = 0;
      while (stack.length) {
        const a = stack.pop()!;
        if (!unseen.delete(a)) continue;
        size++; stack.push(...adjacency.get(a)!);
      }
      assert.equal(size, 4 * (steps + 1));
    }
    assert.equal(components, recipe.count);
    assert.equal(minZ, 0); assert.ok(Math.abs(maxZ - recipe.height) < 1e-5);
    const expectedVolume = recipe.count * recipe.width * recipe.depth * recipe.height;
    assert.ok(Math.abs(volume / expectedVolume - 1) < 0.0001, JSON.stringify({ recipe, volume, expectedVolume, relativeError: volume / expectedVolume - 1 }));
  }
});

test('helical planks orbit 90 degrees, remain radial and separated throughout their rise', () => {
  assert.ok(rectangleClearance(rectangleDefaults) > 6.5, 'conservative separation even between meshed rings');
  for (const z of [0, 50, 100, 150, 200]) {
    const angle = Math.PI / 2 * z / 200;
    const c = Math.cos(angle), s = Math.sin(angle);
    for (let i = 0; i < 36; i++) {
      const base = rectangleCorners(rectangleDefaults, i, 0);
      const current = rectangleCorners(rectangleDefaults, i, z);
      current.forEach((p, j) => {
        assert.ok(Math.abs(p[0] - (base[j][0] * c - base[j][1] * s)) < 1e-10);
        assert.ok(Math.abs(p[1] - (base[j][0] * s + base[j][1] * c)) < 1e-10);
        assert.ok(Math.hypot(...p) <= 100 + 1e-10);
      });
    }
  }
  const { twist, orbitTwist, ...oldRecipe } = defaults;
  assert.deepEqual(validateRectangles(oldRecipe), defaults, 'old straight recipes stay straight');
  assert.equal(validateRectangles({ ...rectangleDefaults, count: 100 }).count,100,'dense twists are allowed and fused by the builder');
});

test('rectangle recipes reject invalid dimensions but permit intentionally overlapping fins', () => {
  assert.deepEqual(validateRectangles(JSON.parse(JSON.stringify(defaults))), defaults);
  for (const patch of [{ count: 36.5 }, { count: 0 }, { width: NaN }, { height: Infinity }, { layerHeight: 0 }, { depth: 40, diameter: 40 }, { width: rectangleLimits.width[1]+.1 }, { topWidth: rectangleLimits.topWidth[1]+.1 }]) {
    assert.throws(() => validateRectangles({ ...defaults, ...patch }));
  }
  assert.throws(() => validateRectangles(null));
  const wide=validateRectangles({...defaults,width:10,taperSection:true,topWidth:10});
  assert.equal(wide.width,10);assert.equal(wide.topWidth,10);
  assert.equal(validateRectangles({...defaults,count:144,diameter:40,topDiameter:40,width:5}).count,144);
});
