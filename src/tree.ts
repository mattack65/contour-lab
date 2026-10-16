import { BufferGeometry, Float32BufferAttribute, ShapeUtils, Vector2 } from 'three';

export interface TreeRecipe {
  seed: number; height: number; radius: number; layerHeight: number;
  splitChance: number; childRatio: number; spread: number; wander: number;
  taper: number; minRadius: number; clearance: number; minRun: number;
  growthStyle: number; leaderBias: number; radialBias: number; bark: number; twist: number; forkBlend: number;
}
export const treeDefaults: TreeRecipe = {
  seed: 42, height: 100, radius: 8, layerHeight: 0.2,
  splitChance: 0.025, childRatio: 0.72, spread: 0.5, wander: 0.35,
  taper: 0.025, minRadius: 1.2, clearance: 2, minRun: 10,
  growthStyle: 2, leaderBias: 0.85, radialBias: 0.15, bark: 0.16, twist: 20, forkBlend: 1,
};
export const appleDefaults: TreeRecipe = {
  ...treeDefaults, growthStyle: 3, height: 150, radius: 12, splitChance: 0.06,
  childRatio: 0.8, spread: 0.85, wander: 0.5, minRadius: 0.9, minRun: 5,
  leaderBias: 0.55, bark: 0.09, twist: 12, forkBlend: 0,
};
export const treeBuildVolume={width:300,depth:300,height:350,margin:5} as const;
export const treeLimits = {
  seed: [0, 999999], height: [30, 350], radius: [3, 40], layerHeight: [0.1, 1],
  splitChance: [0, 0.15], childRatio: [0.55, 0.8], spread: [0.25, 1.2],
  wander: [0, 1], taper: [0.01, 0.12], minRadius: [0.9, 2.5], clearance: [1.5, 6], minRun: [3, 25],
  growthStyle: [1,3], leaderBias: [0,1], radialBias: [0,0.8], bark: [0,0.25], twist: [-45,45], forkBlend: [0,3],
} as const;
export function validateTree(value: unknown): TreeRecipe {
  if (!value || typeof value !== 'object') throw new Error('Missing tree recipe.');
  const result = {} as TreeRecipe;
  for (const key of Object.keys(treeLimits) as (keyof TreeRecipe)[]) {
    const raw = (value as Record<string, unknown>)[key];
    const added = ['growthStyle','leaderBias','radialBias','bark','twist','forkBlend'].includes(key);
    const n = raw === undefined && added ? treeDefaults[key] : raw;
    const [min, max] = treeLimits[key];
    if (typeof n !== 'number' || !Number.isFinite(n) || n < min || n > max) throw new Error(`${key} must be between ${min} and ${max}.`);
    result[key] = n;
  }
  if (!Number.isInteger(result.seed)) throw new Error('Seed must be an integer.');
  if (!Number.isInteger(result.growthStyle)) throw new Error('Unknown growth style.');
  if (result.minRadius >= result.radius * result.childRatio) throw new Error('Tip radius must be smaller than a new branch.');
  return result;
}
function seeded(seed: number) {
  return () => {
    seed += 0x6d2b79f5;
    let t = Math.imul(seed ^ (seed >>> 15), seed | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export interface TreePoint { x: number; y: number; z: number; r: number }
export interface Branch { id: number; parent: number | null; points: TreePoint[]; reason: string; role: 'trunk'|'leader'|'side'; central: boolean }
interface Tip { branch: Branch; dx: number; dy: number; hx: number; hy: number; startDx: number; startDy: number; phase: number; rate: number; age: number; target: number; birthRadius: number; closing: number; capRadius: number }
export interface TreeGrowth { branches: Branch[]; forks: number; avoided: number; limited: boolean; steps: number; bounds: number[] }
const last = (b: Branch) => b.points[b.points.length - 1];

/** Conservative circular envelope for bark relief and the smooth-union bulge. */
export function collisionPoint(a: TreePoint, p: TreeRecipe): TreePoint {
  return p.growthStyle===1 ? a : {...a,r:a.r*(1+p.bark)+(p.growthStyle===2?p.forkBlend/4:0)};
}

/** Tower-like fluting with a slow twist. The bound |factor-1| <= bark is used
 * by collisionPoint; all branches share the phase at a fork, avoiding seams. */
export function barkFactor(theta: number, z: number, p: TreeRecipe) {
  if(p.growthStyle===1 || p.bark===0)return 1;
  const phase=(p.seed*0.61803398875%1)*Math.PI*2;
  const angle=theta-p.twist*Math.PI/180*z/p.height;
  return 1+p.bark*(0.65*Math.cos(5*angle+phase)+0.23*Math.sin(3*angle+z*0.05+phase*2)+0.12*Math.cos(7*angle-z*0.03+phase));
}

/** Exact minimum of squared distance minus squared radius sum over a linear layer interval. */
export function sweptMargin(a: TreePoint, b: TreePoint, c: TreePoint, d: TreePoint, gap: number) {
  const x = a.x-c.x, y = a.y-c.y, dx = (b.x-a.x)-(d.x-c.x), dy = (b.y-a.y)-(d.y-c.y);
  const r = a.r+c.r+gap, dr = b.r+d.r+gap-r;
  const A = dx*dx+dy*dy-dr*dr, B = 2*(x*dx+y*dy-r*dr), C = x*x+y*y-r*r;
  const t = A > 0 ? Math.max(0, Math.min(1, -B/(2*A))) : 0;
  return Math.min(C, A+B+C, A*t*t+B*t+C);
}

export function growTree(input: TreeRecipe): TreeGrowth {
  const p = validateTree(input), rng = seeded(p.seed);
  p.height=Math.min(p.height,treeBuildVolume.height-treeBuildVolume.margin);
  if(p.growthStyle===3)return growAppleTree(p);
  const branches: Branch[] = [];
  const makeTip = (point: TreePoint, parent: number | null, angle: number, target: number): Tip => {
    const branch: Branch = { id: branches.length, parent, points: [{ ...point }], reason: '', role: parent===null?'trunk':'side', central:parent===null };
    branches.push(branch);
    const dx=Math.cos(angle)*p.spread,dy=Math.sin(angle)*p.spread;
    return { branch, dx, dy, hx:dx,hy:dy,startDx:dx,startDy:dy, phase: rng()*6.283, rate: 0.65+rng()*0.7, age: 0, target, birthRadius:point.r, closing: -1, capRadius: 0 };
  };
  let active = [makeTip({ x: 0, y: 0, z: 0, r: p.radius }, null, rng()*Math.PI*2, p.radius)];
  active[0].dx *= 0.15; active[0].dy *= 0.15;
  active[0].hx=active[0].dx;active[0].hy=active[0].dy;
  active[0].startDx=active[0].dx;active[0].startDy=active[0].dy;
  let forks = 0, avoided = 0, limited = false, steps = 0;
  const maxTips = 64;
  // Once a fork's siblings are disjoint, enforce the available gap continuously.
  // The leader inherits the parent section. A natural side branch starts inside it.
  for (let step = 0; active.length && step < Math.ceil(p.height/p.layerHeight)+100; step++) {
    const z = step*p.layerHeight;
    const expanded: Tip[] = [];
    for (const tip of active) {
      const a = last(tip.branch);
      const roll = rng(); // one seeded Bernoulli trial per active branch per layer
      const free = active.every(other => other === tip || Math.hypot(a.x-last(other.branch).x, a.y-last(other.branch).y) >= collisionPoint(a,p).r+collisionPoint(last(other.branch),p).r+p.clearance);
      if (tip.closing < 0 && roll < p.splitChance && tip.age >= p.minRun && a.r*p.childRatio > p.minRadius*1.2 && z < p.height-4*a.r && free && active.length+expanded.length < maxTips && branches.length < 255) {
        if(p.growthStyle===1) {
          const radial = Math.hypot(a.x,a.y) > 1 ? Math.atan2(a.y,a.x) : Math.atan2(tip.dy,tip.dx);
          const angle = radial + (rng()-0.5)*0.45;
          const spreadAngle = 0.85 + rng()*0.35;
          expanded.push(makeTip(a, tip.branch.id, angle-spreadAngle, a.r*p.childRatio), makeTip(a, tip.branch.id, angle+spreadAngle, a.r*p.childRatio));
        } else {
          const sideAngle=rng()*Math.PI*2;
          const deflection=(1-p.leaderBias)*p.spread*0.35;
          const leader=makeTip(a,tip.branch.id,sideAngle,a.r*(0.86+0.1*p.leaderBias));
          leader.branch.role='leader';leader.branch.central=tip.branch.central;
          leader.hx=tip.dx+Math.cos(sideAngle+Math.PI)*deflection;
          leader.hy=tip.dy+Math.sin(sideAngle+Math.PI)*deflection;
          const side=makeTip({...a,r:a.r*p.childRatio},tip.branch.id,sideAngle,a.r*p.childRatio);
          side.hx=tip.dx*0.3+Math.cos(sideAngle)*p.spread*1.25;
          side.hy=tip.dy*0.3+Math.sin(sideAngle)*p.spread*1.25;
          for(const child of [leader,side]) {
            child.dx=tip.dx;child.dy=tip.dy;child.startDx=tip.dx;child.startDy=tip.dy;
          }
          expanded.push(leader,side);
        }
        tip.branch.reason = 'fork'; forks++;
      } else {
        if (branches.length >= 255 || active.length >= maxTips) limited = true;
        expanded.push(tip);
      }
    }
    active = expanded;
    const previous = active.map(tip => last(tip.branch));
    const repulsion=previous.map((a,i)=> {
      let x=0,y=0;
      for(let j=0;j<previous.length;j++) if(i!==j) {
        const b=previous[j],dx=a.x-b.x,dy=a.y-b.y,d=Math.hypot(dx,dy);
        const range=collisionPoint(a,p).r+collisionPoint(b,p).r+p.clearance+4;
        if(p.growthStyle===2 && a.r+b.r>d)continue; // allow the intended fork to open smoothly
        if(d>0.1&&d<range) { const strength=(range-d)/range; x+=dx/d*strength; y+=dy/d*strength; }
      }
      return {x,y};
    });
    const next = active.map((tip, i): TreePoint => {
      const a = previous[i], dz = p.layerHeight;
      if (tip.closing < 0 && (a.r <= p.minRadius || z >= p.height-a.r*1.4)) {
        tip.closing = 0; tip.capRadius = a.r;
        tip.branch.reason = a.r <= p.minRadius ? 'thin tip' : 'height limit';
      }
      if (tip.closing >= 0) {
        tip.closing += dz;
        const u = Math.min(1, tip.closing/(tip.capRadius*1.2));
        return { x:a.x, y:a.y, z:a.z+dz, r:tip.capRadius*Math.sqrt(Math.max(0,1-u*u)) };
      }
      const radial = Math.atan2(a.y,a.x);
      const w = p.wander * Math.sin(z*0.065+tip.phase);
      if(p.growthStyle===1) {
        const steer = tip.age > a.r*4 ? 0.08*dz : 0;
        tip.dx += (Math.cos(radial+w)*p.spread-tip.dx)*steer + repulsion[i].x*p.spread*0.3*dz;
        tip.dy += (Math.sin(radial+w)*p.spread-tip.dy)*steer + repulsion[i].y*p.spread*0.3*dz;
      } else {
        const t=Math.min(1,tip.age/Math.max(3,tip.birthRadius*1.4)),ease=t*t*(3-2*t);
        const radialWeight=tip.branch.central?0:p.radialBias;
        const sway=p.spread*p.wander*(tip.branch.central?0.07:0.2);
        const targetX=(1-radialWeight)*tip.hx+radialWeight*Math.cos(radial)*p.spread+sway*Math.sin(z*0.07+tip.phase);
        const targetY=(1-radialWeight)*tip.hy+radialWeight*Math.sin(radial)*p.spread+sway*Math.cos(z*0.06+tip.phase);
        const repel=tip.branch.central?0.035:0.2;
        tip.dx+=(tip.startDx+(targetX-tip.startDx)*ease-tip.dx)*0.2*dz+repulsion[i].x*p.spread*repel*dz;
        tip.dy+=(tip.startDy+(targetY-tip.startDy)*ease-tip.dy)*0.2*dz+repulsion[i].y*p.spread*repel*dz;
      }
      const speed=Math.hypot(tip.dx,tip.dy),maxSpeed=p.spread*1.5;
      if(speed>maxSpeed){tip.dx*=maxSpeed/speed;tip.dy*=maxSpeed/speed;}
      const duration=Math.max(8,tip.birthRadius*3);
      const u=Math.min(1,tip.age/duration);
      const forkTaper = p.growthStyle===1 ? Math.max(0,a.r-tip.target)*0.28 :
        (tip.birthRadius-tip.target)*6*u*(1-u)/duration;
      const taper = p.taper*tip.rate*(1+0.35*Math.sin(z*0.13+tip.phase));
      return { x:a.x+tip.dx*dz, y:a.y+tip.dy*dz, z:a.z+dz, r:Math.max(0.1,a.r-dz*(taper+forkTaper)) };
    });
    next.forEach(point=>containPoint(point,p));
    // Reduce only conflicting tips' horizontal movement. At scale zero all
    // separated circles remain safe because their centres stay put and radii shrink.
    const scales=active.map(()=>1);
    const conflicts = () => {
      const found:number[]=[];
      for (let i=0;i<active.length;i++) for (let j=i+1;j<active.length;j++) {
        const a=collisionPoint(previous[i],p), c=collisionPoint(previous[j],p);
        const startGap=Math.hypot(a.x-c.x,a.y-c.y)-a.r-c.r;
        if (startGap < 0) continue; // still the connected fork junction
        const gap=Math.min(p.clearance,startGap);
        const b={...collisionPoint(next[i],p),x:a.x+(next[i].x-a.x)*scales[i],y:a.y+(next[i].y-a.y)*scales[i]};
        const d={...collisionPoint(next[j],p),x:c.x+(next[j].x-c.x)*scales[j],y:c.y+(next[j].y-c.y)*scales[j]};
        if (sweptMargin(a,b,c,d,gap) < -1e-7) found.push(i,j);
      }
      return new Set(found);
    };
    for(let attempt=0;attempt<16;attempt++) {
      const bad=conflicts();if(!bad.size)break;
      for(const i of bad)scales[i]=scales[i]<=1/128?0:scales[i]*0.5;
    }
    if(conflicts().size)scales.fill(0);
    if(scales.some(s=>s<1))avoided++;
    active.forEach((tip,i) => {
      const a=previous[i], b=next[i];
      b.x=a.x+(b.x-a.x)*scales[i]; b.y=a.y+(b.y-a.y)*scales[i];
      tip.branch.points.push(b); tip.age+=p.layerHeight;
    });
    active=active.filter(tip => last(tip.branch).r>0);
    steps++;
  }
  const bounds=[Infinity,Infinity,0,-Infinity,-Infinity,0];
  for(const b of branches) for(const a of b.points) {
    const radius=collisionPoint(a,p).r;
    bounds[0]=Math.min(bounds[0],a.x-radius); bounds[1]=Math.min(bounds[1],a.y-radius);
    bounds[3]=Math.max(bounds[3],a.x+radius); bounds[4]=Math.max(bounds[4],a.y+radius); bounds[5]=Math.max(bounds[5],a.z);
  }
  return { branches, forks, avoided, limited, steps, bounds };
}

/** An upright orchard crown: a short trunk, staggered scaffold limbs, then
 * progressively finer ramification. Each shoot has its own taper/end budget.
 * Z remains monotone, so fabrication layers and swept collision tests still apply. */
function growAppleTree(p: TreeRecipe): TreeGrowth {
  const rng=seeded(p.seed), branches:Branch[]=[];
  interface Shoot { branch:Branch; end:number; start:number; radius:number; dx:number; dy:number; angle:number; order:number; phase:number; run:number; closing?:number }
  const phase=rng()*Math.PI*2;
  const make=(point:TreePoint,parent:number|null,end:number,angle:number,order:number,central:boolean,dx=0,dy=0):Shoot=>{
    const branch:Branch={id:branches.length,parent,points:[{...point}],reason:'',role:parent===null?'trunk':central?'leader':'side',central};
    branches.push(branch);
    return {branch,end,start:point.z,radius:point.r,dx,dy,angle,order,phase:rng()*Math.PI*2,run:0};
  };
  let active=[make({x:0,y:0,z:0,r:p.radius},null,p.height,phase,0,true)];
  let forks=0,avoided=0,steps=0,scaffolds=0;
  // Reserve room for relief and the discretized surface; STL normals are checked
  // independently. A centreline-only 45 degree check would miss surface overhangs.
  const maxSlope=Math.min(0.85,p.spread)/(1+p.bark);
  const dz=p.layerHeight;
  for(let z=0;active.length&&z<p.height+dz;z+=dz) {
    const expanded:Shoot[]=[];
    for(const s of active) {
      const a=last(s.branch),central=s.branch.central;
      const minimumRun=central&&s.branch.parent===null?p.height*0.17:Math.max(p.minRun,a.r*1.7);
      const room=s.end-a.z>Math.max(p.height*0.14,a.r*4);
      const free=active.every(other=>other===s||Math.hypot(a.x-last(other.branch).x,a.y-last(other.branch).y)>=collisionPoint(a,p).r+collisionPoint(last(other.branch),p).r+p.clearance*0.5);
      if(rng()<p.splitChance && s.closing===undefined && s.run>=minimumRun && room && free && a.r*p.childRatio>p.minRadius*1.35 && branches.length<127) {
        // Stagger primary limbs around the trunk. Higher-order forks open to
        // either side of their inherited heading rather than all pointing outwards.
        const angle=central?phase+(scaffolds++)*2.39996323+(rng()-0.5)*0.3:s.angle+(rng()<0.5?-1:1)*(0.7+rng()*0.65);
        const sideEnd=Math.min(p.height*(0.73+rng()*0.23),s.end+(rng()-0.55)*p.height*0.22);
        const leader=make(a,s.branch.id,s.end,s.angle+(rng()-0.5)*0.5,s.order,central,s.dx,s.dy);
        leader.branch.role='leader';
        const side=make({...a,r:a.r*p.childRatio},s.branch.id,Math.min(p.height,Math.max(a.z+p.height*0.15,sideEnd)),angle,s.order+1,false,Math.cos(angle)*maxSlope,Math.sin(angle)*maxSlope);
        // Radius is allocated over the remaining life, not lost at the junction.
        leader.end=Math.max(a.z+p.height*0.16,s.end-p.height*(central?0.012:0.025));
        s.branch.reason='fork';forks++;expanded.push(leader,side);
      } else expanded.push(s);
    }
    active=expanded;
    const previous=active.map(s=>last(s.branch));
    const next=active.map((s,i):TreePoint=>{
      const a=previous[i];
      if(s.closing===undefined&&a.r<=p.minRadius){s.closing=a.r;s.end=Math.min(p.height,a.z+Math.max(dz,a.r*1.5));}
      const nextZ=Math.min(s.end,a.z+dz);
      if(s.closing!==undefined)return {x:a.x,y:a.y,z:nextZ,r:Math.max(0,(s.end-nextZ)/1.5)};
      const u=Math.min(1,(nextZ-s.start)/(s.end-s.start));
      // Stronger upper taper removes thick height-capped poles. The terminal
      // few millimetres close naturally, without an expanding underside.
      const allocation=Math.min(1,(nextZ-s.start)/Math.max(5,s.radius*2));
      const reduction=s.branch.role==='leader'?0.18*allocation*allocation*(3-2*allocation):0;
      const r=s.radius*Math.pow(Math.max(0,1-u),0.9)*(1-reduction);
      const radial=Math.atan2(a.y,a.x);
      const centre=s.branch.central;
      const speed=maxSlope*(centre?0.12:Math.max(0.42,1-(s.order-1)*0.1));
      const heading=s.angle + p.wander*0.3*Math.sin(a.z*0.055+s.phase);
      let vx=Math.cos(heading)*speed,vy=Math.sin(heading)*speed;
      if(!centre) {
        vx=vx*(1-p.radialBias)+Math.cos(radial)*speed*p.radialBias;
        vy=vy*(1-p.radialBias)+Math.sin(radial)*speed*p.radialBias;
      }
      // Encourage the connected fork to open promptly, before another split.
      // Once separate, the swept guard also prevents it from closing again.
      for(let j=0;j<previous.length;j++)if(i!==j) {
        const b=previous[j],x=a.x-b.x,y=a.y-b.y,d=Math.hypot(x,y);
        const reach=collisionPoint(a,p).r+collisionPoint(b,p).r+p.clearance;
        if(d>0.5&&d<reach+6&&!centre){vx+=x/d*(reach+6-d)*0.3;vy+=y/d*(reach+6-d)*0.3;}
      }
      const ease=Math.min(1,s.run/Math.max(3,s.radius));
      const envelope=collisionPoint(a,p).r+1;
      const wallX=treeBuildVolume.width/2-treeBuildVolume.margin-envelope;
      const wallY=treeBuildVolume.depth/2-treeBuildVolume.margin-envelope;
      // Bend away before touching the wall. The final clamp below covers the
      // full radial envelope, including bark, while collision checks still run.
      const steer=(position:number,wall:number)=>Math.sign(position)*Math.max(0,1-(wall-Math.abs(position))/20)*maxSlope*2;
      vx-=steer(a.x,wallX);vy-=steer(a.y,wallY);
      s.dx+=(vx-s.dx)*0.22*dz*ease;s.dy+=(vy-s.dy)*0.22*dz*ease;
      const magnitude=Math.hypot(s.dx,s.dy);
      if(magnitude>maxSlope){s.dx*=maxSlope/magnitude;s.dy*=maxSlope/magnitude;}
      return containPoint({x:a.x+s.dx*(nextZ-a.z),y:a.y+s.dy*(nextZ-a.z),z:nextZ,r},p);
    });
    const scales=active.map(()=>1);
    const conflicts=()=>{
      const bad=new Set<number>();
      for(let i=0;i<active.length;i++)for(let j=i+1;j<active.length;j++){
        const a=collisionPoint(previous[i],p),c=collisionPoint(previous[j],p);
        const gap=Math.hypot(a.x-c.x,a.y-c.y)-a.r-c.r;
        if(gap<0){
          // Even before the conservative circles separate, keep a fork opening.
          // Otherwise its fluted surfaces can part and reconnect while their
          // envelopes still overlap, leaving a real handle that refinement cannot fix.
          if(p.height>150||p.radius>12){
            const dx=(next[i].x-a.x)*scales[i]-(next[j].x-c.x)*scales[j];
            const dy=(next[i].y-a.y)*scales[i]-(next[j].y-c.y)*scales[j];
            if((a.x-c.x)*dx+(a.y-c.y)*dy < -1e-7){bad.add(i);bad.add(j);}
          }
          continue;
        }
        const b={...collisionPoint(next[i],p),x:a.x+(next[i].x-a.x)*scales[i],y:a.y+(next[i].y-a.y)*scales[i]};
        const d={...collisionPoint(next[j],p),x:c.x+(next[j].x-c.x)*scales[j],y:c.y+(next[j].y-c.y)*scales[j]};
        if(sweptMargin(a,b,c,d,Math.min(gap,p.clearance)) < -1e-7){bad.add(i);bad.add(j);}
      }
      return bad;
    };
    for(let k=0;k<16;k++){const bad=conflicts();if(!bad.size)break;for(const i of bad)scales[i]=scales[i]<=1/128?0:scales[i]*0.5;}
    if(conflicts().size)scales.fill(0);
    if(scales.some(s=>s<1))avoided++;
    active.forEach((s,i)=>{
      const a=previous[i],b=next[i];b.x=a.x+(b.x-a.x)*scales[i];b.y=a.y+(b.y-a.y)*scales[i];
      s.branch.points.push(b);s.run+=dz;
      if(b.r===0)s.branch.reason='tapered tip';
    });
    active=active.filter(s=>last(s.branch).r>0);steps++;
  }
  const bounds=[Infinity,Infinity,0,-Infinity,-Infinity,0];
  for(const b of branches)for(const a of b.points){const r=collisionPoint(a,p).r;bounds[0]=Math.min(bounds[0],a.x-r);bounds[1]=Math.min(bounds[1],a.y-r);bounds[3]=Math.max(bounds[3],a.x+r);bounds[4]=Math.max(bounds[4],a.y+r);bounds[5]=Math.max(bounds[5],a.z);}
  return {branches,forks,avoided,limited:branches.length>=127,steps,bounds};
}

function containPoint(point:TreePoint,recipe:TreeRecipe) {
  const radius=collisionPoint(point,recipe).r+1; // reserve for surface sampling
  const x=treeBuildVolume.width/2-treeBuildVolume.margin-radius;
  const y=treeBuildVolume.depth/2-treeBuildVolume.margin-radius;
  point.x=Math.max(-x,Math.min(x,point.x));point.y=Math.max(-y,Math.min(y,point.y));
  return point;
}

export function validateBuildVolume(geometry:BufferGeometry) {
  geometry.computeBoundingBox();const b=geometry.boundingBox!;
  const x=treeBuildVolume.width/2-treeBuildVolume.margin,y=treeBuildVolume.depth/2-treeBuildVolume.margin;
  if(b.min.x < -x-1e-4||b.max.x>x+1e-4||b.min.y < -y-1e-4||b.max.y>y+1e-4||b.min.z < -1e-4||b.max.z>treeBuildVolume.height-treeBuildVolume.margin+1e-4)
    throw new Error('The finished surface exceeds the 300 × 300 × 350 mm build volume with 5 mm clearance. Reduce the height budget.');
}

export function treeCircles(growth: TreeGrowth, z: number): (TreePoint & {relief:number;age:number})[] {
  const circles: (TreePoint & {relief:number;age:number})[]=[];
  for(const branch of growth.branches) {
    const points=branch.points;
    if(z<points[0].z || z>last(branch).z || points.length<2) continue;
    let lo=0,hi=points.length-1;
    while(hi-lo>1) { const mid=(lo+hi)>>1; if(points[mid].z<=z) lo=mid; else hi=mid; }
    const a=points[lo],b=points[hi],t=(z-a.z)/(b.z-a.z);
    const r=a.r+(b.r-a.r)*t;
    const collar=Math.max(4,Math.min(12,last(branch).r*2));
    const relief=branch.reason==='fork'?Math.min(1,Math.max(0,(last(branch).z-z)/collar)):1;
    if(r>0) circles.push({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z,r,relief,age:z-points[0].z});
  }
  return circles;
}

/** Grid-sampled union of the growing cross-sections; marching tetrahedra resolves
 * ambiguous cube cases consistently and shares vertices on every grid edge. */
export function meshTree(growth: TreeGrowth, input: TreeRecipe, quality: 'preview'|'export', refinement = 1) {
  const recipe=validateTree(input);
  const b=growth.bounds;
  let spacing=(quality==='preview' ? Math.min(1,recipe.minRadius*0.65) : Math.min(0.5,recipe.minRadius*0.35))*refinement;
  const size=[b[3]-b[0],b[4]-b[1],b[5]];
  const count=()=>size.map(v=>Math.ceil(v/spacing)+7);
  let dims=count();
  const large=recipe.height>150||recipe.radius>12;
  const budget=quality==='preview'?3000000:large?(refinement<0.7?192000000:refinement<1?128000000:96000000):refinement<1?24000000:12000000;
  while(dims[0]*dims[1]*dims[2]>budget) {spacing*=1.08;dims=count();}
  if(spacing>Math.min(recipe.minRadius*0.8,recipe.clearance/2)) throw new Error('Tree is too wide for this detail level. Reduce spread/height or increase tip size and clearance.');
  const [nx,ny,nz]=dims, nxy=nx*ny,total=nx*ny*nz;
  const origin=[b[0]-spacing*2.37,b[1]-spacing*2.37,-spacing*2.37];
  const field=new Float32Array(total).fill(spacing*3);
  for(let iz=0;iz<nz;iz++) {
    const z=origin[2]+iz*spacing;
    const circles=treeCircles(growth,Math.max(0,z));
    const relief=circles.map(c=>large&&recipe.growthStyle===3?c.relief:1);
    if(large&&recipe.growthStyle===3){
      // Deep bark grooves can enclose tiny holes where two fluted sections
      // overlap. Keep these fork collars round, then restore relief only as
      // fast as the gap permits. Separate limbs cannot reconnect through ridges.
      for(let i=0;i<circles.length;i++)for(let j=i+1;j<circles.length;j++){
        const a=circles[i],b=circles[j];
        const gap=Math.hypot(a.x-b.x,a.y-b.y)-a.r-b.r;
        const allowed=Math.max(0,gap)/(2*recipe.bark*(a.r+b.r)+1e-9);
        relief[i]=Math.min(relief[i],allowed);relief[j]=Math.min(relief[j],allowed);
      }
    }
    for(let ci=0;ci<circles.length;ci++) {
      const c=circles[ci];
      const reach=collisionPoint(c,recipe).r+spacing*2;
      const xmin=Math.max(0,Math.floor((c.x-reach-origin[0])/spacing)),xmax=Math.min(nx-1,Math.ceil((c.x+reach-origin[0])/spacing));
      const ymin=Math.max(0,Math.floor((c.y-reach-origin[1])/spacing)),ymax=Math.min(ny-1,Math.ceil((c.y+reach-origin[1])/spacing));
      for(let iy=ymin;iy<=ymax;iy++) for(let ix=xmin;ix<=xmax;ix++) {
        const index=iz*nxy+iy*nx+ix;
        const dx=origin[0]+ix*spacing-c.x,dy=origin[1]+iy*spacing-c.y;
        const radius=c.r*(1+(barkFactor(Math.atan2(dy,dx),Math.max(0,z),recipe)-1)*relief[ci]);
        let value=Math.hypot(dx,dy)-radius;
        const blend=recipe.growthStyle===2?recipe.forkBlend:large&&recipe.growthStyle===3?0.75*Math.min(1,c.age/3):0;
        if(blend>0) {
          const old=field[index],h=Math.max(0,1-Math.abs(old-value)/blend);
          value=Math.min(old,value)-blend*h*h*0.25;
        }
        value=Math.max(value,-z);
        // Keep surface crossings away from grid vertices. Near-zero samples can
        // otherwise create distinct double-precision vertices that collapse onto
        // each other when Three.js/STL stores their coordinates as Float32.
        // Preserve the sign (and thus tetrahedron topology); the micron-scale nudge
        // is far below either preview/export sampling resolution.
        const epsilon=spacing*0.001;
        const stableValue=Math.abs(value)<epsilon?(value<0?-epsilon:epsilon):value;
        field[index]=Math.min(field[index],stableValue);
      }
    }
  }
  const positions:number[]=[], normals:number[]=[], indices:number[]=[], edgeVertices=new Map<number,number>();
  // Conforming tetrahedra use seven edge directions. Encoding the start vertex
  // and direction stays exact even on large grids; a*total+c exceeds JavaScript's
  // safe integer range above ~95M grid samples and aliases unrelated edges.
  const edgeDirections=new Map([1,nx,nxy,nx+1,nxy+1,nxy+nx,nxy+nx+1].map((delta,i)=>[delta,i]));
  const point=(id:number)=>[origin[0]+(id%nx)*spacing,origin[1]+(Math.floor(id/nx)%ny)*spacing,origin[2]+Math.floor(id/nxy)*spacing];
  const gradient=(id:number)=>[field[id+1]-field[id-1],field[id+nx]-field[id-nx],field[id+nxy]-field[id-nxy]];
  const vertex=(a:number,c:number)=> {
    if(a>c) [a,c]=[c,a];
    const direction=edgeDirections.get(c-a);
    if(direction===undefined)throw new Error('Unknown tetrahedron edge direction.');
    const key=a*7+direction, old=edgeVertices.get(key); if(old!==undefined)return old;
    const t=field[a]/(field[a]-field[c]), A=point(a), C=point(c), id=positions.length/3;
    positions.push(A[0]+(C[0]-A[0])*t,A[1]+(C[1]-A[1])*t,A[2]+(C[2]-A[2])*t);
    const ga=gradient(a),gc=gradient(c),normal=ga.map((v,i)=>v+(gc[i]-v)*t),length=Math.hypot(...normal)||1;
    normals.push(...normal.map(v=>v/length));
    edgeVertices.set(key,id);return id;
  };
  const triangle=(a:number,c:number,d:number,normal:number[])=> {
    const u=[positions[c*3]-positions[a*3],positions[c*3+1]-positions[a*3+1],positions[c*3+2]-positions[a*3+2]];
    const v=[positions[d*3]-positions[a*3],positions[d*3+1]-positions[a*3+1],positions[d*3+2]-positions[a*3+2]];
    const dot=(u[1]*v[2]-u[2]*v[1])*normal[0]+(u[2]*v[0]-u[0]*v[2])*normal[1]+(u[0]*v[1]-u[1]*v[0])*normal[2];
    if(dot>0)indices.push(a,c,d);else indices.push(a,d,c);
  };
  const tetra=[[0,5,1,6],[0,1,2,6],[0,2,3,6],[0,3,7,6],[0,7,4,6],[0,4,5,6]];
  const offsets=[0,1,1+nx,nx,nxy,nxy+1,nxy+1+nx,nxy+nx];
  for(let iz=0;iz<nz-1;iz++) for(let iy=0;iy<ny-1;iy++) for(let ix=0;ix<nx-1;ix++) {
    const base=iz*nxy+iy*nx+ix;
    let mask=0;for(let k=0;k<8;k++)if(field[base+offsets[k]]<0)mask|=1<<k;
    if(mask===0||mask===255)continue;
    const ids=offsets.map(o=>base+o);
    for(const t of tetra) {
      const inside=t.map(k=>ids[k]).filter(id=>field[id]<0), outside=t.map(k=>ids[k]).filter(id=>field[id]>=0);
      if(!inside.length||!outside.length)continue;
      const pi=point(inside[0]),po=point(outside[0]),normal=po.map((v,i)=>v-pi[i]);
      if(inside.length===1)triangle(vertex(inside[0],outside[0]),vertex(inside[0],outside[1]),vertex(inside[0],outside[2]),normal);
      else if(outside.length===1)triangle(vertex(outside[0],inside[0]),vertex(outside[0],inside[1]),vertex(outside[0],inside[2]),normal);
      else {
        const [a,c]=inside,[d,e]=outside;
        const ad=vertex(a,d),ae=vertex(a,e),cd=vertex(c,d),ce=vertex(c,e);
        triangle(ad,ae,cd,normal);triangle(ae,ce,cd,normal);
      }
    }
  }
  let geometry=new BufferGeometry();
  geometry.setAttribute('position',new Float32BufferAttribute(positions,3));geometry.setIndex(indices);
  geometry.setAttribute('normal',new Float32BufferAttribute(normals,3));geometry.computeBoundingBox();
  if(recipe.growthStyle===3){
    const raw=geometry;geometry=flatTreeBase(raw,spacing*0.7);raw.dispose();
    constrainOverhangs(geometry,spacing,origin[2]-spacing*0.7);
  }
  return {geometry,spacing,triangles:geometry.getIndex()!.count/3};
}

/** Trim the sub-grid marching-tetrahedra bevel off the build-plate contact.
 * Retriangulate the actual cut contour; don't exempt a band of overhangs. */
function flatTreeBase(source:BufferGeometry,cut:number) {
  const p=source.getAttribute('position'),normal=source.getAttribute('normal'),index=source.getIndex()!;
  const vertices:number[]=[],normals:number[]=[],faces:number[]=[],cache=new Map<string,number>(),rim=new Set<number>();
  const original=(a:number)=>{
    const key=`v${a}`;let id=cache.get(key);if(id!==undefined)return id;
    id=vertices.length/3;vertices.push(p.getX(a),p.getY(a),p.getZ(a)-cut);normals.push(normal.getX(a),normal.getY(a),normal.getZ(a));cache.set(key,id);return id;
  };
  const intersect=(a:number,b:number)=>{
    if(a>b)[a,b]=[b,a];const key=`e${a}/${b}`;let id=cache.get(key);if(id!==undefined)return id;
    const t=(cut-p.getZ(a))/(p.getZ(b)-p.getZ(a));id=vertices.length/3;
    vertices.push(p.getX(a)+(p.getX(b)-p.getX(a))*t,p.getY(a)+(p.getY(b)-p.getY(a))*t,0);
    normals.push(normal.getX(a)+(normal.getX(b)-normal.getX(a))*t,normal.getY(a)+(normal.getY(b)-normal.getY(a))*t,normal.getZ(a)+(normal.getZ(b)-normal.getZ(a))*t);
    cache.set(key,id);rim.add(id);return id;
  };
  for(let i=0;i<index.count;i+=3){
    const tri=[index.getX(i),index.getX(i+1),index.getX(i+2)],polygon:number[]=[];
    for(let j=0;j<3;j++){
      const a=tri[j],b=tri[(j+1)%3],inside=p.getZ(a)>=cut;
      if(inside)polygon.push(original(a));
      if(inside!==(p.getZ(b)>=cut))polygon.push(intersect(a,b));
    }
    for(let j=1;j<polygon.length-1;j++)faces.push(polygon[0],polygon[j],polygon[j+1]);
  }
  // The cut is within the single, star-shaped root section, below every fork.
  const loop=[...rim].sort((a,b)=>Math.atan2(vertices[a*3+1],vertices[a*3])-Math.atan2(vertices[b*3+1],vertices[b*3]));
  const contour=loop.map(i=>new Vector2(vertices[i*3],vertices[i*3+1]));
  for(const [a,b,c] of ShapeUtils.triangulateShape(contour,[])){
    const cross=(contour[b].x-contour[a].x)*(contour[c].y-contour[a].y)-(contour[b].y-contour[a].y)*(contour[c].x-contour[a].x);
    faces.push(loop[a],loop[cross>0?c:b],loop[cross>0?b:c]);
  }
  const result=new BufferGeometry();result.setAttribute('position',new Float32BufferAttribute(vertices,3));result.setIndex(faces);
  result.setAttribute('normal',new Float32BufferAttribute(normals,3));result.normalizeNormals();result.computeBoundingBox();return result;
}

/** Each tetrahedron lies within one horizontal grid band. Stretch only bands
 * whose actual facets need more rise, preserving XY, topology and bed contact.
 * This corrects discretization at crotches as well as the analytic surface.
 * A margin below 45 degrees accommodates Float32 serialization. */
function constrainOverhangs(geometry:BufferGeometry,spacing:number,origin:number) {
  const p=geometry.getAttribute('position'),idx=geometry.getIndex()!;
  const factors=new Float64Array(Math.ceil((geometry.boundingBox!.max.z-origin)/spacing)+2).fill(1);
  for(let i=0;i<idx.count;i+=3){
    const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);
    if(Math.max(p.getZ(a),p.getZ(b),p.getZ(c))<1e-5)continue;
    const ux=p.getX(b)-p.getX(a),uy=p.getY(b)-p.getY(a),uz=p.getZ(b)-p.getZ(a);
    const vx=p.getX(c)-p.getX(a),vy=p.getY(c)-p.getY(a),vz=p.getZ(c)-p.getZ(a);
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    if(nz>=0)continue;
    const stretch=-nz/(Math.hypot(nx,ny)*Math.tan(44.5*Math.PI/180));
    if(!Number.isFinite(stretch)||stretch>8)throw new Error('A horizontal underside could not be resolved. Increase tip size or branch gap.');
    const band=Math.floor(((p.getZ(a)+p.getZ(b)+p.getZ(c))/3-origin)/spacing);
    factors[band]=Math.max(factors[band],stretch);
  }
  const offsets=new Float64Array(factors.length+1);
  for(let i=0;i<factors.length;i++)offsets[i+1]=offsets[i]+(factors[i]-1)*spacing;
  const lift=(z:number)=>{const t=(z-origin)/spacing,i=Math.floor(t);return z+offsets[i]+(t-i)*spacing*(factors[i]-1);};
  const base=lift(0);
  const normals=geometry.getAttribute('normal');
  for(let i=0;i<p.count;i++){
    const z=p.getZ(i),band=Math.floor((z-origin)/spacing);
    normals.setZ(i,normals.getZ(i)/factors[band]);p.setZ(i,lift(z)-base);
  }
  p.needsUpdate=true;normals.needsUpdate=true;geometry.normalizeNormals();geometry.computeBoundingBox();
  let report=inspectOverhangs(geometry);
  // At taller coordinates Float32 rounding can move a tiny facet beyond the
  // target after the band correction. Add conservative vertical rise, then
  // audit the stored coordinates again; never waive the final 45 degree limit.
  for(let attempt=0;report.violations&&attempt<3;attempt++){
    const rise=Math.tan(report.maximum*Math.PI/180)/Math.tan(43.5*Math.PI/180);
    if(!Number.isFinite(rise)||rise>1.5)break;
    for(let i=0;i<p.count;i++){p.setZ(i,p.getZ(i)*rise);normals.setZ(i,normals.getZ(i)/rise);}
    geometry.normalizeNormals();geometry.computeBoundingBox();report=inspectOverhangs(geometry);
  }
  if(report.violations)throw new Error(`Surface exceeds the 45° limit (${report.maximum.toFixed(1)}°). Try increasing branch gap or tip size.`);
}

/** Retry sampling artifacts at finer resolution without changing the seed or growth.
 * Each candidate must pass the same full validation; failures are never bypassed. */
export function meshTreeForExport(growth: TreeGrowth, recipe: TreeRecipe, progress: (message: string) => void = () => {}) {
  let lastError: Error | undefined;
  let lastSpacing = Infinity;
  for(const refinement of [1,0.75,0.55]) {
    progress(refinement===1?'Building export surface…':'Refining the surface to resolve small gaps…');
    const result=meshTree(growth,recipe,'export',refinement);
    if(result.spacing>=lastSpacing*0.98) {result.geometry.dispose();break;}
    lastSpacing=result.spacing;
    progress('Checking mesh closure and branch connections…');
    try {validateTreeMesh(result.geometry);validateBuildVolume(result.geometry);return result;}
    catch(error) {
      result.geometry.dispose();
      lastError=error as Error;
      if(!/collapsed triangle|detached a tip|joined nearby branches/.test(lastError.message))throw error;
    }
  }
  throw new Error(`${lastError?.message || 'Unable to resolve the export surface.'} Automatic refinement reached its detail limit.`);
}

/** Intersect actual triangles, so the inspector includes merged junctions and multiple outlines. */
export function sliceMesh(geometry: BufferGeometry, z: number): number[] {
  const p=geometry.getAttribute('position'),idx=geometry.getIndex()!,lines:number[]=[];
  for(let i=0;i<idx.count;i+=3) {
    const ids=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)], hits:number[]=[];
    for(let j=0;j<3;j++) {
      const a=ids[j],b=ids[(j+1)%3],az=p.getZ(a),bz=p.getZ(b);
      if((az<=z&&bz>z)||(bz<=z&&az>z)) {
        const t=(z-az)/(bz-az);hits.push(p.getX(a)+(p.getX(b)-p.getX(a))*t,p.getY(a)+(p.getY(b)-p.getY(a))*t,z);
      }
    }
    if(hits.length===6)lines.push(...hits);
  }
  return lines;
}

