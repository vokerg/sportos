import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { mcpOperation } from './mcp-operation.js';
describe('MCP failure privacy', () => {
  it('replaces private database/SDK errors but retains safe protocol errors', async () => {
    const privateMessage = 'fixture-private-token-and-sql-parameters';
    try { await mcpOperation(async () => { throw new Error(privateMessage); }); }
    catch (error) {
      expect(JSON.stringify(error)).not.toContain(privateMessage);
      expect(error).toMatchObject({ status: 503 });
    }
    const protocol = new BadRequestException({ error: 'invalid_grant' });
    await expect(mcpOperation(async () => { throw protocol; })).rejects.toBe(protocol);
  });
});
