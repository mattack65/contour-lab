import {defaultCustomProfile,validateCustomProfile,supportsProfileTransition} from './custom-profile.ts';
import type {ProfilePoint} from './custom-profile.ts';
import {hasThicknessModulation, thicknessScaleAt, thicknessMaximumScale, thicknessSamplingStep, thicknessKnots} from './strand-thickness.ts';
import {outlineTravel} from './outline-travel.ts';
import {centerAt,hasMovingCenters,CENTER_LIMIT} from './centreline.ts';
import {adaptiveStations} from './adaptive-sampling.ts';
import { pathAngle, pathDerivativeBounds, pathKnots } from './path-motion.ts';
import { morphProfile, smoothTransition, outlineGauge, outlineMorphPoints } from './shape-transition.ts';
import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';

export interface BulgePoint {
  centerX?: number;
  centerY?: number;
  sizeX?: number; // Full X span, supersedes legacy radial bulge.
  sizeY?: number; // Full Y span, independently interpolated.
  lockProportions?: boolean;
  height: number; // Percentage of total height, strictly between the ends.
  bulge: number; // Signed radial millimetres, positive outward.
  offset: number; // Signed random percentage, positive outward (UI convention).
  seed: number;
}
export interface RectangleRecipe {
  bottomCenterX?: number;bottomCenterY?: number;topCenterX?: number;topCenterY?: number;
  smoothCavity?: {inset:number;floor:number;repairInset?:number;fillPockets?:boolean};
  bulgePoints?: BulgePoint[];
  bottomProportionsLocked?: boolean;
  topProportionsLocked?: boolean;
  strandSpacing?: 'angle' | 'perimeter';
  strandPlacement?: 'inside' | 'fixed';
  scaleWithPerimeter?: boolean;
  thicknessModulation?: 'none' | 'sine' | 'sineSquared' | 'triangle';
  thicknessAmplitude?: number;
  thicknessCycles?: number;
  alternateThickness?: boolean;
  count: number;
  width: number;
  depth: number;
  section: 'rectangle' | 'diamond' | 'triangle' | 'hexagon' | 'circle' | 'ellipse' | 'custom';
  customProfile?: ProfilePoint[];
  topCustomProfile?: ProfilePoint[];
  topSection?: RectangleRecipe['section'];
  topOutline?: RectangleRecipe['outline'];
  sectionSides: number;
  taperSection: boolean;
  topWidth: number;
  topDepth: number;
  diameter: number;
  topDiameter: number;
  outline: 'circle' | 'square' | 'rectangle' | 'ellipse' | 'hexagon';
  bottomSizeY: number;
  topSizeY: number;
  topInset: number;
  insetSeed: number;
  bottomInset: number;
  bottomInsetSeed: number;
  lowerInset: number;
  lowerInsetSeed: number;
  upperInset: number;
  upperInsetSeed: number;
  middleInset: number;
  middleInsetSeed: number;
  topTangential: number;
  topTangentialSeed: number;
  bottomTangential: number;
  bottomTangentialSeed: number;
  bulge: number;
  twoBulges: boolean;
  bulgeLower: number;
  bulgeUpper: number;
  height: number;
  twist: number;
  orbitTwist: number;
  alternateOrbit: boolean;
  alternateTwist: boolean;
  randomTwist: boolean;
  twistSeed: number;
  bottomDisc: boolean;
  discHole: number;
  discThickness: number;
  motion: 'helix' | 'sine' | 'accelerating' | 'chirp' | 'wander' | 'zigzag';
  turnPower: number;
  reverseAcceleration: boolean;
  waveEndCycles: number;
  wanderAmplitude: number;
  wanderBends: number;
  wanderSeed: number;
  waveAmplitude: number;
  waveCycles: number;
  phaseTurns: number;
  layerHeight: number;
}

export const rectangleDefaults: RectangleRecipe = {
  bottomCenterX: undefined, bottomCenterY: undefined, topCenterX: undefined, topCenterY: undefined,
  strandSpacing: 'angle', strandPlacement: 'inside', scaleWithPerimeter: false,
  thicknessModulation: 'none', thicknessAmplitude: 30, thicknessCycles: 1, alternateThickness: false,
  topSection: undefined, topOutline: undefined, customProfile: undefined, topCustomProfile: undefined,
  smoothCavity: undefined,
  bulgePoints: undefined,
  count: 36, width: 1, depth: 10, diameter: 200, topDiameter: 200, height: 200, twist: 0, orbitTwist: 90, alternateOrbit: false, layerHeight: 0.2,
  turnPower: 2, reverseAcceleration: false, waveEndCycles: 3, wanderAmplitude: 12, wanderBends: 4, wanderSeed: 1729,
  motion: 'helix', waveAmplitude: 8, waveCycles: 1, alternateTwist: false, randomTwist: false, twistSeed: 42424,
  bottomDisc: false, discHole: 39, discThickness: 2, bulge: 0, twoBulges: false, bulgeLower: 0, bulgeUpper: 0,
  section: 'rectangle', sectionSides: 32, taperSection: false, topWidth: 1, topDepth: 10, phaseTurns: 0,
  outline: 'circle', bottomSizeY: 200, topSizeY: 200,
  topInset: 0, insetSeed: 42,
  bottomInset: 0, bottomInsetSeed: 31415,
  lowerInset: 0, lowerInsetSeed: 27182, upperInset: 0, upperInsetSeed: 16180,
  middleInset: 0, middleInsetSeed: 22360,
  topTangential: 0, topTangentialSeed: 57721, bottomTangential: 0, bottomTangentialSeed: 14142,
};
export const sineDefaults: RectangleRecipe = { ...rectangleDefaults, motion: 'sine', alternateOrbit: true };
export const rectangleLimits = {
  thicknessAmplitude: [0, 95], thicknessCycles: [.25, 12],
  sectionSides: [8, 128], count: [3, 512], width: [0.4, 40], depth: [1, 40], diameter: [0, 280], topDiameter: [0, 280],
  bottomSizeY: [0, 280], topSizeY: [0, 280],
  topInset: [-80, 80], insetSeed: [0, 999999], bottomInset: [-80, 80], bottomInsetSeed: [0, 999999],
  lowerInset: [-80, 80], lowerInsetSeed: [0, 999999], upperInset: [-80, 80], upperInsetSeed: [0, 999999],
  middleInset: [-80, 80], middleInsetSeed: [0, 999999],
  topTangential: [0, 100], topTangentialSeed: [0, 999999], bottomTangential: [0, 100], bottomTangentialSeed: [0, 999999],
  twistSeed: [0, 999999],
  height: [10, 345], twist: [-180, 180], orbitTwist: [-180, 180], layerHeight: [0.1, 1],
  waveAmplitude: [0, 30], waveCycles: [0.25, 12],
  turnPower: [1, 5], waveEndCycles: [0.25, 12], wanderAmplitude: [0, 30], wanderBends: [1, 10], wanderSeed: [0, 999999],
  topWidth: [0.4, 40], topDepth: [1, 40], phaseTurns: [-6, 6],
  discHole: [0, 260], discThickness: [0.5, 10], bulge: [-60, 60], bulgeLower: [-60, 60], bulgeUpper: [-60, 60],
} as const;

/** Shared shape-editor/build check: widths may be small, but cannot collapse or invert. */
export function outlineProfileError(axis:string,range:{min:number;max:number}):string|undefined {
  if(!Number.isFinite(range.min)||!Number.isFinite(range.max))return `The ${axis} spline has a non-finite size. Adjust the level dimensions or heights.`;
  if(range.min<=0)return `The ${axis} spline reaches ${Number(range.min.toPrecision(5))} mm: widths must stay greater than zero, including between levels. Widen the narrow levels or soften the size changes.`;
  if(range.max>280+1e-8)return `The ${axis} spline reaches ${Number(range.max.toPrecision(5))} mm, above the 280 mm maximum. Reduce the level sizes or soften the size changes.`;
}

