import type { RectangleRecipe } from './rectangles.ts';

/** Stable independent anchors: never use Math.random while sampling geometry. */
function anchor(seed:number, strand:number, knot:number):number {
  let x=(seed ^ Math.imul(strand+1,0x9e3779b1) ^ Math.imul(knot+1,0x85ebca6b))>>>0;
  x=Math.imul(x^(x>>>16),0x7feb352d);
  x=Math.imul(x^(x>>>15),0x846ca68b);
  return ((x^(x>>>16))>>>0)/4294967295*2-1;
}
function triangle(u:number):number {
  const f=((u%1)+1)%1;
  return f<.25?4*f:f<.75?2-4*f:4*f-4;
}
/** Angular travel in degrees, independent of strand spin and radial offsets. */
export function pathAngle(r:RectangleRecipe,z:number,index=0):number {
  const t=Math.max(0,Math.min(1,z/r.height));
  const phase=2*Math.PI*(r.phaseTurns??0)*index/r.count;
  switch(r.motion) {
    case 'accelerating': return r.orbitTwist*(r.reverseAcceleration?1-(1-t)**r.turnPower:t**r.turnPower);
    case 'chirp': {
      const turns=r.waveCycles*t+(r.waveEndCycles-r.waveCycles)*t*t/2;
      return r.waveAmplitude*(Math.sin(2*Math.PI*turns+phase)-Math.sin(phase));
    }
    case 'wander': {
      if(t===0||t===1)return 0;
      const segments=r.wanderBends+1, u=t*segments, k=Math.floor(u), f=u-k;
      const a=k===0?0:anchor(r.wanderSeed,index,k);
      const b=k+1===segments?0:anchor(r.wanderSeed,index,k+1);
      // Cubic Hermite interpolation, zero tangent at each anchor. No overshoot.
      return r.wanderAmplitude*(a+(b-a)*f*f*(3-2*f));
    }
    // A genuine piecewise-linear angular path, with common exact turning rings.
    // Phase is intentionally only a sine/chirp control.
    case 'zigzag': return r.waveAmplitude*triangle(r.waveCycles*t);
    case 'sine': return r.waveAmplitude*(Math.sin(2*Math.PI*r.waveCycles*t+phase)-Math.sin(phase));
    default: return r.orbitTwist*t;
  }
}
/** Derivative bounds with respect to normalized height t; degrees, not radians.
 * Zigzag acceleration excludes its corners, which are sampled explicitly. */
export function pathDerivativeBounds(r:RectangleRecipe) {
  const amplitude=r.waveAmplitude, tau=2*Math.PI;
  switch(r.motion) {
    case 'accelerating': return {rate:Math.abs(r.orbitTwist)*r.turnPower,
      acceleration:Math.abs(r.orbitTwist)*r.turnPower*(r.turnPower-1)};
    case 'chirp': {
      const rate=tau*Math.max(r.waveCycles,r.waveEndCycles);
      return {rate:amplitude*rate,acceleration:amplitude*(rate*rate+tau*Math.abs(r.waveEndCycles-r.waveCycles))};
    }
    case 'wander': return {rate:3*r.wanderAmplitude*(r.wanderBends+1),
      acceleration:12*r.wanderAmplitude*(r.wanderBends+1)**2};
    case 'zigzag': return {rate:4*amplitude*r.waveCycles,acceleration:0};
    case 'sine': return {rate:amplitude*tau*r.waveCycles,acceleration:amplitude*(tau*r.waveCycles)**2};
    default: return {rate:Math.abs(r.orbitTwist),acceleration:0};
  }
}
/** Mandatory height rings shared by every strand and every output quality. */
export function pathKnots(r:RectangleRecipe):number[] {
  if(r.motion==='zigzag'&&r.waveAmplitude!==0) {
    const heights:number[]=[];
    for(let turn=.25;turn<r.waveCycles;turn+=.5)heights.push(r.height*turn/r.waveCycles);
    return heights;
  }
  if(r.motion==='wander'&&r.wanderAmplitude!==0)
    return Array.from({length:r.wanderBends},(_,i)=>r.height*(i+1)/(r.wanderBends+1));
  return [];
}
