/** Per-document transient cancellation, shared by independently injected scripts. */
export function controlYoutubeCapture(owner:string,create:boolean):string {
  const key=Symbol.for("harvest.youtube.capture.controls");
  type State={cancelled:boolean;timer:number};
  const host=window as unknown as Record<symbol,Map<string,State>|undefined>;
  const controls=host[key]??new Map<string,State>();
  const previous=controls.get(owner);
  if(previous){previous.cancelled=true;clearTimeout(previous.timer);controls.delete(owner);}
  if(create){
    host[key]=controls;
    const state:State={cancelled:false,timer:0};
    state.timer=window.setTimeout(()=>{state.cancelled=true;controls.delete(owner);if(!controls.size)delete host[key];},45000);
    controls.set(owner,state);
  }else if(!controls.size)delete host[key];
  return location.href;
}
