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
  const read=useCallback(<T,>(path:string)=>session.read<T>(path,controller.current?.signal),[session.read]);
  const mutate=useCallback(<T,>(path:string,method:'POST'|'PUT'|'DELETE',body?:unknown)=>session.mutate<T>(path,method,body,controller.current?.signal),[session.mutate]);
  return {...session,read,mutate};
}
