import { BadRequestException } from '@nestjs/common';
import type { GeneratedAnalysisDraft } from '../analysis/analysis.contracts.js';
export interface ChatRequest { question: string; history: { role: 'user' | 'assistant'; content: string }[] }
export interface ChatEvidence { key: string; tool: string; input: Record<string, unknown>; result: unknown }
export interface ChatAnswer {
  status: 'answered' | 'fallback' | 'refused';
  guidance: GeneratedAnalysisDraft;
  generator: 'external_model' | 'deterministic_fallback';
  model: string | null;
  evidence: ChatEvidence[];
  auditId: string;
}
export function parseChatRequest(raw: unknown): ChatRequest {
  const bad = (): never => { throw new BadRequestException({ code: 'INVALID_CHAT_REQUEST', message: 'Use a question of 1–2000 characters and at most six prior messages of 1–6000 characters.' }); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad();
  const r = raw as Record<string, unknown>;
  if (Object.keys(r).some(k => !['question', 'history'].includes(k)) || typeof r.question !== 'string' || !r.question.trim() || r.question.length > 2000) return bad();
  const history = r.history ?? [];
  if (!Array.isArray(history) || history.length > 6) return bad();
  for (const m of history) {
    if (!m || typeof m !== 'object' || Array.isArray(m) || Object.keys(m).some(k => !['role', 'content'].includes(k)) ||
        !['user', 'assistant'].includes(m.role) || typeof m.content !== 'string' || !m.content.trim() || m.content.length > 6000) return bad();
  }
  return { question: r.question.trim(), history: history.map(m => ({ role: m.role, content: m.content })) };
}
