/** Keep recipe controls in their dedicated editor; the sidebar is for viewing/export. */
export function setupRecipeLayout(groups:{element:HTMLElement;expanded:boolean}[]) {
  const dialog=document.getElementById('recipe-dialog') as HTMLDialogElement;
  const open=document.getElementById('expand-recipe') as HTMLButtonElement;
  const fold=document.getElementById('fold-recipe') as HTMLButtonElement;
  const build=document.getElementById('build-recipe') as HTMLButtonElement;
  const canvasBuild=document.getElementById('build') as HTMLButtonElement;
  let lastRecipeField:HTMLInputElement|undefined;
  dialog.addEventListener('focusin',event=>{
    if(event.target instanceof HTMLInputElement && ['text','number'].includes(event.target.type))
      lastRecipeField=event.target;
  });
  const foldAndBuild=()=>{
    if(canvasBuild.disabled)return;
    // Commit the currently edited value before taking the recipe snapshot.
    const active=document.activeElement;
    const field=active instanceof HTMLInputElement && ['text','number'].includes(active.type)
      ?active:dialog.open?lastRecipeField:undefined;
    // A pointer click focuses the button before its click handler runs.
    if(field?.isConnected)field.dispatchEvent(new Event('change',{bubbles:true}));
    lastRecipeField=undefined;
    if(active instanceof HTMLElement)active.blur();
    if(canvasBuild.disabled)return;
    if(dialog.open)dialog.close();
    canvasBuild.click();
  };
  build.addEventListener('click',foldAndBuild);
  document.addEventListener('keydown',(event)=>{
    if(!['Enter','NumpadEnter'].includes(event.code)||!(event.ctrlKey||event.metaKey)||
      event.altKey||event.shiftKey||event.repeat||event.isComposing||event.defaultPrevented)return;
    // Never turn an export/save filename confirmation into a sculpture build.
    if(document.querySelector(':popover-open')||
      [...document.querySelectorAll('dialog[open]')].some(d=>d!==dialog))return;
    event.preventDefault();event.stopPropagation();foldAndBuild();
  },true);
  groups[0].element.parentElement!.classList.add('recipe-columns');
  groups.forEach(g=>{g.element.classList.add('recipe-column');g.expanded=true;});
  open.addEventListener('click',()=>{
    if(dialog.open)return;
    open.setAttribute('aria-expanded','true');
    dialog.showModal();
  });
  // Keep Space's normal editing, scrolling and activation inside controls/dialogs.
  document.addEventListener('keydown',(event)=>{
    if(event.code!=='Space'||event.repeat||event.isComposing||event.defaultPrevented||
      event.altKey||event.ctrlKey||event.metaKey||event.shiftKey||document.querySelector('dialog[open],:popover-open'))return;
    const target=event.target;
    if(target instanceof HTMLElement && (target.isContentEditable||
      target.closest('input,textarea,select,button,a,[role="button"],[role="textbox"],[role="slider"]')))return;
    event.preventDefault();
    open.click();
  });
  fold.addEventListener('click',()=>dialog.close());
  dialog.addEventListener('close',()=>{
    open.setAttribute('aria-expanded','false');
    open.focus({preventScroll:true});
  });
}