export function validateRectangles(value: unknown): RectangleRecipe {
  if (!value || typeof value !== 'object') throw new Error('Recipe must be a JSON object.');
  const source = value as Record<string, unknown>;
  const twoBulges = source.twoBulges ?? false;
  if (typeof twoBulges !== 'boolean') throw new Error('Two bulge points must be true or false.');
  const result = {} as RectangleRecipe;
  if(source.strandStyle==='blocks')throw new Error('Stacked bricks has been retired. This recipe requires the archived stacked-bricks version; it cannot be loaded as continuous strands.');
  if(source.strandStyle!==undefined&&source.strandStyle!=='continuous')throw new Error('Unknown strand construction.');
  const spacing=source.strandSpacing??'angle',scaling=source.scaleWithPerimeter??false;
  if(spacing!=='angle'&&spacing!=='perimeter')throw new Error('Unknown strand spacing.');
  if(typeof scaling!=='boolean')throw new Error('Scale with outline perimeter must be true or false.');
  result.strandSpacing=spacing;result.scaleWithPerimeter=scaling;
  const placement=source.strandPlacement??'inside';
  if(placement!=='inside'&&placement!=='fixed')throw new Error('Unknown strand centre placement.');
  result.strandPlacement=placement;
  // The briefly available random modifier is retired; preserve all other recipe settings.
  const thicknessMode=source.thicknessModulation==='random'?'none':source.thicknessModulation??'none';
  if(!['none','sine','sineSquared','triangle'].includes(thicknessMode as string))throw new Error('Unknown strand thickness modulation.');
  result.thicknessModulation=thicknessMode as RectangleRecipe['thicknessModulation'];
  const alternateThickness=source.alternateThickness??false;
  if(typeof alternateThickness!=='boolean')throw new Error('Alternate thickness phase must be on or off.');
  result.alternateThickness=alternateThickness;
  result.smoothCavity=undefined;
  if(source.smoothCavity!==undefined) {
    const cavity=source.smoothCavity as {inset:number;floor:number;repairInset?:number;fillPockets?:boolean};
    if(!cavity || !Number.isFinite(cavity.inset) || cavity.inset<0.5 || cavity.inset>60
      || !Number.isFinite(cavity.floor) || (cavity.floor!==0 && cavity.floor<0.5) || cavity.floor>=Number(source.height))
      throw new Error('Smooth cavity: inset must be 0.5–60 mm and bottom thickness must be 0 (off) or at least 0.5 mm, below the total height.');
    result.smoothCavity={inset:cavity.inset,floor:cavity.floor};
    if(cavity.fillPockets!==undefined&&typeof cavity.fillPockets!=='boolean')
      throw new Error('Smooth interior: Fill enclosed wall pockets must be on or off.');
    if(cavity.fillPockets)result.smoothCavity.fillPockets=true;
    if(cavity.repairInset!==undefined) {
      if(!Number.isFinite(cavity.repairInset)||cavity.repairInset < -60||cavity.repairInset>60||cavity.inset-cavity.repairInset<.25)
        throw new Error('Smooth cavity repair: outer fill inset must be −60 to 60 mm and at least 0.25 mm smaller than the inner cavity inset.');
      result.smoothCavity.repairInset=cavity.repairInset;
    }
  }
  result.bulgePoints = undefined;
  if (source.bulgePoints !== undefined) {
    if (!Array.isArray(source.bulgePoints))
      throw new Error('Interior levels must be a list.');
    let previous = 0;
    result.bulgePoints = source.bulgePoints.map((raw, i) => {
      if (!raw || typeof raw !== 'object') throw new Error(`Bulge point ${i+1} is invalid.`);
      const {height, bulge, offset, seed} = raw;
      if (![height,bulge,offset,seed].every(n => typeof n === 'number' && Number.isFinite(n))
        || height <= previous || height >= 100 || bulge < -60 || bulge > 60 || offset < -80 || offset > 80
        || !Number.isInteger(seed) || seed < 0 || seed > 999999)
        throw new Error(`Bulge point ${i+1}: heights must increase between the bottom and the sculpture's top, bulges must be −60 to 60 mm, offsets −80 to 80%, and seeds whole numbers from 0 to 999999.`);
      previous = height;
      const point:BulgePoint={height,bulge,offset,seed};
      for(const key of ['centerX','centerY'] as const)if(raw[key]!==undefined) {
        if(!Number.isFinite(raw[key])||Math.abs(raw[key])>CENTER_LIMIT)throw new Error(`Level ${i+1}: centre offsets must be −${CENTER_LIMIT} to ${CENTER_LIMIT} mm.`);
        point[key]=raw[key];
      }
      if(raw.sizeX!==undefined||raw.sizeY!==undefined) {
        if(!Number.isFinite(raw.sizeX)||!Number.isFinite(raw.sizeY)||raw.sizeX<=0||raw.sizeX>280||raw.sizeY<=0||raw.sizeY>280)
          throw new Error(`Level ${i+1}: X and Y sizes must be greater than zero and at most 280 mm.`);
        point.sizeX=raw.sizeX;point.sizeY=raw.sizeY;
      }
      if(raw.lockProportions!==undefined) {
        if(typeof raw.lockProportions!=='boolean')throw new Error(`Level ${i+1}: Lock proportions must be on or off.`);
        point.lockProportions=raw.lockProportions;
      }
      return point;
    });
  }
  for(const key of ['bottomCenterX','bottomCenterY','topCenterX','topCenterY'] as const) {
    result[key]=undefined;if(source[key]===undefined)continue;
    const v=source[key];if(typeof v!=='number'||!Number.isFinite(v)||Math.abs(v)>CENTER_LIMIT)throw new Error(`Centre offsets must be −${CENTER_LIMIT} to ${CENTER_LIMIT} mm.`);
    result[key]=v;
  }
  for(const key of ['bottomProportionsLocked','topProportionsLocked'] as const)if(source[key]!==undefined) {
    if(typeof source[key]!=='boolean')throw new Error('Lock proportions must be on or off.');
    result[key]=source[key];
  }
  result.twoBulges = twoBulges;
  const outline = source.outline ?? 'circle';
  if (!['circle','square','rectangle','ellipse','hexagon'].includes(outline as string)) throw new Error('Unknown overall outline.');
  result.outline = outline as RectangleRecipe['outline'];
  const section = source.section ?? 'rectangle';
  if (!['rectangle','diamond','triangle','hexagon','circle','ellipse','custom'].includes(section as string)) throw new Error('Unknown plank cross-section.');
  result.section = section as RectangleRecipe['section'];
  for (const [key,allowed] of [['topSection',['rectangle','diamond','triangle','hexagon','circle','ellipse','custom']],['topOutline',['circle','square','rectangle','ellipse','hexagon']]] as const) {
    const v=source[key];
    if(v!==undefined && !(allowed as readonly unknown[]).includes(v))throw new Error(`Unknown ${key==='topSection'?'top strand shape':'top outline'}.`);
    (result as unknown as Record<string,unknown>)[key]=v;
  }
  for(const key of ['customProfile','topCustomProfile'] as const)
    result[key]=source[key]===undefined?undefined:validateCustomProfile(source[key],key==='customProfile'?'Bottom polygon':'Top polygon');
  if(hasSectionTransition(result)) {
    for(const [shape,points,label] of [[result.section,result.customProfile,'Bottom'],[result.topSection,result.topCustomProfile,'Top']] as const)
      if(shape==='custom'&&!supportsProfileTransition(points??defaultCustomProfile))
        throw new Error(`${label} custom polygon cannot blend into another end shape: use a convex polygon containing its bounding-box centre, or choose “Same as bottom”. Inward corners work when the same polygon is used along the strand.`);
  }
  const taperSection = source.taperSection ?? false;
  if (typeof taperSection !== 'boolean') throw new Error('Taper plank section must be true or false.');
  result.taperSection = taperSection;
  for (const key of Object.keys(rectangleLimits) as (keyof typeof rectangleLimits)[]) {
    const raw = (value as Record<string, unknown>)[key];
    const legacyDefault = key === 'bottomSizeY' ? source.diameter : key === 'topSizeY' ? (source.topDiameter ?? source.diameter) : key === 'topWidth' ? source.width : key === 'topDepth' ? source.depth : key === 'topDiameter' ? source.diameter : ['thicknessAmplitude','thicknessCycles','twistSeed','turnPower','waveEndCycles','wanderAmplitude','wanderBends','wanderSeed','sectionSides','waveAmplitude','waveCycles','discHole','discThickness','bulge','bulgeLower','bulgeUpper','phaseTurns','topInset','insetSeed','bottomInset','bottomInsetSeed'].includes(key)
      ? rectangleDefaults[key] : (key === 'twist' || key === 'orbitTwist') ? 0 : undefined;
    const n = raw === undefined ? (legacyDefault ?? (['middleInset','middleInsetSeed','lowerInset','lowerInsetSeed','upperInset','upperInsetSeed','topTangential','topTangentialSeed','bottomTangential','bottomTangentialSeed'].includes(key) ? rectangleDefaults[key] : undefined)) : raw;
    const [min, max] = rectangleLimits[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) {
      throw new Error(`${key} must be between ${min} and ${max}.`);
    }
    if (['diameter','topDiameter','bottomSizeY','topSizeY'].includes(key) && n <= 0)
      throw new Error(`${key} must be greater than zero.`);
    result[key] = n;
  }
  if (!Number.isInteger(result.sectionSides) || result.sectionSides % 4 !== 0) throw new Error('Round sides must be a multiple of 4 between 8 and 128.');
  const alternate = (value as Record<string, unknown>).alternateOrbit ?? false;
  if (typeof alternate !== 'boolean') throw new Error('Alternate direction must be true or false.');
  result.alternateOrbit = alternate;
  const alternateTwist = (value as Record<string, unknown>).alternateTwist;
  if (alternateTwist !== undefined && typeof alternateTwist !== 'boolean') throw new Error('Alternate own-axis twist must be true or false.');
  result.alternateTwist = alternateTwist ?? false;
  const randomTwist = source.randomTwist ?? false;
  if (typeof randomTwist !== 'boolean') throw new Error('Random own-axis twist must be true or false.');
  result.randomTwist = randomTwist;
  if (!Number.isInteger(result.twistSeed)) throw new Error('Random twist seed must be a whole number.');
  const bottomDisc = (value as Record<string, unknown>).bottomDisc;
  if (bottomDisc !== undefined && typeof bottomDisc !== 'boolean') throw new Error('Bottom disc must be true or false.');
  result.bottomDisc = bottomDisc ?? false;
  const motion = (value as Record<string, unknown>).motion ?? 'helix';
  if (!['helix','sine','accelerating','chirp','wander','zigzag'].includes(motion as string)) throw new Error('Unknown path motion.');
  result.motion = motion as RectangleRecipe['motion'];
  const reverseAcceleration=source.reverseAcceleration??false;
  if(typeof reverseAcceleration!=='boolean')throw new Error('Reverse acceleration must be true or false.');
  result.reverseAcceleration=reverseAcceleration;
  for(const key of ['turnPower','wanderBends','wanderSeed'] as const)
    if(!Number.isInteger(result[key]))throw new Error(`${key} must be a whole number.`);
  if (!Number.isInteger(result.phaseTurns)) throw new Error('Phase turns must be a whole number so the pattern closes around the circle.');
  if (!Number.isInteger(result.count)) throw new Error('Rectangle count must be an integer.');
  if (!Number.isInteger(result.insetSeed)) throw new Error('Random inset seed must be a whole number.');
  if (!Number.isInteger(result.bottomInsetSeed)) throw new Error('Bottom inset seed must be a whole number.');
  for(const key of ['middleInsetSeed','lowerInsetSeed','upperInsetSeed','topTangentialSeed','bottomTangentialSeed'] as const)
    if(!Number.isInteger(result[key]))throw new Error(`${key} must be a whole number.`);
  if ((alternate || result.alternateTwist) && result.count % 2 !== 0) throw new Error('Use an even plank count to alternate directions all the way around.');
  if(hasThicknessModulation(result)&&result.alternateThickness&&result.count%2!==0)throw new Error('Use an even strand count for alternating thickness phases around the entire outline.');
  const envelope = rectangleDiameterRange(result);
  const xError=outlineProfileError('X',envelope);if(xError)throw new Error(xError);
  if (hasOutlineY(result)) {
    const y = rectangleDiameterRange(outlineYRecipe(result));
    const yError=outlineProfileError('Y',y);if(yError)throw new Error(yError);
  }
  const maximum = maximumSection(result);
  const inner = edgeAtDiameter({...result,width:maximum.width}, outlineInscribedDiameter(result)) - maximum.depth;
  if(result.strandPlacement==='fixed'||result.scaleWithPerimeter || hasThicknessModulation(result)) {
    const heights=[...Array.from({length:129},(_,i)=>result.height*i/128),...editableBulgePoints(result).map(p=>p.height/100*result.height)];
    for(const z of heights){const baseSize=baseSectionSizeAt(result,z),factor=thicknessMaximumScale(result),size={width:baseSize.width*factor,depth:baseSize.depth*factor},d=outlineInscribedDiameter(result,z,z);
      if(result.strandPlacement==='fixed') {
        const anchorDepth=result.section==='circle'?result.width:result.depth;
        if(result.width>=d || edgeAtDiameter(result,d)<=anchorDepth)
          throw new Error(`Fixed strand centres cannot fit the bottom strand profile near height ${Number(z.toFixed(2))} mm. Reduce the bottom strand dimensions, widen this level, or choose Fit inside outline.`);
      }
      if(!Number.isFinite(size.width)||!Number.isFinite(size.depth)||size.width>=d||edgeAtDiameter({...result,width:size.width},d)<=size.depth)
        throw new Error(`Scaled strands are too large for the outline near height ${Number(z.toFixed(2))} mm. Reduce the strand dimensions or thickness-wave amplitude, or widen that part of the outline.`);
    }
  } else if (inner <= 0) throw new Error('Reduce the depth or increase the diameter to keep rectangles outside the centre.');
  if (result.bottomDisc) {
    if (result.discThickness >= result.height) throw new Error('The bottom disc must be thinner than the sculpture height.');
    if(result.bulgePoints ? result.bulgePoints.some(p=>p.offset!==0 && result.discThickness>=p.height/100*result.height) : result.twoBulges ? ((Math.abs(result.lowerInset)>0 && result.discThickness>=result.height/3) || (Math.abs(result.upperInset)>0 && result.discThickness>=2*result.height/3)) : (Math.abs(result.middleInset)>0 && result.discThickness>=result.height/2))
      throw new Error('Reduce the plate thickness: random bulge points must sit above the plate.');
    if(result.discHole>0) {
    if (result.discHole >= outlineInscribedDiameter(result,0,0)) throw new Error('The centre hole must fit inside the bottom outline.');
    const low = baseSectionSizeAt(result,result.discThickness/2), high = baseSectionSizeAt(result,result.discThickness);
    const factor=thicknessMaximumScale(result);
    const width = Math.max(low.width,high.width)*factor, depth = Math.max(low.depth,high.depth)*factor;
    let clearRadius = edgeAtDiameter({...result,width}, outlineInscribedDiameter(result, result.discThickness / 2, result.discThickness))
      - depth / 2 - Math.hypot(depth,width) / 2;
    if(result.bottomInset>0) {
      const x=rectangleDiameterRange(result,result.discThickness/2,result.discThickness).max;
      const y=hasOutlineY(result)?rectangleDiameterRange(outlineYRecipe(result),result.discThickness/2,result.discThickness).max:x;
      const radius=result.outline==='square'||result.outline==='rectangle'?Math.hypot(x,y)/2:Math.max(x,y)/2;
      clearRadius-=result.bottomInset/100*radius;
      if(result.discHole/2>=clearRadius)throw new Error('The bottom inset can reach the plate hole. Reduce the bottom inset or centre hole, or enlarge the bottom outline.');
    }
    if (result.discHole / 2 >= clearRadius) throw new Error('Reduce the centre hole so it stays clear of the planks.');
    }
  }
  // Plank intersections are intentional. The build pipeline unions any geometry
  // that cannot be proven separate instead of rejecting dense settings here.
  return result;
}

