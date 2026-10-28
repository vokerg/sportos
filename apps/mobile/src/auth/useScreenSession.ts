import {useCallback,useRef} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {useSession} from './SessionProvider';

/** Cancel transport as well as UI writes when a private screen blurs/replaces. */
export function useScreenSession() {
  const session=useSession();
  const controller=useRef<AbortController|null>(null);
  useFocusEffect(useCallback(()=>{
    controller.current=new AbortController();
    return ()=>{controller.current?.abort();};
  },[]));
  // The optional signal keeps feature branches compatible with the foundation;
  // the hardened session transport consumes it for physical cancellation.
  const readWithSignal: <T>(path:string,signal?:AbortSignal)=>Promise<T> = session.read;
  const mutateWithSignal: <T>(path:string,method:'POST'|'PUT'|'DELETE',body?:unknown,signal?:AbortSignal)=>Promise<T> = session.mutate;
  const read=useCallback(<T,>(path:string)=>readWithSignal<T>(path,controller.current?.signal),[readWithSignal]);
  const mutate=useCallback(<T,>(path:string,method:'POST'|'PUT'|'DELETE',body?:unknown)=>mutateWithSignal<T>(path,method,body,controller.current?.signal),[mutateWithSignal]);
  return {...session,read,mutate};
}
