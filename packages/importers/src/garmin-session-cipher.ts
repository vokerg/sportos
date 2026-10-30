import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import type {CredentialEnvelope,CredentialKeyRing} from './credential-cipher.js';
export interface GarminSession{di_token:string;di_refresh_token:string;di_client_id:string}
export function validateGarminSession(raw:unknown):GarminSession{
 if(!raw||typeof raw!=='object'||Array.isArray(raw)||Object.keys(raw).sort().join(',')!=='di_client_id,di_refresh_token,di_token')throw new Error('Invalid Garmin session');
 const value=raw as Record<string,unknown>;
 for(const key of ['di_token','di_refresh_token','di_client_id'])if(typeof value[key]!=='string'||!value[key]||value[key].length>40000)throw new Error('Invalid Garmin session');
 return {di_token:value.di_token as string,di_refresh_token:value.di_refresh_token as string,di_client_id:value.di_client_id as string};
}
/** Versioned, provider/owner/connection-bound envelope. No passwords or profiles. */
export class GarminSessionCipher{
 constructor(private ring:CredentialKeyRing){}
 private aad(owner:string,connection:string){return Buffer.from(JSON.stringify({ownerId:owner,connectionId:connection,provider:'garmin',envelopeVersion:1,format:'garminconnect.di.v1'}))}
 private key(id:string){const key=this.ring.keys.get(id);if(!key||key.length!==32)throw new Error('Garmin credential key unavailable');return key}
 encrypt(owner:string,connection:string,raw:unknown):CredentialEnvelope{
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.key(this.ring.activeKeyId),nonce);cipher.setAAD(this.aad(owner,connection));
  const ciphertext=Buffer.concat([cipher.update(JSON.stringify(validateGarminSession(raw)),'utf8'),cipher.final()]);
  return {algorithm:'aes-256-gcm',envelopeVersion:1,keyId:this.ring.activeKeyId,nonce:nonce.toString('base64'),ciphertext:ciphertext.toString('base64'),authenticationTag:cipher.getAuthTag().toString('base64')};
 }
 decrypt(owner:string,connection:string,envelope:CredentialEnvelope):GarminSession{
  try{
   if(envelope.algorithm!=='aes-256-gcm'||envelope.envelopeVersion!==1||typeof envelope.ciphertext!=='string'||envelope.ciphertext.length>200000)throw new Error();
   const nonce=Buffer.from(envelope.nonce,'base64'),tag=Buffer.from(envelope.authenticationTag,'base64');if(nonce.length!==12||tag.length!==16)throw new Error();
   const decipher=createDecipheriv('aes-256-gcm',this.key(envelope.keyId),nonce);decipher.setAAD(this.aad(owner,connection));decipher.setAuthTag(tag);
   return validateGarminSession(JSON.parse(Buffer.concat([decipher.update(Buffer.from(envelope.ciphertext,'base64')),decipher.final()]).toString('utf8')));
  }catch{throw new Error('Garmin credential envelope authentication failed')}
 }
}