export function hasPhaseShift(recipe: RectangleRecipe): boolean {
  return (recipe.motion === 'sine' || recipe.motion === 'chirp') && (recipe.phaseTurns ?? 0) !== 0 && recipe.waveAmplitude !== 0;
}

/** Shared bottom-relative scale for strands and their smooth interior surfaces. */
export function strandPerimeterScaleAt(recipe: RectangleRecipe, z: number) {
  return recipe.scaleWithPerimeter
    ? outlinePerimeterAt(recipe,z)/outlinePerimeterAt(recipe,0) : 1;
}

/** Base dimensions before per-strand modifiers; also used for UI summaries. */
export function baseSectionSizeAt(recipe: RectangleRecipe, z: number) {
  const t=Math.max(0,Math.min(1,z/recipe.height));
  if(recipe.scaleWithPerimeter) {
    const scale=strandPerimeterScaleAt(recipe,z);
    // A shape transition may change the profile, but automatic sizing ignores manual top sizes.
    const bottomDepth=recipe.section==='circle'?recipe.width:recipe.depth;
    const topDepth=recipe.topSection==='circle'?recipe.width:bottomDepth;
    return {width:recipe.width*scale,depth:(bottomDepth+(topDepth-bottomDepth)*smoothTransition(t))*scale};
  }
  if(hasSectionTransition(recipe)) {
    const bottomDepth=recipe.section==='circle'?recipe.width:recipe.depth;
    const topDepth=recipe.topSection==='circle'?recipe.topWidth:recipe.topDepth;
    const u=smoothTransition(t);
    return {width:recipe.width+(recipe.topWidth-recipe.width)*u,depth:bottomDepth+(topDepth-bottomDepth)*u};
  }
  const width=recipe.width+(recipe.taperSection?(recipe.topWidth-recipe.width)*t:0);
  return {width,depth:recipe.section==='circle'?width:recipe.depth+(recipe.taperSection?(recipe.topDepth-recipe.depth)*t:0)};
}

