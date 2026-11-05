import { All, Body, Controller, Req, Res } from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.models.js';
import { PublicRoute } from '../auth/public.decorator.js';
import { McpHttpService } from './mcp-http.service.js';

@Controller('mcp')
export class McpHttpController {
  constructor(private readonly mcp: McpHttpService) {}
  @All()
  @PublicRoute() // Authenticated separately with MCP-only tokens, never browser/mobile credentials.
  async handle(@Req() request: AuthenticatedRequest, @Body() body: unknown,
    @Res() response: { status(code: number): void; setHeader(name: string, value: string): void; end(body: Buffer): void }) {
    const result = await this.mcp.handle(request.method, request.headers, body);
    response.status(result.status);
    result.headers.forEach((value, name) => response.setHeader(name, value));
    response.end(Buffer.from(await result.arrayBuffer()));
  }
}
