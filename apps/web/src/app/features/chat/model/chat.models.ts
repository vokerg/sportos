export interface ChatItem { text: string; citationKeys: string[] }
export interface ChatAnswer {
  status: 'answered' | 'fallback' | 'refused';
  guidance: { observations: ChatItem[]; uncertainty: ChatItem[]; suggestions: ChatItem[] };
  generator: 'external_model' | 'deterministic_fallback';
  model: string | null;
  evidence: { key: string; tool: string; input: Record<string, unknown>; result: unknown }[];
  auditId: string;
}
export interface ChatTurn { question: string; answer: ChatAnswer }
export interface ChatRequest { question: string; history: { role: 'user' | 'assistant'; content: string }[] }
