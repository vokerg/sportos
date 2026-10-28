const listeners=new Set<(state:string)=>void>();
export const AppState={currentState:'active',addEventListener:(_name:string,fn:(state:string)=>void)=>{listeners.add(fn);return{remove:()=>listeners.delete(fn)};}};
export function appState(next:string){AppState.currentState=next;for(const fn of listeners)fn(next);}
