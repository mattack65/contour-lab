/** Counts describe work items within a step, never a percentage of build time. */
export type BuildPhase='generate'|'fusion'|'interior'|'checks'|'display';
export interface ProgressWork {phase?:BuildPhase;completed?:number;total?:number;unit?:string}
export type ProgressCallback=(message:string,work?:ProgressWork)=>void;
export const phaseLabels:Record<BuildPhase,string>={generate:'Generate',fusion:'Fuse',interior:'Interior',checks:'Check',display:'Display'};
export function buildPhase(message:string,current:BuildPhase,interior:boolean):BuildPhase {
 if(/preparing display/i.test(message))return 'display';
 if(/finished|validating|connected material|precision|microscopic|collinear/i.test(message))return current==='interior'||current==='checks'?'checks':'fusion';
 if(/cavity|interior|pocket|outer fill|outer repair|outer valleys|larger smooth|restoring the bottom/i.test(message))return 'interior';
 if(/fus|joining|joined|contact|checking/i.test(message))return 'fusion';
 if(/reusing/i.test(message))return interior?'interior':'display';
 return current;
}
export function progressFraction(work?:ProgressWork):number|undefined {
 if(!work||!Number.isFinite(work.completed)||!Number.isFinite(work.total)||(work.total??0)<=0)return;
 return Math.max(0,Math.min(1,work.completed!/work.total!));
}
export function progressTime(ms:number):string {
 const seconds=Math.max(0,Math.floor(ms/1000));
 return seconds<60?`${seconds}s`:`${Math.floor(seconds/60)}m ${String(seconds%60).padStart(2,'0')}s`;
}
export class BuildProgressView {
 private root:HTMLElement; private active=false; private timer?:ReturnType<typeof setInterval>;
 private phases:BuildPhase[]=[];private current:BuildPhase='generate';private hasInterior=false;
 private started=0;private phaseStarted=0;private durations=new Map<BuildPhase,number>();
 private now:()=>number;
 constructor(root:HTMLElement,now:()=>number=()=>performance.now()){this.root=root;this.now=now;}
 private node<T extends HTMLElement=HTMLElement>(part:string){return this.root.querySelector<T>(`[data-progress="${part}"]`)!;}
 start(options:{cavity:boolean;reuseBase:boolean}) {
  this.stopTimer();this.active=true;this.hasInterior=options.cavity;
  this.phases=[...options.reuseBase?[]:['generate','fusion'] as BuildPhase[],...options.cavity?['interior'] as BuildPhase[]:[], 'checks','display'];
  this.current=this.phases[0];this.started=this.phaseStarted=this.now();this.durations.clear();
  this.root.hidden=false;this.root.dataset.state='running';this.node<HTMLDetailsElement>('timings').open=false;this.node('timings').hidden=true;
  this.node('steps').replaceChildren(...this.phases.map(p=>{const span=document.createElement('span');span.textContent=phaseLabels[p];span.dataset.phase=p;return span;}));
  this.update(options.reuseBase?'Reusing the checked strands…':'Preparing geometry…',{phase:this.current});
  this.timer=setInterval(()=>this.tick(),500);
 }
 update(message:string,work?:ProgressWork) {
  if(!this.active)return;
  const phase=work?.phase??buildPhase(message,this.current,this.hasInterior);
  if(this.phases.includes(phase)&&phase!==this.current){this.record();this.current=phase;this.phaseStarted=this.now();}
  const index=this.phases.indexOf(this.current);
  for(const el of this.node('steps').children){const item=el as HTMLElement;item.dataset.state=item.dataset.phase===this.current?'current':this.durations.has(item.dataset.phase as BuildPhase)?'done':'pending';}
  this.node('phase').textContent=`${phaseLabels[this.current]} · stage ${index+1} of ${this.phases.length}`;
  this.node('message').textContent=message;
  const fraction=progressFraction(work),bar=this.node<HTMLProgressElement>('bar');
  if(fraction===undefined){bar.removeAttribute('value');this.node('count').textContent='Working…';}
  else {bar.value=fraction;this.node('count').textContent=`${work!.completed!.toLocaleString()} / ${work!.total!.toLocaleString()} ${work!.unit??'items'} · ${Math.round(fraction*100)}% of this step`;}
  this.tick();
 }
 finish(outcome:'complete'|'failed'|'cancelled') {
  if(!this.active)return;this.record();this.tick();this.active=false;this.stopTimer();this.root.dataset.state=outcome;
  this.node('phase').textContent=outcome==='complete'?'Build complete':outcome==='failed'?'Build failed':'Build cancelled';
  this.node('message').textContent=outcome==='complete'?'Preview ready.':outcome==='failed'?'See the error above.':'Settings changed; start a new build when ready.';
  const bar=this.node<HTMLProgressElement>('bar');bar.value=outcome==='complete'?1:0;
  this.node('count').textContent='';
  for(const item of this.node('steps').children){const el=item as HTMLElement;if(outcome==='complete'){el.dataset.state=this.durations.has(el.dataset.phase as BuildPhase)?'done':'skipped';el.title=el.dataset.state==='skipped'?'Not needed for this build':'';}}
  this.node('timing-list').replaceChildren(...Array.from(this.durations,([phase,time])=>{const row=document.createElement('div');row.textContent=`${phaseLabels[phase]}: ${(time/1000).toFixed(1)} s`;return row;}));
  this.node('timings').hidden=false;
 }
 clear(){this.active=false;this.stopTimer();this.root.hidden=true;}
 private record(){this.durations.set(this.current,(this.durations.get(this.current)??0)+this.now()-this.phaseStarted);}
 private tick(){this.node('elapsed').textContent=`Elapsed ${progressTime(this.now()-this.started)} · stage ${progressTime(this.now()-this.phaseStarted)}`;}
 private stopTimer(){if(this.timer!==undefined)clearInterval(this.timer);this.timer=undefined;}
}
