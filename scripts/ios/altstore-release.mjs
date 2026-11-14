// Private AltStore import package, never a direct device installer.
import {spawnSync} from 'node:child_process';
import {existsSync,readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,readdirSync,lstatSync,openSync,closeSync,chmodSync} from 'node:fs';
import {homedir} from 'node:os';
import path from 'node:path';
import {parseEnv} from 'node:util';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {isExactOrigin} from '../../apps/mobile/src/auth/url-policy.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const mobile=path.join(root,'apps/mobile');
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
export function publicEnvironment(local,inherited){
 const allowed=['EXPO_PUBLIC_SPORTOS_API_URL','EXPO_PUBLIC_SPORTOS_WEB_ORIGIN','EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST'];
 for(const key of new Set([...Object.keys(local),...Object.keys(inherited)]))assert(!key.startsWith('EXPO_PUBLIC_')||allowed.includes(key),'Unreviewed public configuration key');
 const env={};
 for(const key of ['HOME','USER','LOGNAME','PATH','TMPDIR','DEVELOPER_DIR','LANG'])if(inherited[key])env[key]=inherited[key];
 for(const key of allowed)if(inherited[key]??local[key])env[key]=inherited[key]??local[key];
 assert(isExactOrigin(env.EXPO_PUBLIC_SPORTOS_API_URL)&&isExactOrigin(env.EXPO_PUBLIC_SPORTOS_WEB_ORIGIN)&&env.EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST!=='true','Release requires exact HTTPS API/web origins and no insecure localhost');
 return {...env,EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST:'false',SPORTOS_MOBILE_RELEASE:'true',EXPO_NO_DOTENV:'1',NODE_ENV:'production',CI:'1',NODE_BINARY:process.execPath,RCT_NO_LAUNCH_PACKAGER:'1'};
}
export function auditFiles(dir){
 for(const entry of readdirSync(dir,{withFileTypes:true})){
  const p=path.join(dir,entry.name);assert(!lstatSync(p).isSymbolicLink(),'Unexpected payload symlink');
  assert(!/^(\.env(?:\..*)?|\.git|node_modules|.*\.(?:pem|p12|key|sqlite3?|db|map|xcarchive))$/i.test(entry.name),'Unexpected private/development payload file');
  if(entry.isDirectory())auditFiles(p);
  else assert(!/(?:-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|github_pat_[A-Za-z0-9_]{20,}|ghp_[A-Za-z0-9]{30,}|sk-proj-[A-Za-z0-9_-]{30,}|smo_[A-Za-z0-9_-]{30,})/.test(readFileSync(p).toString('latin1')),'Credential pattern found in payload');
 }
}
export function runRelease(args=process.argv.slice(2)){
 assert(args.length===0,'Usage: scripts/ios/altstore-release.sh (no install or identity overrides)');
 assert(process.platform==='darwin'&&process.versions.node.split('.')[0]==='22'&&Number(process.versions.node.split('.')[1])>=22,'Use macOS and Node 22.22+');
 process.umask(0o077);
 const base=path.join(homedir(),'Library/Application Support/SportOS/iOS Releases');mkdirSync(base,{recursive:true,mode:0o700});chmodSync(base,0o700);
 const out=mkdtempSync(path.join(base,'altstore-'));console.log('Private release directory:',out);
 const fd=openSync(path.join(out,'build.log'),'a',0o600);
 try{
  // This explicit ignored file contains public settings only. Root .env never enters the build.
  const env=publicEnvironment(parseEnv(readFileSync(path.join(mobile,'.env.altstore'),'utf8')),process.env);
  const run=(cmd,argv,capture=false)=>{
   const r=spawnSync(cmd,argv,{cwd:root,env,encoding:'utf8',maxBuffer:64*1024*1024,stdio:capture?['ignore','pipe',fd]:['ignore',fd,fd]});
   assert(!r.error&&r.status===0,`${cmd} failed; inspect private build.log`);return r.stdout?.trim();
  };
  const plist=p=>JSON.parse(run('plutil',['-convert','json','-o','-',p],true));
  const commit=run('git',['rev-parse','HEAD'],true),status=run('git',['status','--porcelain=v1','--untracked-files=all'],true);
  writeFileSync(path.join(out,'source-status.txt'),status+'\n');
  writeFileSync(path.join(out,'source.patch'),run('git',['diff','HEAD','--binary'],true)+'\n');
  const config=JSON.parse(readFileSync(path.join(mobile,'app.json'),'utf8')).expo;
  assert(config.ios.bundleIdentifier==='com.sportos.mobile'&&config.scheme==='sportos','Unexpected app identity');
  let last=Number(config.ios.buildNumber);
  for(const e of readdirSync(base,{withFileTypes:true})){
   const f=path.join(base,e.name,'release.json');if(e.isDirectory()&&existsSync(f))last=Math.max(last,Number(JSON.parse(readFileSync(f,'utf8')).build));
  }
  const build=String(Math.max(Math.floor(Date.now()/1000),last+1)),version=config.version;
  const input=path.join(out,'Input-Info.plist');cpSync(path.join(mobile,'ios/SportOS/Info.plist'),input);
  for(const [key,value] of Object.entries({CFBundleDisplayName:'SportOS AltStore',CFBundleShortVersionString:version,CFBundleVersion:build}))run('/usr/libexec/PlistBuddy',['-c',`Set :${key} ${value}`,input]);
  const derived=path.join(base,'BuildCache');
  console.log('Building physical arm64 Release; no Metro server or direct installation.');
  // AltStore supplies the Apple signature/profile. Ad-hoc signing is for local integrity only.
  run('xcodebuild',['-workspace',path.join(mobile,'ios/SportOS.xcworkspace'),'-scheme','SportOS','-configuration','Release','-sdk','iphoneos','-destination','generic/platform=iOS','-derivedDataPath',derived,`INFOPLIST_FILE=${input}`,`MARKETING_VERSION=${version}`,`CURRENT_PROJECT_VERSION=${build}`,'CODE_SIGNING_ALLOWED=NO','build']);
  const app=path.join(derived,'Build/Products/Release-iphoneos/SportOS.app');
  // Compile an unsigned import artifact, then add a local integrity signature.
  // Device security remains enforced; only AltStore can provision/install this IPA.
  const frameworks=path.join(app,'Frameworks');
  if(existsSync(frameworks))for(const entry of readdirSync(frameworks)){
   assert(entry.endsWith('.framework')||entry.endsWith('.dylib'),'Unexpected embedded code; review signing');
   run('codesign',['--force','--sign','-',path.join(frameworks,entry)]);
  }
  run('codesign',['--force','--sign','-',app]);
  run('codesign',['--verify','--deep','--strict',app]);
  const info=plist(path.join(app,'Info.plist'));
  assert(info.CFBundleIdentifier==='com.sportos.mobile'&&info.CFBundleDisplayName==='SportOS AltStore'&&info.CFBundleVersion===build&&info.CFBundleShortVersionString===version,'Built identity/version mismatch');
  assert(info.CFBundleSupportedPlatforms?.includes('iPhoneOS')&&info.CFBundleURLTypes?.some(x=>x.CFBundleURLSchemes?.includes('sportos')),'Device platform/callback missing');
  assert(!info.NSAppTransportSecurity?.NSAllowsArbitraryLoads&&!info.NSFaceIDUsageDescription&&!info.NSLocalNetworkUsageDescription,'Unexpected transport/privacy permission');
  const bundle=path.join(app,'main.jsbundle');assert(existsSync(bundle)&&lstatSync(bundle).size>1000,'Embedded JS missing');
  const js=readFileSync(bundle).toString('latin1');
  for(const key of ['EXPO_PUBLIC_SPORTOS_API_URL','EXPO_PUBLIC_SPORTOS_WEB_ORIGIN'])assert(js.includes(env[key]),'Intended HTTPS origin missing from embedded bundle');
  run('lipo',[path.join(app,info.CFBundleExecutable),'-verify_arch','arm64']);
  const signature=spawnSync('codesign',['-d','--verbose=4','--entitlements',':-',app],{env,encoding:'utf8'});
  assert(signature.status===0&&signature.stderr.includes('Signature=adhoc'),'Expected local ad-hoc signature');
  writeFileSync(path.join(out,'signature.txt'),signature.stderr+'\n'+signature.stdout);
  assert(!existsSync(path.join(app,'embedded.mobileprovision')),'Unexpected Apple provisioning profile; review identity');
  // Generated native entitlements must remain empty; no team/Keychain override.
  assert(Object.keys(plist(path.join(mobile,'ios/SportOS/SportOS.entitlements'))).length===0,'Review changed native entitlements');
  auditFiles(app);
  // Compare non-public root environment values locally without logging them.
  const privateEnv=existsSync(path.join(root,'.env'))?parseEnv(readFileSync(path.join(root,'.env'),'utf8')):{};
  for(const [key,value] of Object.entries(privateEnv)){
   if(/(?:PASSWORD|SECRET|TOKEN|DATABASE_URL|CREDENTIAL_KEYS|API_KEY)$/.test(key)&&value.length>=16)assert(!readFileSync(bundle).includes(Buffer.from(value)),'Private configuration found in embedded JS');
  }
  const payload=path.join(out,'package/Payload');mkdirSync(payload,{recursive:true});cpSync(app,path.join(payload,'SportOS.app'),{recursive:true});
  const ipa=path.join(out,`SportOS-${version}-${build}.ipa`);run('ditto',['-c','-k','--keepParent',payload,ipa]);run('unzip',['-t',ipa]);
  const entries=run('unzip',['-Z1',ipa],true).split('\n');assert(entries.every(x=>x==='Payload/'||x.startsWith('Payload/SportOS.app/')),'Unexpected IPA root');
  const metadata={schemaVersion:1,commit,dirty:Boolean(status),version,build,displayName:info.CFBundleDisplayName,bundleIdentifier:info.CFBundleIdentifier,builtAt:new Date().toISOString(),ipa:path.basename(ipa),size:lstatSync(ipa).size,sha256:createHash('sha256').update(readFileSync(ipa)).digest('hex'),signature:'ad-hoc; Apple signing/profile required through AltStore import',profile:null,minimumOSVersion:info.MinimumOSVersion,embeddedJS:true,distribution:'altstore-parallel',deviceAcceptance:'pending'};
  writeFileSync(path.join(out,'release.json'),JSON.stringify(metadata,null,2)+'\n');
  console.log(JSON.stringify({ipa,version,build,size:metadata.size,sha256:metadata.sha256,commit,dirty:metadata.dirty}));return out;
 }finally{closeSync(fd);}
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))try{runRelease();}catch(e){console.error(e.message);process.exitCode=1;}