/** Angle from vertical of each downward-facing surface. Only the coplanar
 * build-plate face is exempt; upward-facing tip caps need no support below. */
export function inspectOverhangs(geometry:BufferGeometry, limit=45) {
  const p=geometry.getAttribute('position'),idx=geometry.getIndex()!;
  let maximum=0,violations=0,area=0;
  for(let i=0;i<idx.count;i+=3){
    const a=idx.getX(i),b=idx.getX(i+1),c=idx.getX(i+2);
    if(Math.max(Math.abs(p.getZ(a)),Math.abs(p.getZ(b)),Math.abs(p.getZ(c)))<1e-5)continue;
    const ux=p.getX(b)-p.getX(a),uy=p.getY(b)-p.getY(a),uz=p.getZ(b)-p.getZ(a);
    const vx=p.getX(c)-p.getX(a),vy=p.getY(c)-p.getY(a),vz=p.getZ(c)-p.getZ(a);
    const nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
    if(nz>=0)continue;
    const angle=Math.atan2(-nz,Math.hypot(nx,ny))*180/Math.PI;
    maximum=Math.max(maximum,angle);
    if(angle>limit+1e-4){violations++;area+=Math.hypot(nx,ny,nz)/2;}
  }
  return {maximum,violations,area,limit};
}

