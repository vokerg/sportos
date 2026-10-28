import {createRequire} from 'node:module';
import {afterEach,describe,expect,it} from 'vitest';
import {MobileApiClient} from '../../../packages/shared/src/mobile-api';
import {validAuthorizationUrl} from '../src/auth/url-policy.mjs';
const ownRequire=createRequire(import.meta.url);
const nativeRequire=createRequire(ownRequire.resolve('react-native-url-polyfill/package.json'));
const native=nativeRequire('whatwg-url-without-unicode');
const original=globalThis.URL;
afterEach(()=>{globalThis.URL=original;});
describe('actual React Native URL implementation',()=>{
 it('accepts exact authorization URLs without URLSearchParams.size and rejects extra params',()=>{
  globalThis.URL=native.URL;
  expect(new URL('https://web.example/').searchParams.size).toBeUndefined();
  expect(validAuthorizationUrl('https://web.example/mobile-connect?request='+'r'.repeat(43),'https://web.example')).toBe(true);
  expect(validAuthorizationUrl('https://web.example/mobile-connect?request=a&request=b','https://web.example')).toBe(false);
 });
 it('completes verifier-bound exchange using the native callback parser',async()=>{
  globalThis.URL=native.URL;
  const session={account:{id:'fixture',displayName:'Fixture',email:null},expiresAt:'2099-01-01',absoluteExpiresAt:'2099-01-02'};
  let saved:string|null=null;
  const api=new MobileApiClient('https://api.example',{read:async()=>saved,write:async v=>{saved=v;},remove:async()=>{saved=null;}},async()=>new Response(JSON.stringify({...session,token:'smo_'+'a'.repeat(64)})));
  const callback='sportos://auth/callback?code='+'c'.repeat(43)+'&state='+'s'.repeat(43);
  expect(await api.finishSignIn(callback,'s'.repeat(43),'v'.repeat(43))).toEqual(session);
  await expect(api.finishSignIn(callback+'&state=extra','s'.repeat(43),'v'.repeat(43))).rejects.toMatchObject({kind:'invalid'});
 });
});
