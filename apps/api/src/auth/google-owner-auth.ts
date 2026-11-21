import { UnauthorizedException } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

export const GOOGLE_ISSUER = 'https://accounts.google.com';
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));

export function personalAuthEnabled(env = process.env): boolean {
  return env.SPORTOS_AUTH_MODE === 'single-user' || env.SPORTOS_AUTH_MODE === 'single-user-google';
}

export function googleEnrollmentEnabled(env = process.env): boolean {
  return env.SPORTOS_AUTH_MODE === 'single-user' && env.SPORTOS_GOOGLE_ENROLLMENT === 'true';
}

export async function verifyGoogleOwnerToken(idToken: unknown, clientId: string, nonce: string) {
  if (typeof idToken !== 'string' || idToken.length > 16_384) {
    throw new UnauthorizedException('Google sign-in could not be verified.');
  }
  try {
    const { payload } = await jwtVerify(idToken, googleKeys, {
      issuer: GOOGLE_ISSUER,
      audience: clientId,
      algorithms: ['RS256'],
      requiredClaims: ['sub', 'iat', 'exp', 'nonce'],
    });
    if (!payload.sub || payload.sub.length > 255 || payload.nonce !== nonce
      || (payload.azp !== undefined && payload.azp !== clientId)
      || (Array.isArray(payload.aud) && payload.aud.length > 1 && payload.azp !== clientId)) {
      throw new Error('Unexpected Google identity claims.');
    }
    return {
      subject: payload.sub,
      verifiedEmail: payload.email_verified === true && typeof payload.email === 'string'
        ? payload.email.toLowerCase()
        : null,
    };
  } catch {
    throw new UnauthorizedException('Google sign-in could not be verified.');
  }
}