/** Modifiers compose multiplicatively after taper, perimeter sizing and shape morph. */
export function sectionSizeAt(recipe: RectangleRecipe, z: number, index=0) {
  const base=baseSectionSizeAt(recipe,z),scale=thicknessScaleAt(recipe,z,index);
  return scale===1?base:{width:base.width*scale,depth:base.depth*scale};
}

function maximumSection(recipe: RectangleRecipe) {
  const scale=thicknessMaximumScale(recipe);
  if(recipe.scaleWithPerimeter) {
    const sizes=Array.from({length:129},(_,i)=>baseSectionSizeAt(recipe,recipe.height*i/128));
    return {width:scale*Math.max(...sizes.map(s=>s.width)),depth:scale*Math.max(...sizes.map(s=>s.depth))};
  }
  const bottom=baseSectionSizeAt(recipe,0),top=baseSectionSizeAt(recipe,recipe.height);
  return {width:scale*Math.max(bottom.width,top.width),depth:scale*Math.max(bottom.depth,top.depth)};
}

/** Circular displacement in degrees. Anchor each phase at zero at the base. */
export function orbitAngle(recipe: RectangleRecipe, z: number, index = 0): number {
  return pathAngle(recipe,z,index);
}

/** Maximum absolute orbit derivative, radians per millimetre of height. */
function orbitRateBound(recipe: RectangleRecipe): number {
  return pathDerivativeBounds(recipe).rate * Math.PI / 180 / recipe.height;
}

export function orbitPathTilt(recipe: RectangleRecipe): number {
  return Math.atan(rectangleDiameterRange(recipe).max / 2 * orbitRateBound(recipe)) * 180 / Math.PI;
}

/** Natural cubic spline through bottom, 1/3, 2/3 and top diameters.
 * Bulges are radial offsets from the straight taper at the two interior knots.
 * Local u runs from 0 to 1 in each segment; end second derivatives are zero. */
export function editableBulgePoints(recipe: RectangleRecipe): BulgePoint[] {
  return recipe.bulgePoints?.map(p=>({...p})) ?? (recipe.twoBulges
    ? [{height:100/3,bulge:recipe.bulgeLower,offset:-recipe.lowerInset,seed:recipe.lowerInsetSeed},
       {height:200/3,bulge:recipe.bulgeUpper,offset:-recipe.upperInset,seed:recipe.upperInsetSeed}]
    : [{height:50,bulge:recipe.bulge,offset:-recipe.middleInset,seed:recipe.middleInsetSeed}]);
}

/** Selecting a count also supplies evenly spaced height presets (½; ⅓ and ⅔). */
export function presetBulgePoints(recipe: RectangleRecipe, count: number): BulgePoint[] {
  if (!Number.isSafeInteger(count) || count<0 || recipe.height/(count+1)<.5) throw new Error('Choose a nonnegative level count with at least 0.5 mm between levels.');
  const old=editableBulgePoints(recipe);
  return Array.from({length:count},(_,i)=>({...old[i] ?? {bulge:0,offset:0,seed:(22360+i*7919)%1000000},height:100*(i+1)/(count+1)}));
}

type SplineSegment = {a:number;b:number;c:number;d:number;end:number;start:number;span:number};
const splineCache = new Map<string,SplineSegment[]>();
function diameterSpline(recipe: RectangleRecipe): SplineSegment[] {
  if (recipe.bulgePoints) {
    const key=JSON.stringify([recipe.diameter,recipe.topDiameter,recipe.bulgePoints.map(p=>[p.height,p.sizeX,p.bulge])]);
    const cached=splineCache.get(key); if(cached)return cached;
    const x=[0,...recipe.bulgePoints.map(p=>p.height/100),1];
    const delta=recipe.topDiameter-recipe.diameter;
    const y=[recipe.diameter,...recipe.bulgePoints.map(p=>p.sizeX??(recipe.diameter+delta*p.height/100+2*p.bulge)),recipe.topDiameter];
    const n=x.length,h=x.slice(1).map((v,i)=>v-x[i]),m=Array(n).fill(0),b=Array(n).fill(0),r=Array(n).fill(0);
    // Tridiagonal natural spline solve, with zero second derivative at both ends.
    for(let i=1;i<n-1;i++) {
      b[i]=2*(h[i-1]+h[i]);
      r[i]=6*((y[i+1]-y[i])/h[i]-(y[i]-y[i-1])/h[i-1]);
      if(i>1){const f=h[i-1]/b[i-1];b[i]-=f*h[i-1];r[i]-=f*r[i-1];}
    }
    for(let i=n-2;i>0;i--)m[i]=(r[i]-h[i]*m[i+1])/b[i];
    const segments=h.map((s,i)=>({a:y[i],b:y[i+1]-y[i]-s*s*(2*m[i]+m[i+1])/6,
      c:m[i]*s*s/2,d:(m[i+1]-m[i])*s*s/6,end:y[i+1],start:x[i],span:s}));
    if(splineCache.size>=128)splineCache.clear();splineCache.set(key,segments);return segments;
  }
  const bottom = recipe.diameter, top = recipe.topDiameter ?? bottom;
  const delta = top - bottom;
  const y = [bottom, bottom + delta / 3 + 2 * (recipe.bulgeLower ?? 0),
    bottom + 2 * delta / 3 + 2 * (recipe.bulgeUpper ?? 0), top];
  const r1 = 6 * (y[2] - 2 * y[1] + y[0]), r2 = 6 * (y[3] - 2 * y[2] + y[1]);
  const m = [0, (4 * r1 - r2) / 15, (4 * r2 - r1) / 15, 0];
  return [0, 1, 2].map(i => ({a: y[i], b: y[i+1] - y[i] - (2*m[i]+m[i+1])/6,
    c: m[i]/2, d: (m[i+1]-m[i])/6, end: y[i+1],start:i/3,span:1/3}));
}

function splineValue(s: SplineSegment, u: number) {
  return u === 1 ? s.end : ((s.d*u+s.c)*u+s.b)*u+s.a;
}
function stationaryPoints(s: SplineSegment): number[] {
  const a=3*s.d, b=2*s.c, c=s.b;
  if (a === 0) return b === 0 ? [] : [-c/b];
  const discriminant=b*b-4*a*c;
  if (discriminant < 0) return [];
  // Stable quadratic roots avoid cancellation for nearly linear segments.
  const q=-.5*(b+(b>=0?1:-1)*Math.sqrt(discriminant));
  return q === 0 ? [-b/(2*a)] : [q/a,c/q];
}

export function rectangleDiameterAt(recipe: RectangleRecipe, z: number): number {
  if (!recipe.twoBulges && !recipe.bulgePoints) {
    const t=z/recipe.height;
    return recipe.diameter+((recipe.topDiameter??recipe.diameter)-recipe.diameter)*t+8*(recipe.bulge??0)*t*(1-t);
  }
  if(!recipe.bulgePoints) {
    const x=3*z/recipe.height,i=Math.max(0,Math.min(2,Math.floor(x)));
    return splineValue(diameterSpline(recipe)[i],x-i);
  }
  const t=z/recipe.height,segments=diameterSpline(recipe);
  const s=segments.find(s=>t<=s.start+s.span) ?? segments[segments.length-1];
  return splineValue(s,(t-s.start)/s.span);
}

/** Exact extrema of every cubic segment, including overshoot between knots. */
export function rectangleDiameterRange(recipe: RectangleRecipe, from = 0, to = recipe.height) {
  if (!recipe.twoBulges && !recipe.bulgePoints) {
    const samples=[rectangleDiameterAt(recipe,from),rectangleDiameterAt(recipe,to)];
    const bulge=recipe.bulge??0;
    if (bulge !== 0) {
      const z=(((recipe.topDiameter??recipe.diameter)-recipe.diameter)+8*bulge)/(16*bulge)*recipe.height;
      if (z>from && z<to) samples.push(rectangleDiameterAt(recipe,z));
    }
    return {min:Math.min(...samples),max:Math.max(...samples)};
  }
  const samples: number[] = [];
  diameterSpline(recipe).forEach(s => {
    const lo=Math.max(0,(from/recipe.height-s.start)/s.span), hi=Math.min(1,(to/recipe.height-s.start)/s.span);
    if (lo > hi) return;
    samples.push(splineValue(s,lo),splineValue(s,hi));
    for (const u of stationaryPoints(s)) if (u > lo && u < hi) samples.push(splineValue(s,u));
  });
  return { min: Math.min(...samples), max: Math.max(...samples) };
}

