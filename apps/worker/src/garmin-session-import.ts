import {lstat,readFile} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {createDb,loadEnvFromNearestFile,LEGACY_ACCOUNT_ID,withAccountContext,GarminJobsRepository,type Json} from '@sportos/db';
import {GarminSessionCipher,parseCredentialKeyRing,validateGarminSession} from '@sportos/importers';
loadEnvFromNearestFile();
const owner=process.argv.slice(2).filter(arg=>arg!=='--').join(' ');
if(owner!=='--legacy-account')throw new Error('Use --legacy-account to explicitly bind the current local Garmin session to the maintained account.');
const tokenPath=join(homedir(),'.local/share/sportos/garmin/tokens/garmin_tokens.json');
for(const path of [join(homedir(),'.local/share/sportos/garmin'),join(homedir(),'.local/share/sportos/garmin/tokens'),tokenPath]){const info=await lstat(path);if(info.isSymbolicLink()||info.uid!==process.getuid?.())throw new Error('Unsafe Garmin session store')}
const info=await lstat(tokenPath);if(!info.isFile()||info.size>131072||(info.mode&0o077)!==0)throw new Error('Invalid Garmin session file');
const session=validateGarminSession(JSON.parse(await readFile(tokenPath,'utf8')));
const cipher=new GarminSessionCipher(parseCredentialKeyRing(process.env.SPORTOS_PROVIDER_CREDENTIAL_KEYS??'',process.env.SPORTOS_PROVIDER_ACTIVE_KEY_ID??''));
if(!process.env.SPORTOS_WORKER_DATA_DATABASE_URL)throw new Error('Worker-data database configuration is required');
const db=createDb(process.env.SPORTOS_WORKER_DATA_DATABASE_URL);
try{await withAccountContext(db,LEGACY_ACCOUNT_ID,db=>new GarminJobsRepository(db).importSession(id=>cipher.encrypt(LEGACY_ACCOUNT_ID,id,session) as unknown as Json,Intl.DateTimeFormat().resolvedOptions().timeZone));console.log('Garmin session imported as an account-bound encrypted credential. No plaintext output.')}finally{await db.destroy()}
