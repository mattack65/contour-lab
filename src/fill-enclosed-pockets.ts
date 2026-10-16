import type {ProgressCallback} from './build-progress.ts';
import type {Manifold,ManifoldToplevel} from 'manifold-3d';

/** A closed void is a separate, inward-facing boundary shell. The open vase
 * interior and through-holes belong to the outward shell and stay untouched.
 * Retain that shell verbatim: no convex hull, smoothing or guessed hole caps.
 * Caller owns the returned solid only when it differs from source. */
export function fillEnclosedPockets(source:Manifold,wasm:ManifoldToplevel,progress?:ProgressCallback) {
  if(source.status()!=='NoError')throw new Error('Cannot fill pockets in an invalid solid.');
  progress?.('Finding enclosed wall pockets…',{phase:'interior'});
  const shells=source.decompose();
  try {
    const positive:Manifold[]=[],negative:Manifold[]=[];
    let filledVolume=0,completed=0;
    progress?.('Classifying enclosed wall pockets…',{phase:'interior',completed,total:shells.length,unit:'shells'});
    for(const shell of shells) {
      const volume=shell.volume();
      if(!Number.isFinite(volume)||volume===0)throw new Error('Cannot classify a zero-volume wall pocket.');
      if(volume>0)positive.push(shell);
      else {negative.push(shell);filledVolume-=volume;}
      completed++;
      if(completed%16===0||completed===shells.length)progress?.('Classifying enclosed wall pockets…',{phase:'interior',completed,total:shells.length,unit:'shells'});
    }
    if(positive.length!==1)throw new Error('Fill enclosed wall pockets needs one connected body. Join disconnected strands with the outer repair fill first.');
    if(!negative.length)return {solid:source,filledPockets:0,filledVolume:0};
    const solid=new wasm.Manifold(positive[0].getMesh());
    if(solid.status()!=='NoError') {solid.delete();throw new Error('Filling the enclosed wall pockets did not produce a valid solid.');}
    return {solid,filledPockets:negative.length,filledVolume};
  } finally {for(const shell of shells)shell.delete();}
}
