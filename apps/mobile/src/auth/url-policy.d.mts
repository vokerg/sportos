/** Browser handoff URL policy used by the Expo bridge. */
export function isExactOrigin(origin: unknown, allowLocal?: boolean): boolean;
export function validAuthorizationUrl(urlValue: string, webOrigin: string | undefined, allowLocal?: boolean): boolean;

export function sessionStorageKey(origin:string):string;
