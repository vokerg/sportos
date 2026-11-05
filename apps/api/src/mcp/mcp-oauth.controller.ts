import { Body, Controller, Get, HttpCode, Post, Query, Req, Res } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.models.js';
import { PublicRoute } from '../auth/public.decorator.js';
import { McpOAuthService } from './mcp-oauth.service.js';

@Controller()
export class McpOAuthController {
  constructor(private readonly oauth: McpOAuthService) {}
  @Get(['.well-known/oauth-protected-resource', '.well-known/oauth-protected-resource/mcp'])
  @PublicRoute()
  resourceMetadata() { return this.oauth.resourceMetadata(); }
  @Get('.well-known/oauth-authorization-server')
  @PublicRoute()
  authorizationMetadata() { return this.oauth.authorizationMetadata(); }
  @Get('mcp/oauth/authorize')
  @PublicRoute()
  async authorize(@Query() query: unknown, @Res() response: { redirect(status: number, url: string): void }) {
    response.redirect(302, await this.oauth.authorize(query));
  }
  @Post('mcp/oauth/token')
  @HttpCode(200)
  @PublicRoute()
  token(@Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.oauth.token(body, request.headers); }
  @Post('mcp/oauth/revoke')
  @HttpCode(200)
  @PublicRoute()
  revoke(@Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.oauth.revoke(body, request.headers); }
  @Post('mcp/oauth/approve')
  @HttpCode(200)
  approve(@Body() body: unknown, @Req() request: AuthenticatedRequest) { return this.oauth.approve(body, request); }
  @Post('mcp/oauth/disconnect')
  @HttpCode(200)
  disconnect(@Req() request: AuthenticatedRequest) { return this.oauth.revokeAccount(request); }
}
