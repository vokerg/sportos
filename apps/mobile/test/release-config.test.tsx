import {afterEach,describe,expect,it,vi} from 'vitest';
import config from '../app.config';
const context={config:{name:'SportOS',slug:'sportos'},projectRoot:'.',staticConfigPath:null,packageJsonPath:null};
afterEach(()=>vi.unstubAllEnvs());
function setup(profile:string){
 vi.stubEnv('EAS_BUILD_PROFILE',profile);
 vi.stubEnv('SPORTOS_MOBILE_RELEASE','false');
 vi.stubEnv('EXPO_PUBLIC_SPORTOS_API_URL','https://api.example.test');
 vi.stubEnv('EXPO_PUBLIC_SPORTOS_WEB_ORIGIN','https://app.example.test');
 vi.stubEnv('EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST','false');
}
describe('embedded release origin boundary',()=>{
 for(const profile of ['preview','production']){
  it(`${profile} requires configured HTTPS deployment origins`,()=>{
   setup(profile);expect(config(context).name).toBe('SportOS');
   for(const origin of ['', 'http://localhost:3010', 'http://api.example.test', 'https://user:password@api.example.test', 'https://api.example.test/path']){
    vi.stubEnv('EXPO_PUBLIC_SPORTOS_API_URL',origin);expect(()=>config(context)).toThrow('Release requires explicit HTTPS');
   }
  });
  it(`${profile} refuses an insecure browser origin or localhost flag`,()=>{
   setup(profile);vi.stubEnv('EXPO_PUBLIC_SPORTOS_WEB_ORIGIN','http://localhost:4210');expect(()=>config(context)).toThrow();
   vi.stubEnv('EXPO_PUBLIC_SPORTOS_WEB_ORIGIN','https://app.example.test');vi.stubEnv('EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST','true');expect(()=>config(context)).toThrow();
  });
 }
 it('local Release flag applies the same gate without EAS',()=>{
  setup('');vi.stubEnv('SPORTOS_MOBILE_RELEASE','true');vi.stubEnv('EXPO_PUBLIC_SPORTOS_API_URL','');expect(()=>config(context)).toThrow();
 });
 it('development keeps the explicit loopback setup available',()=>{
  setup('development');vi.stubEnv('EXPO_PUBLIC_SPORTOS_API_URL','http://localhost:3010');vi.stubEnv('EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST','true');expect(config(context).slug).toBe('sportos');
 });
});