function radiusDerivativeBounds(recipe: RectangleRecipe) {
  if (!recipe.twoBulges && !recipe.bulgePoints) return {
    rate:(Math.abs((recipe.topDiameter??recipe.diameter)-recipe.diameter)/2+4*Math.abs(recipe.bulge??0))/recipe.height,
    acceleration:8*Math.abs(recipe.bulge??0)/recipe.height**2,
  };
  let rate=0, acceleration=0;
  for (const s of diameterSpline(recipe)) {
    const candidates=[0,1];
    const vertex=-s.c/(3*s.d);
    if (vertex>0 && vertex<1) candidates.push(vertex);
    for (const u of candidates) rate=Math.max(rate,Math.abs((3*s.d*u+2*s.c)*u+s.b)/(s.span*recipe.height*2));
    acceleration=Math.max(acceleration,Math.abs(2*s.c)/(2*(s.span*recipe.height)**2),Math.abs(2*s.c+6*s.d)/(2*(s.span*recipe.height)**2));
  }
  return {rate, acceleration};
}

// Both outer corners touch the circle. A tangent outer edge would put them outside it.
function outerEdge(recipe: RectangleRecipe, z = 0, index=0): number {
  const diameter = rectangleDiameterAt(recipe,z);
  return !recipe.section || recipe.section === 'rectangle'
    ? edgeAtDiameter({...recipe,width:sectionSizeAt(recipe,z,index).width},diameter) : diameter/2;
}

function edgeAtDiameter(recipe: RectangleRecipe, diameter: number): number {
  return Math.sqrt((diameter / 2) ** 2 - (recipe.width / 2) ** 2);
}

/** Conservative minimum gap between the swept disks of adjacent planks, in mm. */
export function rectangleClearance(recipe: RectangleRecipe, sampleStep = recipe.layerHeight): number {
  if(recipe.strandPlacement==='fixed'||recipe.scaleWithPerimeter || hasThicknessModulation(recipe))return -1;
  // The circular separation proof does not cover changing radial distances at
  // polygon corners. Route those outlines through the checked Boolean union.
  if (recipe.section==='custom' || (recipe.motion==='wander' && recipe.wanderAmplitude!==0) || hasPhaseShift(recipe) || hasSectionTransition(recipe) || hasOutlineY(recipe) || hasOutlineTransition(recipe) || hasRandomOffsets(recipe) || (recipe.outline && recipe.outline !== 'circle')) return -1;
  const maximum = maximumSection(recipe);
  const centre = edgeAtDiameter({...recipe,width:maximum.width}, rectangleDiameterRange(recipe).min) - maximum.depth / 2;
  // Interpolated mesh rings follow chords; use their smallest centre radius too.
  const stepAngle = orbitRateBound(recipe) * Math.min(sampleStep, recipe.height);
  return 2 * centre * Math.cos(stepAngle / 2) * Math.sin(Math.PI / recipe.count) - Math.hypot(maximum.depth,maximum.width);
}

// Convex, counterclockwise sections in a unit depth × width bounding box.
const sections: Record<Exclude<RectangleRecipe['section'],'custom'>, [number,number][]> = {
  rectangle: [[-.5,-.5],[.5,-.5],[.5,.5],[-.5,.5]],
  diamond: [[-.5,0],[0,-.5],[.5,0],[0,.5]],
  triangle: [[-.5,-.5],[.5,0],[-.5,.5]],
  hexagon: [[-.5,0],[-.25,-.5],[.25,-.5],[.5,0],[.25,.5],[-.25,.5]],
  circle: Array.from({length:32},(_,i)=>[.5*Math.cos(i*Math.PI/16),.5*Math.sin(i*Math.PI/16)]),
  ellipse: Array.from({length:32},(_,i)=>[.5*Math.cos(i*Math.PI/16),.5*Math.sin(i*Math.PI/16)]),
};

// Cache unit profiles: outline placement and every height ring share these points.
const roundSections = new Map<number, [number,number][]>([[32,sections.circle]]);
export function hasSectionTransition(recipe:RectangleRecipe) {
  return !!recipe.topSection&&(recipe.topSection!==recipe.section||(recipe.section==='custom'&&JSON.stringify(recipe.customProfile??defaultCustomProfile)!==JSON.stringify(recipe.topCustomProfile??defaultCustomProfile)));
}
export function hasOutlineTransition(recipe:RectangleRecipe) { return !!recipe.topOutline && recipe.topOutline!==recipe.outline; }
function fixedStrandSection(recipe: RectangleRecipe): [number,number][] {
  if(recipe.section==='custom')return recipe.customProfile??defaultCustomProfile;
  if (recipe.section !== 'circle' && recipe.section !== 'ellipse') return sections[recipe.section ?? 'rectangle'];
  const sides=recipe.sectionSides ?? 32;
  let points=roundSections.get(sides);
  if (!points) {
    points=Array.from({length:sides},(_,i)=>[.5*Math.cos(i*Math.PI/(sides/2)),.5*Math.sin(i*Math.PI/(sides/2))]);
    roundSections.set(sides,points);
  }
  return points;
}
const sectionTransitionCache=new WeakMap<RectangleRecipe,Map<number,[number,number][]>>();
function strandSection(recipe:RectangleRecipe,z=0):[number,number][] {
  if(!hasSectionTransition(recipe))return fixedStrandSection(recipe);
  let cache=sectionTransitionCache.get(recipe);
  if(!cache){cache=new Map();sectionTransitionCache.set(recipe,cache);}
  let points=cache.get(z);
  if(!points){
    points=morphProfile(fixedStrandSection(recipe),fixedStrandSection({...recipe,section:recipe.topSection!,customProfile:recipe.topCustomProfile}),smoothTransition(z/recipe.height));
    cache.set(z,points);
  }
  return points;
}
export function hasOutlineY(recipe: RectangleRecipe): boolean {
  return hasOutlineTransition(recipe) || recipe.outline === 'rectangle' || recipe.outline === 'ellipse' || !!recipe.bulgePoints?.some(p=>p.sizeY!==undefined && (p.sizeX===undefined || p.sizeY!==p.sizeX*(recipe.outline==='hexagon'?Math.sqrt(3)/2:1)));
}

export function outlineYRecipe(recipe: RectangleRecipe): RectangleRecipe {
  const span=(shape:RectangleRecipe['outline'],x:number,y:number)=>shape==='rectangle'||shape==='ellipse'?y:shape==='hexagon'?x*Math.sqrt(3)/2:x;
  const explicit=recipe.bulgePoints?.some(p=>p.sizeY!==undefined);
  return {...recipe,
    diameter:span(recipe.outline,recipe.diameter,recipe.bottomSizeY),
    topDiameter:span(recipe.topOutline??recipe.outline,recipe.topDiameter,recipe.topSizeY),
    ...(explicit?{bulgePoints:recipe.bulgePoints!.map(p=>({...p,sizeX:p.sizeY}))}:{})};
}

/** The two full dimensions at each editable spline level. */
export function dimensionedBulgePoints(recipe:RectangleRecipe) {
  return editableBulgePoints(recipe).map(p=>{
    const size=outlineSizeAt(recipe,p.height*recipe.height/100);
    const center=centerAt(recipe,p.height*recipe.height/100);
    return {...p,centerX:p.centerX??center.x,centerY:p.centerY??center.y,sizeX:p.sizeX??size.x,sizeY:p.sizeY??size.y,lockProportions:p.lockProportions??true};
  });
}

/** Nominal spans; a regular hexagon is measured across its X corner pair. */
export function outlineSizeAt(recipe: RectangleRecipe, z: number) {
  const x = rectangleDiameterAt(recipe,z);
  const y = hasOutlineY(recipe) ? rectangleDiameterAt(outlineYRecipe(recipe),z)
    : recipe.outline === 'hexagon' ? x*Math.sqrt(3)/2 : x;
  return {x,y};
}

export function outlineInscribedDiameter(recipe: RectangleRecipe, from = 0, to = recipe.height): number {
  const x = rectangleDiameterRange(recipe,from,to).min;
  const y=hasOutlineY(recipe)?rectangleDiameterRange(outlineYRecipe(recipe),from,to).min:recipe.outline==='hexagon'?x*Math.sqrt(3)/2:x;
  return [recipe.outline,recipe.topOutline].includes('hexagon')?Math.min(y,2/Math.hypot(2/x,1/y)):Math.min(x,y);
}

/** Counterclockwise bottom plate outline. The circular bore is independent. */
export function outlinePolygon(recipe: RectangleRecipe, z = 0, segments=512): [number,number][] {
  if(hasOutlineTransition(recipe)) {
    const size=outlineSizeAt(recipe,z);
    return outlineMorphPoints(recipe.outline,recipe.topOutline!,smoothTransition(z/recipe.height),segments).map(([x,y])=>[x*size.x,y*size.y]);
  }
  const {x,y} = outlineSizeAt(recipe,z);
  if (recipe.outline === 'square' || recipe.outline === 'rectangle') {
    return [[-x/2,-y/2],[x/2,-y/2],[x/2,y/2],[-x/2,y/2]];
  }
  const n = recipe.outline === 'hexagon' ? 6 : 512;
  return Array.from({length:n},(_,i)=> {
    const a=2*Math.PI*i/n;
    return [x/2*Math.cos(a),(recipe.outline === 'hexagon' ? y*2/Math.sqrt(3) : y)/2*Math.sin(a)];
  });
}

