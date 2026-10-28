import React from 'react';
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {describe,it,expect,vi,afterEach} from 'vitest';
import {SessionProvider,useSession} from '../src/auth/SessionProvider';
import {MobileApiError,type MobileApiClient} from '../../../packages/shared/src/mobile-api';
import {appState} from './native-mock';
vi.mock('../src/auth/native',()=>({browserSignIn:vi.fn()}));
Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
const session={account:{id:'synthetic',displayName:'Fixture',email:null},expiresAt:'2099-01-01T00:00:00Z',absoluteExpiresAt:'2099-01-02T00:00:00Z'};
let state:ReturnType<typeof useSession>;let tree:ReactTestRenderer|undefined;
function Harness(){state=useSession();return React.createElement('state',{status:state.status});}
const fixture=()=>({restore:vi.fn(async()=>session),cancelRequests:vi.fn(),signOut:vi.fn(async()=> 'revoked'),get:vi.fn(),mutate:vi.fn()});
async function mount(client:ReturnType<typeof fixture>){await act(async()=>{tree=create(<SessionProvider client={client as unknown as MobileApiClient}><Harness/></SessionProvider>);});}
afterEach(async()=>{await act(async()=>{tree?.unmount();});tree=undefined;appState('active');});
describe('native session lifecycle',()=>{
 it('unmounts private access on background and revalidates before resume',async()=>{
  const client=fixture();await mount(client);expect(state.status).toBe('authenticated');
  await act(async()=>{appState('inactive');});expect(state.status).toBe('locked');expect(state.session).toBeNull();expect(client.cancelRequests).toHaveBeenCalled();
  client.restore.mockResolvedValueOnce(null as never);
  await act(async()=>{appState('active');});expect(state.status).toBe('signedOut');expect(state.session).toBeNull();
 });
 it('offline resume never presents an old authoritative snapshot',async()=>{
  const client=fixture();await mount(client);await act(async()=>{appState('background');});
  client.restore.mockRejectedValueOnce(new Error('private transport failure'));
  await act(async()=>{appState('active');});expect(state.status).toBe('unavailable');expect(state.session).toBeNull();expect(state.message).not.toContain('private');
 });
 it('401 from any screen purges private navigation',async()=>{
  const client=fixture();await mount(client);client.get.mockRejectedValueOnce(new MobileApiError('unauthorized'));
  await act(async()=>{await expect(state.read('/activities')).rejects.toMatchObject({kind:'unauthorized'});});
  expect(state.status).toBe('signedOut');expect(state.session).toBeNull();
 });
 it('late restore cannot resurrect a signed-out view',async()=>{
  const client=fixture();let release!:(v:typeof session)=>void;client.restore.mockImplementationOnce(()=>new Promise(r=>{release=r;}));
  await mount(client);expect(state.status).toBe('restoring');
  await act(async()=>{await state.signOut();release(session);});expect(state.status).toBe('signedOut');expect(state.session).toBeNull();
 });
 it('failed Keychain removal hides private screens and reports incomplete sign-out',async()=>{
  const client=fixture();await mount(client);client.signOut.mockRejectedValueOnce(new Error('private'));
  await act(async()=>{await state.signOut();});expect(state.status).toBe('unavailable');expect(state.session).toBeNull();expect(state.message).toContain('secure session');
 });
});
