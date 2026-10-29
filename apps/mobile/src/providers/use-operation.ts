import {useCallback,useRef,useState} from 'react';
import {useFocusEffect} from '@react-navigation/native';
import {useSession} from '../auth/SessionProvider';
export interface OperationScope {read<T>(path:string):Promise<T>;mutate<T>(path:string,body?:unknown,method?:'POST'|'PUT'):Promise<T>;signal:AbortSignal}
/** Route-bound network cancellation, synchronous duplicate guard and late-result rejection. */
export function useOperation(){
 const session=useSession();const controller=useRef<AbortController|null>(null);const generation=useRef(0);const locked=useRef(false);
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 useFocusEffect(useCallback(()=>{controller.current=new AbortController();generation.current++;locked.current=false;setBusy(false);return()=>{generation.current++;controller.current?.abort();locked.current=false}},[]));
 const run=useCallback(async<T,>(task:(scope:OperationScope)=>Promise<T>,accept:(value:T)=>void,message:string)=>{
  if(locked.current||!controller.current||controller.current.signal.aborted)return;
  const current=generation.current,signal=controller.current.signal;locked.current=true;setBusy(true);setError('');
  try{const value=await task({read:<R,>(p:string)=>session.read<R>(p,signal),mutate:<R,>(p:string,body?:unknown,method:'POST'|'PUT'='POST')=>session.mutate<R>(p,method,body??{},signal),signal});if(generation.current===current&&!signal.aborted)accept(value)}
  catch{if(generation.current===current&&!signal.aborted)setError(message)}
  finally{if(generation.current===current){locked.current=false;setBusy(false)}}
 },[session.read,session.mutate]);
 return{run,busy,error};
}
/** Abortable bounded wait; teardown removes timers immediately. */
export function pollDelay(signal:AbortSignal,ms=5000){return new Promise<void>((resolve,reject)=>{
 if(signal.aborted){reject(new Error('Cancelled'));return}
 const abort=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);reject(new Error('Cancelled'))};
 const timer=setTimeout(()=>{signal.removeEventListener('abort',abort);resolve()},ms);signal.addEventListener('abort',abort,{once:true});
})}
