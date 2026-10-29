/** Server-only, bounded OpenAI-compatible transport. Never log prompts or bodies. */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}
export interface ChatModelConfig { endpoint: URL; model: string; key: string; timeoutMs: number }
export function chatModelConfig(): ChatModelConfig | null {
  const value = process.env.SPORTOS_AI_CHAT_ENDPOINT?.trim();
  if (!value) return null;
  const endpoint = new URL(value);
  if (endpoint.username || endpoint.password || endpoint.search || endpoint.hash ||
      (endpoint.protocol !== 'https:' && !(endpoint.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(endpoint.hostname)))) {
    throw Error('SPORTOS_AI_CHAT_ENDPOINT requires HTTPS (HTTP allowed on localhost only).');
  }
  const model = process.env.SPORTOS_AI_MODEL?.trim() ?? '';
  const key = process.env.SPORTOS_AI_API_KEY?.trim() ?? '';
  const timeoutMs = Number(process.env.SPORTOS_AI_TIMEOUT_MS ?? 45000);
  if (!model || model.length > 200 || !key || !Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60000) {
    throw Error('Chat requires a model, server API key, and timeout from 1000 through 60000.');
  }
  return { endpoint, model, key, timeoutMs };
}
export async function boundedJson(response: Response, maxBytes = 262144): Promise<unknown> {
  if (!response.ok || !response.body) throw Error('Model unavailable.');
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) throw Error('Model output limit.');
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel();
    reader.releaseLock();
  }
}
export async function complete(config: ChatModelConfig, messages: ChatMessage[], tools: unknown[], signal: AbortSignal): Promise<ChatMessage> {
  const result = await boundedJson(await fetch(config.endpoint, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${config.key}` },
    body: JSON.stringify({
      model: config.model, messages, max_tokens: 2500,
      ...(config.endpoint.hostname === 'api.deepseek.com' ? { thinking: { type: 'disabled' } } : {}),
      ...(tools.length ? { tools, tool_choice: 'auto' } : { response_format: { type: 'json_object' } }),
    }),
  }));
  const choice = (result as { choices?: { finish_reason?: string; message?: ChatMessage }[] })?.choices?.[0];
  if (!choice?.message || !['stop', 'tool_calls'].includes(choice.finish_reason ?? '')) throw Error('Incomplete model output.');
  const m = choice.message;
  if (m.role !== 'assistant' || (m.content !== null && typeof m.content !== 'string')) throw Error('Invalid model message.');
  if (m.tool_calls && (!Array.isArray(m.tool_calls) || m.tool_calls.length > 4 || m.tool_calls.some(c =>
    !c || c.type !== 'function' || typeof c.id !== 'string' || c.id.length > 200 ||
    typeof c.function?.name !== 'string' || typeof c.function.arguments !== 'string' || c.function.arguments.length > 8000))) throw Error('Invalid tool calls.');
  return { role: 'assistant', content: m.content, ...(m.tool_calls ? { tool_calls: m.tool_calls } : {}) };
}
