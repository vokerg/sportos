import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { AuthenticatedAccount, AuthenticatedRequest } from './auth.models.js';

export const CurrentAccount = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedAccount => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.account) throw new TypeError('Authenticated account is missing from the request.');
    return request.account;
  },
);
