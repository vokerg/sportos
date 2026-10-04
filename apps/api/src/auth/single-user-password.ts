import { createHash, scrypt, timingSafeEqual } from 'node:crypto';

export async function verifySingleUserPassword(username: string, password: string): Promise<boolean> {
  const encoded = process.env.SPORTOS_SINGLE_USER_PASSWORD_HASH ?? '';
  const match = /^scrypt-v1:([0-9a-f]{32}):([0-9a-f]{128})$/.exec(encoded);
  if (!match || !process.env.SPORTOS_SINGLE_USER_USERNAME) return false;
  const derived = await new Promise<Buffer>((resolve, reject) => {
    scrypt(password, Buffer.from(match[1]!, 'hex'), 64,
      { N: 65_536, r: 8, p: 1, maxmem: 128 * 1024 * 1024 },
      (error, key) => error ? reject(error) : resolve(key));
  });
  const nameHash = (value: string) => createHash('sha256').update(value).digest();
  const validName = timingSafeEqual(nameHash(username), nameHash(process.env.SPORTOS_SINGLE_USER_USERNAME));
  const validPassword = timingSafeEqual(derived, Buffer.from(match[2]!, 'hex'));
  return validName && validPassword;
}