/** Reject a discretized export if it has open seams, detached fragments, or handles
 * from accidental reconnections. Growth clearance alone is not a mesh guarantee. */
export function validateTreeMesh(geometry: BufferGeometry) {
  const p=geometry.getAttribute('position'),idx=geometry.getIndex()!;
  if(!idx || !idx.count)throw new Error('The tree surface is empty.');
  const edges=new Map<number,number>(),parents=Uint32Array.from({length:p.count},(_,i)=>i);
  const root=(i:number):number=>{while(parents[i]!==i){parents[i]=parents[parents[i]];i=parents[i];}return i;};
  let volume=0;
  for(const n of p.array)if(!Number.isFinite(n))throw new Error('Non-finite tree surface.');
  for(let i=0;i<idx.count;i+=3) {
    const tri=[idx.getX(i),idx.getX(i+1),idx.getX(i+2)];
    for(let j=0;j<3;j++) {
      const a=tri[j],b=tri[(j+1)%3],key=Math.min(a,b)*p.count+Math.max(a,b);
      edges.set(key,(edges.get(key)||0)+(a<b?5:3));parents[root(a)]=root(b);
    }
    const [a,b,c]=tri.map(k=>[p.getX(k),p.getY(k),p.getZ(k)]);
    const u=b.map((v,j)=>v-a[j]),v=c.map((v,j)=>v-a[j]);
    if(Math.hypot(u[1]*v[2]-u[2]*v[1],u[2]*v[0]-u[0]*v[2],u[0]*v[1]-u[1]*v[0])<1e-12)throw new Error('A numerical mesh error produced a collapsed triangle. Save this recipe so the case can be reproduced.');
    volume+=(a[0]*(b[1]*c[2]-b[2]*c[1])+a[1]*(b[2]*c[0]-b[0]*c[2])+a[2]*(b[0]*c[1]-b[1]*c[0]))/6;
  }
  if([...edges.values()].some(n=>n!==8))throw new Error('Tree mesh has an open or inconsistently wound edge.');
  const base=root(0);
  for(let i=1;i<p.count;i++)if(root(i)!==base)throw new Error('Grid resolution detached a tip. Increase tip size or reduce height/spread.');
  if(p.count-edges.size+idx.count/3!==2)throw new Error('Grid resolution joined nearby branches. Increase branch gap or reduce branching.');
  if(volume<=0)throw new Error('Tree surface has inverted orientation.');
  return {volume,triangles:idx.count/3};
}
