/** Shared modal filename editor. Cancelling never starts a write or geometry job. */
export function askFilename(options:{
  title:string;suggestedName:string;action:string;hint:string;validate:(value:string)=>string;
}):Promise<string|null>{
  const dialog=document.getElementById('filename-dialog') as HTMLDialogElement;
  // Ignore a second invocation while the modal owns the user's input.
  if(dialog.open)return Promise.resolve(null);
  const form=document.getElementById('filename-form') as HTMLFormElement;
  const input=document.getElementById('filename-input') as HTMLInputElement;
  const error=document.getElementById('filename-error')!;
  const preview=document.getElementById('filename-preview')!;
  document.getElementById('filename-title')!.textContent=options.title;
  document.getElementById('filename-hint')!.textContent=options.hint;
  document.getElementById('filename-confirm')!.textContent=options.action;
  const cancel=document.getElementById('filename-cancel')!;
  input.value=options.suggestedName;preview.textContent=input.value;
  error.hidden=true;input.removeAttribute('aria-invalid');
  return new Promise(resolve=>{
    let result:string|null=null;
    const onInput=()=>{preview.textContent=input.value;error.hidden=true;input.removeAttribute('aria-invalid');};
    const onSubmit=(event:SubmitEvent)=>{
      event.preventDefault();
      try{result=options.validate(input.value);dialog.close();}
      catch(reason){error.textContent=(reason as Error).message;error.hidden=false;input.setAttribute('aria-invalid','true');input.focus();}
    };
    const onCancel=()=>dialog.close();
    const onClose=()=>{
      form.removeEventListener('submit',onSubmit);input.removeEventListener('input',onInput);
      cancel.removeEventListener('click',onCancel);dialog.removeEventListener('close',onClose);
      resolve(result);
    };
    form.addEventListener('submit',onSubmit);input.addEventListener('input',onInput);
    cancel.addEventListener('click',onCancel);dialog.addEventListener('close',onClose);
    dialog.showModal();input.focus();
    input.setSelectionRange(0,input.value.replace(/\.(json|stl)$/i,'').length);
  });
}
