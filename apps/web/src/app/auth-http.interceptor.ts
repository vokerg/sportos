import { HttpErrorResponse, type HttpInterceptorFn } from '@angular/common/http';
import { catchError, throwError } from 'rxjs';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export const authHttpInterceptor: HttpInterceptorFn = (request, next) => {
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
