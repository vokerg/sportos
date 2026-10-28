import type {ConfigContext,ExpoConfig} from 'expo/config';
import {isExactOrigin} from './src/auth/url-policy.mjs';
/** Release builds fail early without explicit public HTTPS deployment origins. */
export default ({config}:ConfigContext):ExpoConfig=>{
 const release=process.env.EAS_BUILD_PROFILE==='production'||process.env.SPORTOS_MOBILE_RELEASE==='true';
 if(release&&(!isExactOrigin(process.env.EXPO_PUBLIC_SPORTOS_API_URL)||!isExactOrigin(process.env.EXPO_PUBLIC_SPORTOS_WEB_ORIGIN)||process.env.EXPO_PUBLIC_ALLOW_INSECURE_LOCALHOST==='true')){
  throw new Error('Release requires explicit HTTPS API/web origins and disables insecure localhost.');
 }
 return {...config,name:'SportOS',slug:'sportos'};
};