/** Nominal outline only: random offsets and centre translations do not change its perimeter. */
function travelAt(recipe:RectangleRecipe,z:number) {
  const {x,y}=outlineSizeAt(recipe,z);
  return outlineTravel(recipe.outline,recipe.topOutline??recipe.outline,x,y,smoothTransition(z/recipe.height));
}
export function outlinePerimeterAt(recipe:RectangleRecipe,z:number) {return travelAt(recipe,z).perimeter;}
export function outlineAngleAtFraction(recipe:RectangleRecipe,fraction:number,z:number) {
  const point=travelAt(recipe,z).point(fraction);return Math.atan2(point[1],point[0]);
}
export function strandAngleAt(recipe:RectangleRecipe,index:number,z:number) {
  const direction=recipe.alternateOrbit&&index%2===1?-1:1;
  const turn=direction*orbitAngle(recipe,z,index);
  return recipe.strandSpacing==='perimeter'?outlineAngleAtFraction(recipe,index/recipe.count+turn/360,z):index*2*Math.PI/recipe.count+turn*Math.PI/180;
}

/** Move a rigid, untwisted section outward until a vertex reaches the outline.
 * All vertices stay inside the convex boundary. Own-axis twist is applied later,
 * preserving the same interpretation as the original circular implementation. */
function outlineCentre(recipe: RectangleRecipe, angle: number, z: number, index=0): number {
  const {x,y}=outlineSizeAt(recipe,z), size=sectionSizeAt(recipe,z,index);
  const c=Math.cos(angle),s=Math.sin(angle);
  const offsets=strandSection(recipe,z).map(([u,v])=>[u*size.depth*c-v*size.width*s,u*size.depth*s+v*size.width*c]);
  let centre=Infinity;
  if(recipe.scaleWithPerimeter || hasThicknessModulation(recipe)) {
    const t=smoothTransition(z/recipe.height);
    if(offsets.some(([u,v])=>(1-t)*outlineGauge(recipe.outline,u/x,v/y)+t*outlineGauge(recipe.topOutline??recipe.outline,u/x,v/y)>1))
      throw new Error(`Scaled strand section does not fit at height ${Number(z.toFixed(2))} mm. Reduce the bottom strand dimensions or widen the outline.`);
  }
  if(hasOutlineTransition(recipe)) {
    const t=smoothTransition(z/recipe.height);
    const gauge=(u:number,v:number)=>(1-t)*outlineGauge(recipe.outline,u/x,v/y)+t*outlineGauge(recipe.topOutline!,u/x,v/y);
    let lo=0,hi=outlineRadiusAt(recipe,angle,z);
    if(offsets.some(([u,v])=>gauge(u,v)>1))throw new Error('The strand section is too large for the changing outline. Reduce strand dimensions or enlarge the outline.');
    for(let k=0;k<32;k++) {
      const mid=(lo+hi)/2;
      if(offsets.every(([u,v])=>gauge(mid*c+u,mid*s+v)<=1))lo=mid;else hi=mid;
    }
    return lo;
  }
  if (!recipe.outline || recipe.outline === 'circle' || recipe.outline === 'ellipse') {
    const a=x/2,b=y/2,A=(c/a)**2+(s/b)**2;
    for (const [u,v] of offsets) {
      const B=c*u/a**2+s*v/b**2,C=(u/a)**2+(v/b)**2-1;
      centre=Math.min(centre,(-B+Math.sqrt(Math.max(0,B*B-A*C)))/A);
    }
  } else {
    const planes: [number,number,number][] = recipe.outline === 'hexagon'
      ? Array.from({length:6},(_,i)=>[Math.cos((i+.5)*Math.PI/3),Math.sin((i+.5)*Math.PI/3)*x*Math.sqrt(3)/(2*y),x*Math.sqrt(3)/4])
      : [[1,0,x/2],[-1,0,x/2],[0,1,y/2],[0,-1,y/2]];
    for (const [nx,ny,h] of planes) {
      const along=nx*c+ny*s;
      if (along <= 1e-12) continue;
      for (const [u,v] of offsets) centre=Math.min(centre,(h-nx*u-ny*v)/along);
    }
  }
  return centre;
}

/** Stable independent fraction for a plank, shared by preview, export and reload.
 * Integer mixing avoids consuming a random stream according to mesh density. */
export function randomUnit(index: number, seed: number): number {
  let n=(Math.imul(index+1,0x9e3779b9)^seed)>>>0;
  n=Math.imul(n^(n>>>16),0x85ebca6b);
  n=Math.imul(n^(n>>>13),0xc2b2ae35);
  return ((n^(n>>>16))>>>0)/4294967296;
}
export function plankInsetFraction(recipe: RectangleRecipe, index: number, end: 'top'|'bottom'|'lower'|'upper'|'middle' = 'top'): number {
  const amountKey=({top:'topInset',bottom:'bottomInset',lower:'lowerInset',upper:'upperInset',middle:'middleInset'} as const)[end];
  const seedKey=({top:'insetSeed',bottom:'bottomInsetSeed',lower:'lowerInsetSeed',upper:'upperInsetSeed',middle:'middleInsetSeed'} as const)[end];
  return randomUnit(index,recipe[seedKey]??rectangleDefaults[seedKey])*(recipe[amountKey]??0)/100;
}
export function hasRandomOffsets(recipe: RectangleRecipe): boolean {
  return Math.abs(recipe.topInset??0)>0 || Math.abs(recipe.bottomInset??0)>0 || recipe.topTangential>0 || recipe.bottomTangential>0
    || (recipe.bulgePoints ? recipe.bulgePoints.some(p=>p.offset!==0) : recipe.twoBulges ? (Math.abs(recipe.lowerInset??0)>0 || Math.abs(recipe.upperInset??0)>0) : Math.abs(recipe.middleInset??0)>0);
}

/** Distance from the axis to the nominal boundary along a polar ray. */
export function outlineRadiusAt(recipe: RectangleRecipe, angle: number, z: number): number {
  const {x,y}=outlineSizeAt(recipe,z),c=Math.cos(angle),s=Math.sin(angle);
  if(hasOutlineTransition(recipe)) {
    const t=smoothTransition(z/recipe.height);
    return 1/((1-t)*outlineGauge(recipe.outline,c/x,s/y)+t*outlineGauge(recipe.topOutline!,c/x,s/y));
  }
  if ((!recipe.outline || recipe.outline==='circle') && x===y) return x/2;
  if (!recipe.outline || recipe.outline==='circle' || recipe.outline==='ellipse') return 1/Math.hypot(2*c/x,2*s/y);
  if (recipe.outline==='hexagon') return 1/outlineGauge('hexagon',c/x,s/y);

  return Math.min(x/(2*Math.abs(c)),y/(2*Math.abs(s)));
}

export function plankInsetAt(recipe: RectangleRecipe,index: number,angle: number,z: number): number {
  const intermediate=recipe.bulgePoints ? true : recipe.twoBulges ? (Math.abs(recipe.lowerInset??0)>0 || Math.abs(recipe.upperInset??0)>0) : Math.abs(recipe.middleInset??0)>0;
  if (!(Math.abs(recipe.topInset??0)>0) && !(Math.abs(recipe.bottomInset??0)>0)
    && !(recipe.bulgePoints ? recipe.bulgePoints.some(p=>p.offset!==0) : intermediate)) return 0;
  // Hold the bottom fraction through the plate; blend smoothly above it.
  // With no bottom inset, retain the exact previous top-only arithmetic.
  const start=recipe.bottomDisc?recipe.discThickness:0;
  const t=Math.max(0,Math.min(1,(z-start)/(recipe.height-start)));
  const radius=outlineRadiusAt(recipe,angle,z);
  if(intermediate) {
    // Interpolate only enabled stations, with bounded cubic segments. Unlike a
    // free cubic spline these never overshoot the requested signed fractions.
    const nodes:[number,number][]=[[start,plankInsetFraction(recipe,index,'bottom')]];
    if(recipe.bulgePoints) {
      for(const p of recipe.bulgePoints) if(p.height/100*recipe.height>start)
        nodes.push([p.height/100*recipe.height,-randomUnit(index,p.seed)*p.offset/100]);
    } else if(recipe.twoBulges) {
      if(Math.abs(recipe.lowerInset??0)>0)nodes.push([recipe.height/3,plankInsetFraction(recipe,index,'lower')]);
      if(Math.abs(recipe.upperInset??0)>0)nodes.push([2*recipe.height/3,plankInsetFraction(recipe,index,'upper')]);
    } else if(Math.abs(recipe.middleInset??0)>0)nodes.push([recipe.height/2,plankInsetFraction(recipe,index,'middle')]);
    nodes.push([recipe.height,plankInsetFraction(recipe,index)]);
    for(let j=1;j<nodes.length;j++)if(z<=nodes[j][0] || j===nodes.length-1){
      const [a,fa]=nodes[j-1],[b,fb]=nodes[j],u=Math.max(0,Math.min(1,(z-a)/(b-a))),s=u*u*(3-2*u);
      return radius*(fa*(1-s)+fb*s);
    }
  }
  const top=plankInsetFraction(recipe,index)*radius*t*t*(3-2*t);
  return Math.abs(recipe.bottomInset??0)>0 ? top+plankInsetFraction(recipe,index,'bottom')*radius*(1-t*t*(3-2*t)) : top;
}

