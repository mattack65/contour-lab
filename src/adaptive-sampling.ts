/** Local chord-error sampling. Mandatory knots are never crossed or removed.
 * Quarter samples guard against inflections whose midpoint lies on the chord.
 * This is a sampled preview tolerance, not a continuous error certificate. */
export function adaptiveStations(knots:number[],maxStep:number,minStep:number,tolerance:number,
  sample:(z:number)=>[number,number][]):number[] {
  const heights=[knots[0]];
  for(let span=1;span<knots.length;span++) {
    const start=knots[span-1],end=knots[span];
    if(end<=start)continue;
    const count=Math.ceil((end-start)/maxStep);
    for(let j=0;j<count;j++) {
      const a=start+(end-start)*j/count,b=j===count-1?end:start+(end-start)*(j+1)/count;
      // Bounded lifetime: do not retain every strand ring over the whole height.
      const cache=new Map<number,[number,number][]>();
      const at=(z:number)=>{let ring=cache.get(z);if(!ring){ring=sample(z);cache.set(z,ring);}return ring;};
      const refine=(low:number,high:number)=>{
        if(high-low<=minStep*(1+1e-9)){heights.push(high);return;}
        const left=at(low),right=at(high);
        let split=false;
        for(const t of [.25,.5,.75]) {
          const middle=at(low+(high-low)*t);
          for(let k=0;k<left.length;k++) {
            const dx=middle[k][0]-left[k][0]*(1-t)-right[k][0]*t;
            const dy=middle[k][1]-left[k][1]*(1-t)-right[k][1]*t;
            if(dx*dx+dy*dy>tolerance*tolerance){split=true;break;}
          }
          if(split)break;
        }
        if(split){const mid=(low+high)/2;refine(low,mid);refine(mid,high);}
        else heights.push(high);
      };
      refine(a,b);
    }
  }
  return heights;
}
