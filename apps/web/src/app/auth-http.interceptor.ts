import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const SPORTOS_API_ORIGIN = 'http://localhost:3000';

export const authHttpInterceptor: HttpInterceptorFn = (request, next) => {
  if (!isSportosApiRequest(request.url)) return next(request);

  const csrf = readCookie('sportos_csrf');
  const authenticatedRequest = request.clone({
    withCredentials: true,
    setHeaders: !SAFE_METHODS.has(request.method.toUpperCase()) && csrf
      ? { 'X-SportOS-CSRF': csrf }
      : {},
  });

  return next(authenticatedRequest).pipe(catchError((error: unknown) => {
    if (error instanceof HttpErrorResponse && error.status === 401) {
      window.dispatchEvent(new Event('sportos-auth-expired'));
    }
    return throwError(() => error);
  }));
};

export function isSportosApiRequest(
  requestUrl: string,
  browserOrigin = window.location.origin,
  apiOrigin = SPORTOS_API_ORIGIN,
): boolean {
  try {
    return new URL(requestUrl, browserOrigin).origin === new URL(apiOrigin).origin;
  } catch {
    return false;
  }
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(';')) {
    const separator = part.indexOf('=');
    if (separator <= 0 || part.slice(0, separator).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(separator + 1).trim());
    } catch {
      return part.slice(separator + 1).trim();
    }
  }
  return null;
}