/** Centre path uses the bottom profile as its fixed inset reference. The outline,
 * travel and random offsets still vary normally; thickness, taper and section morph
 * do not reposition the path. Older recipes retain the original fitted placement. */
function nominalCentre(recipe: RectangleRecipe,angle: number,z: number,index=0): number {
  if(recipe.strandPlacement==='fixed')return nominalCentre({
    ...recipe,strandPlacement:'inside',scaleWithPerimeter:false,thicknessModulation:'none',
    taperSection:false,topSection:undefined,
  },angle,z,index);
  return !recipe.scaleWithPerimeter && !hasOutlineY(recipe) && !hasOutlineTransition(recipe) && !hasSectionTransition(recipe) && (!recipe.outline || recipe.outline==='circle') && recipe.section!=='circle' && recipe.section!=='ellipse' && recipe.section!=='custom'
    ? outerEdge(recipe,z,index)-sectionSizeAt(recipe,z,index).depth/2 : outlineCentre(recipe,angle,z,index);
}

/** Signed translation perpendicular to the radial direction; 100% is one
 * nominal neighbouring-centre distance before random displacement or twist. */
export function plankTangentialAt(recipe: RectangleRecipe,index: number,angle: number,z: number): number {
  if(!(recipe.topTangential>0) && !(recipe.bottomTangential>0))return 0;
  const start=recipe.bottomDisc?recipe.discThickness:0,t=Math.max(0,Math.min(1,(z-start)/(recipe.height-start))),s=t*t*(3-2*t);
  const bottom=(2*randomUnit(index,recipe.bottomTangentialSeed??rectangleDefaults.bottomTangentialSeed)-1)*(recipe.bottomTangential??0)/100;
  const top=(2*randomUnit(index,recipe.topTangentialSeed??rectangleDefaults.topTangentialSeed)-1)*(recipe.topTangential??0)/100;
  const fraction=bottom*(1-s)+top*s;
  if(recipe.strandSpacing==='perimeter')return fraction*outlinePerimeterAt(recipe,z)/recipe.count;
  const pitch=2*Math.PI/recipe.count,neighborAngle=angle+pitch;
  const a=nominalCentre(recipe,angle,z,index),b=nominalCentre(recipe,neighborAngle,z,(index+1)%recipe.count);
  const spacing=Math.hypot(b*Math.cos(neighborAngle)-a*Math.cos(angle),b*Math.sin(neighborAngle)-a*Math.sin(angle));
  return fraction*spacing;
}

/** Signed total own-axis rotation; independent of height sampling and output quality. */
export function strandTwist(recipe: RectangleRecipe, index: number): number {
  const direction = recipe.alternateTwist && index % 2 === 1 ? -1 : 1;
  const fraction = recipe.randomTwist ? randomUnit(index,recipe.twistSeed ?? rectangleDefaults.twistSeed) : 1;
  return direction * recipe.twist * fraction;
}

/** Radial orbit around the sculpture axis, plus optional rotation about each plank's centre. */
export function rectangleCorners(recipe: RectangleRecipe, index: number, z = 0): [number, number][] {
  const angle = strandAngleAt(recipe,index,z);
  const c = Math.cos(angle), s = Math.sin(angle);
  const size = sectionSizeAt(recipe,z,index);
  let centre = nominalCentre(recipe,angle,z,index);
  if (hasRandomOffsets(recipe)) centre-=plankInsetAt(recipe,index,angle,z);
  const tangent=plankTangentialAt(recipe,index,angle,z);
  const turn = strandTwist(recipe,index) * Math.PI / 180 * z / recipe.height;
  const ct = Math.cos(turn), st = Math.sin(turn), shift=centerAt(recipe,z);
  return strandSection(recipe,z).map(([x,y])=>[x*size.depth,y*size.width])
    .map(([x, y]) => [centre + x * ct - y * st, x * st + y * ct])
    .map(([x, y]) => [x * c - (y+tangent) * s + shift.x, x * s + (y+tangent) * c + shift.y]);
}

export function rectangleSlice(recipe: RectangleRecipe, z: number): number[] {
  if (z < 0 || z > recipe.height) return [];
  const lines: number[] = [];
  for (let i = 0; i < recipe.count; i++) {
    const corners = rectangleCorners(recipe, i, z);
    for (let j = 0; j < corners.length; j++) lines.push(...corners[j], z, ...corners[(j + 1) % corners.length], z);
  }
  return lines;
}

export type RectangleQuality = 'preview' | 'export';

/** Preview chords deviate by at most ~0.03 mm from the smooth corner paths.
 * The second-derivative bound includes circular motion and own-axis rotation.
 * Export always retains the requested layer step, without altering the recipe. */
export function rectangleSamplingStep(recipe: RectangleRecipe, quality: RectangleQuality): number {
  if (quality === 'export') return Math.min(recipe.layerHeight,thicknessSamplingStep(recipe));
  if (recipe.strandPlacement==='fixed'||hasThicknessModulation(recipe))return Math.min(outlinePreviewStep(recipe),thicknessSamplingStep(recipe));
  if (recipe.scaleWithPerimeter || recipe.strandSpacing==='perimeter' || hasMovingCenters(recipe) || hasOutlineY(recipe) || hasSectionTransition(recipe) || hasOutlineTransition(recipe) || recipe.section==='ellipse' || recipe.section==='custom' || hasRandomOffsets(recipe) || (recipe.outline && recipe.outline !== 'circle')) return outlinePreviewStep(recipe);
  const rate = orbitRateBound(recipe);
  const acceleration = pathDerivativeBounds(recipe).acceleration * Math.PI / 180 / recipe.height ** 2;
  const twistRate = Math.abs(recipe.twist) * Math.PI / 180 / recipe.height;
  const envelope = rectangleDiameterRange(recipe);
  if (recipe.taperSection || (recipe.section && recipe.section !== 'rectangle')) {
    const maximum = maximumSection(recipe), bottom=sectionSizeAt(recipe,0), top=sectionSizeAt(recipe,recipe.height), minimumDepth=Math.min(bottom.depth,top.depth);
    const widthRate = Math.abs(top.width-bottom.width)/recipe.height;
    const depthRate = Math.abs(top.depth-bottom.depth)/recipe.height;
    const bounds = radiusDerivativeBounds(recipe), radius = envelope.max/2;
    const edge = edgeAtDiameter({...recipe,width:maximum.width},envelope.min);
    const rectangular = !recipe.section || recipe.section === 'rectangle';
    const radialRate = (rectangular ? (radius*bounds.rate+maximum.width*widthRate/4)/edge : bounds.rate) + depthRate/2;
    const radialAcceleration = rectangular ? bounds.acceleration*radius/edge
      + (maximum.width/2*bounds.rate+radius*widthRate/2)**2/edge**3 : bounds.acceleration;
    const corner = Math.hypot(maximum.depth,maximum.width)/2;
    const cornerRate = Math.hypot(depthRate,widthRate)/2;
    const curvature = (radius-minimumDepth/2)*(acceleration+rate**2) + radialAcceleration + 2*radialRate*rate
      + corner*(acceleration+(rate+twistRate)**2) + 2*cornerRate*(rate+twistRate);
    return Math.max(recipe.layerHeight,Math.min(2,Math.sqrt(8*.03/curvature)));
  }
  const centre = edgeAtDiameter(recipe, envelope.max) - recipe.depth / 2;
  const minimumEdge = edgeAtDiameter(recipe, envelope.min);
  const minimumRadius = envelope.min / 2;
  const radiusBounds = radiusDerivativeBounds(recipe);
  const radiusRate = radiusBounds.rate;
  const radialRate = radiusRate * minimumRadius / minimumEdge;
  const radialAcceleration = radiusBounds.acceleration * minimumRadius / minimumEdge
    + (recipe.width / 2) ** 2 * radiusRate ** 2 / minimumEdge ** 3;
  const corner = Math.hypot(recipe.depth, recipe.width) / 2;
  const curvatureBound = centre * (acceleration + rate ** 2)
    + corner * (acceleration + (rate + twistRate) ** 2) + radialAcceleration + 2 * radialRate * rate;
  return Math.max(recipe.layerHeight, Math.min(2, Math.sqrt(8 * 0.03 / curvatureBound)));
}

