import {expect,it} from 'vitest';
import {GarminSessionCipher,validateGarminSession} from './garmin-session-cipher.js';
const session={di_token:'synthetic-access',di_refresh_token:'synthetic-refresh',di_client_id:'synthetic-client'};
const ring={activeKeyId:'v1',keys:new Map([['v1',Buffer.alloc(32,1)],['v2',Buffer.alloc(32,2)]])};
it('encrypts randomized owner/connection/provider/version-bound sessions and supports retained key rotation',()=>{
 const cipher=new GarminSessionCipher(ring),envelope=cipher.encrypt('owner','connection',session);
 expect(cipher.decrypt('owner','connection',envelope)).toEqual(session);expect(JSON.stringify(envelope)).not.toContain('synthetic-access');
 expect(cipher.encrypt('owner','connection',session).nonce).not.toEqual(envelope.nonce);
 expect(()=>cipher.decrypt('other','connection',envelope)).toThrow();expect(()=>cipher.decrypt('owner','other',envelope)).toThrow();
 expect(()=>cipher.decrypt('owner','connection',{...envelope,authenticationTag:Buffer.alloc(16).toString('base64')})).toThrow();
 expect(new GarminSessionCipher({...ring,activeKeyId:'v2'}).decrypt('owner','connection',envelope)).toEqual(session);
 expect(()=>new GarminSessionCipher({activeKeyId:'v2',keys:new Map([['v2',Buffer.alloc(32,2)]])}).decrypt('owner','connection',envelope)).toThrow();
});
it('rejects passwords, profiles, unbounded/missing credentials and unsupported versions',()=>{
 for(const value of [{...session,password:'secret'},{...session,di_token:''},{...session,di_token:'x'.repeat(40001)},null,[]])expect(()=>validateGarminSession(value)).toThrow();
 const cipher=new GarminSessionCipher(ring),envelope=cipher.encrypt('owner','connection',session);
 expect(()=>cipher.decrypt('owner','connection',{...envelope,envelopeVersion:2 as never})).toThrow();
});
