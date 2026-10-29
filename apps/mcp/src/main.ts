import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createRuntime } from './runtime.js';
import { createServer } from './server.js';
try {
  const runtime = await createRuntime();
  const handle = serveStdio(() => createServer(runtime.service));
  const close = async () => {
    await handle.close();
    await runtime.close();
  };
  process.once('SIGINT', () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
  process.once('SIGTERM', () => {
    void close().catch(() => {
      process.exitCode = 1;
    });
  });
  process.stdin.once('end', () => {
    void runtime.close().catch(() => {
      process.exitCode = 1;
    });
  });
} catch {
  console.error(
    'Sportos MCP startup failed. Check trusted local account binding and non-owner runtime configuration.',
  );
  process.exitCode = 1;
}