/** Initial span limit; difficult regions are refined locally during generation. */
function outlinePreviewStep(recipe: RectangleRecipe): number {
  return Math.max(recipe.layerHeight,Math.min(2,Math.PI/90/(orbitRateBound(recipe)||1e-30)));
}

function needsLocalPreview(recipe:RectangleRecipe) {
  return recipe.strandPlacement==='fixed'||hasThicknessModulation(recipe)||recipe.scaleWithPerimeter||recipe.strandSpacing==='perimeter'||hasMovingCenters(recipe)||hasOutlineY(recipe)||hasSectionTransition(recipe)||hasOutlineTransition(recipe)
    ||recipe.section==='ellipse'||recipe.section==='custom'||hasRandomOffsets(recipe)||recipe.outline!=='circle';
}

/** Capped swept rectangles; straight prisms need only two rings at either quality. */
export function generateRectangles(input: RectangleRecipe, options: { quality?: RectangleQuality; contours?: boolean; previewRefinement?: number; previewStep?: number } = {}) {
  const recipe = validateRectangles(input);
  const quality = options.quality ?? 'export';
  const sampleStep = Math.min(thicknessSamplingStep(recipe),quality === 'export' ? recipe.layerHeight
    : Math.max(recipe.layerHeight, (options.previewStep ?? rectangleSamplingStep(recipe, quality)) / 2 ** (options.previewRefinement ?? 0)));
  const positions: number[] = [], indices: number[] = [];
  const straight = !hasThicknessModulation(recipe) && !hasMovingCenters(recipe) && !hasSectionTransition(recipe) && !hasOutlineTransition(recipe) && recipe.twist === 0 && orbitRateBound(recipe) === 0 && recipe.topDiameter === recipe.diameter
    && !hasRandomOffsets(recipe)
    && (!hasOutlineY(recipe) || recipe.topSizeY === recipe.bottomSizeY)
    && (!recipe.taperSection || (recipe.topWidth === recipe.width && (recipe.section==='circle'||recipe.topDepth === recipe.depth)))
    && (recipe.bulgePoints ? recipe.bulgePoints.every(p=>p.sizeX!==undefined ? p.sizeX===recipe.diameter && p.sizeY===outlineSizeAt(recipe,0).y : p.bulge===0) : recipe.twoBulges ? recipe.bulgeLower === 0 && recipe.bulgeUpper === 0 : recipe.bulge === 0);
  // Keep a solid underside and avoid coincident base caps. Default 2 mm disc:
  // planks start at Z=1, overlap its upper 1 mm, and still end at the same height.
  const bottom = recipe.bottomDisc ? recipe.discThickness / 2 : 0;
  let heights: number[] = [bottom];
  if(straight)heights.push(recipe.height);
  else if(recipe.bulgePoints || pathKnots(recipe).length || thicknessKnots(recipe).length) {
    // Include every user knot even when several lie within one STL interval.
    // Subdivide each span evenly to avoid tiny leftover triangles at a knot.
    const turns=[...pathKnots(recipe),...thicknessKnots(recipe)];
    // Prefer exact path corners when a bulge is indistinguishably close at
    // Float32 mesh precision. Never produce two rings at the same stored Z.
    const knots=[...(recipe.bulgePoints??[]).map(p=>p.height/100*recipe.height)
      .filter(z=>!turns.some(t=>Math.abs(t-z)<Math.max(1e-6,recipe.height*1.2e-7))),...turns,recipe.height]
      .filter(z=>Math.fround(z)>Math.fround(bottom)).sort((a,b)=>a-b)
      .filter((z,i,all)=>i===all.length-1 || (Math.fround(all[i+1])!==Math.fround(z) && all[i+1]-z>1e-6));
    let start=bottom;
    for(const end of knots) {
      const count=Math.ceil((end-start)/sampleStep);
      for(let j=1;j<=count;j++)heights.push(j===count?end:start+(end-start)*j/count);
      start=end;
    }
  } else {
    const count=Math.ceil((recipe.height-bottom)/sampleStep);
    for(let i=1;i<=count;i++)heights.push(Math.min(bottom+i*sampleStep,recipe.height));
  }
  if(quality==='preview'&&!straight&&needsLocalPreview(recipe)) {
    // The common grid keeps strand buffers compatible with the fusion pipeline.
    // Refine each existing span independently, preserving shape and path knots.
    const ratio=Math.min(1,sampleStep/outlinePreviewStep(recipe));
    heights=adaptiveStations(heights,sampleStep,recipe.layerHeight,.03*ratio*ratio,
      z=>Array.from({length:recipe.count},(_,i)=>rectangleCorners(recipe,i,z)).flat());
  }
  const steps = heights.length-1,sides=strandSection(recipe).length;
  const sharedRings=recipe.scaleWithPerimeter||recipe.strandSpacing==='perimeter';
  const stride=(steps+1)*sides+(hasSectionTransition(recipe)?2:0);
  // Concave outlines need polygon triangulation; a fan would fill their notches.
  const customCaps=recipe.section==='custom'&&!hasSectionTransition(recipe)
    ?ShapeUtils.triangulateShape(strandSection(recipe).map(([x,y])=>new Vector2(x,y)),[]):undefined;
  if(sharedRings) {
    positions.length=recipe.count*stride*3;
    for(let layer=0;layer<=steps;layer++)for(let i=0;i<recipe.count;i++) {
      const z=heights[layer],ring=rectangleCorners(recipe,i,z);let cursor=(i*stride+layer*sides)*3;
      for(const [x,y] of ring){positions[cursor++]=x;positions[cursor++]=y;positions[cursor++]=z;}
    }
  }
  for (let i = 0; i < recipe.count; i++) {
    const offset = sharedRings?i*stride:positions.length / 3;
    if(!sharedRings)for (let layer = 0; layer <= steps; layer++) {
      const z = heights[layer];
      for (const p of rectangleCorners(recipe, i, z)) positions.push(...p, z);
    }
    const top = steps * sides;
    if(hasSectionTransition(recipe)) {
      // A centre fan safely caps matched rings with collinear polygon-edge points.
      for(const [row,z,up] of [[0,bottom,false],[steps,recipe.height,true]] as const) {
        const cap=sharedRings?offset+(steps+1)*sides+(up?1:0):positions.length/3;
        let x=0,y=0;for(let j=0;j<sides;j++){x+=positions[(offset+row*sides+j)*3];y+=positions[(offset+row*sides+j)*3+1];}
        if(sharedRings){positions[cap*3]=x/sides;positions[cap*3+1]=y/sides;positions[cap*3+2]=z;}else positions.push(x/sides,y/sides,z);
        for(let j=0;j<sides;j++) {
          const a=offset+row*sides+j,b=offset+row*sides+(j+1)%sides;
          if(up)indices.push(cap,a,b);else indices.push(cap,b,a);
        }
      }
    } else if(customCaps) {
      for(const [a,b,c] of customCaps) {
        indices.push(offset+c,offset+b,offset+a);
        indices.push(offset+top+a,offset+top+b,offset+top+c);
      }
    } else {
      for (let j = 1; j < sides-1; j++) indices.push(offset,offset+j+1,offset+j);
      for (let j = 1; j < sides-1; j++) indices.push(offset+top,offset+top+j,offset+top+j+1);
    }
    for (let layer = 0; layer < steps; layer++) {
      for (let j = 0; j < sides; j++) {
        const a = offset + layer * sides + j, b = offset + layer * sides + (j + 1) % sides;
        // Opposite sides use opposite diagonals to cancel the first-order volume
        // bias of triangulating a rotating, nonplanar quad in one direction.
        if (j < sides/2) indices.push(a, b, a + sides, b, b + sides, a + sides);
        else indices.push(a, b, b + sides, a, b + sides, a + sides);
      }
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  const lines: number[] = [];
  const intervals = Math.min(100, Math.ceil(recipe.height / recipe.layerHeight));
  if (options.contours !== false) {
    for (let i = 0; i <= intervals; i++) lines.push(...rectangleSlice(recipe, recipe.height * i / intervals));
  }
  return { geometry, lines: new Float32Array(lines), triangles: indices.length / 3, sampleStep };
}
