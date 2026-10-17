import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { MastraLanguageModel } from '@mastra/core/agent';
import { llmEndpoint, llmEndpoints, type LlmEndpoint } from '../config.js';
import { fetchWithTimeout, stripThinking } from './util.js';

export type ChatMessage = { role: 'system' | 'user' | 'assistant'; content: string };
export type ChatOpts = { temperature?: number; maxTokens?: number | null; timeoutMs?: number };

export function providerConfigured(): boolean {
  const p = llmEndpoint();
  if (p.name === 'ollama') return true; // assumed reachable; callers degrade if not
  return llmEndpoints().length > 0;
}

function authHeaders(p: LlmEndpoint): Record<string, string> {
  return {
    'content-type': 'application/json',
    ...(p.apiKey ? { authorization: `Bearer ${p.apiKey}` } : {}),
  };
}

/**
 * One chat call to one endpoint. Thinking models (Gemma 4 on AI Studio) narrate
 * inside <thought> first, so the reply is stripped before it is returned — and
 * the token budget is raised to leave room for both the reasoning and the answer.
 */
async function chatOnce(p: LlmEndpoint, messages: ChatMessage[], opts: ChatOpts): Promise<string | null> {
  // Gemma 4 on AI Studio is a thinking model that cannot disable reasoning; its
  // <thought> block is billed from the same budget, so give it real headroom or
  // the answer never arrives. Other endpoints keep a tighter cap.
  const floor = p.name === 'google' ? 3200 : 900;
  const maxTokens = opts.maxTokens === null ? undefined : Math.max(opts.maxTokens ?? 700, floor);
  try {
    const res = await fetchWithTimeout(
      `${p.baseURL.replace(/\/$/, '')}/chat/completions`,
      {
        method: 'POST',
        headers: authHeaders(p),
        body: JSON.stringify({
          model: p.model,
          messages,
          temperature: opts.temperature ?? 0.5,
          ...(maxTokens === undefined ? {} : { max_tokens: maxTokens }),
          ...(p.suppressThinking ? { reasoning_effort: 'none' } : {}),
        }),
      },
      opts.timeoutMs ?? 120_000
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const raw = data.choices?.[0]?.message?.content ?? '';
    const text = stripThinking(raw).trim();
    return text.length > 0 ? text : null;
  } catch {
    return null;
  }
}

/** The endpoint that last answered, so status can name it honestly. */
let _winner: LlmEndpoint | null = null;

export function resolvedEndpoint(): LlmEndpoint {
  return _winner ?? llmEndpoint();
}

export async function chatText(messages: ChatMessage[], opts: ChatOpts = {}): Promise<string | null> {
  // Try the last endpoint that worked first — it is the cheapest guess.
  const chain = llmEndpoints();
  const ordered = _winner ? [_winner, ...chain.filter((p) => p !== _winner)] : chain;
  for (const p of ordered) {
    const out = await chatOnce(p, messages, opts);
    if (out) {
      _winner = p;
      return out;
    }
  }
  return null;
}

/** Raw one-shot chat for the diagnostics route — status, finish reason, usage, content. */
export async function chatOnceDebug(messages: ChatMessage[], opts: ChatOpts = {}): Promise<Record<string, unknown>> {
  const attempts: Record<string, unknown>[] = [];
  for (const p of llmEndpoints()) {
    let status = 0;
    let body = '';
    try {
      const res = await fetchWithTimeout(
        `${p.baseURL.replace(/\/$/, '')}/chat/completions`,
        {
          method: 'POST',
          headers: authHeaders(p),
          body: JSON.stringify({
            model: p.model,
            messages,
            temperature: opts.temperature ?? 0,
            max_tokens: opts.maxTokens ?? 32,
            ...(p.suppressThinking ? { reasoning_effort: 'none' } : {}),
          }),
        },
        opts.timeoutMs ?? 60_000
      );
      status = res.status;
      body = await res.text();
    } catch (e) {
      attempts.push({ provider: p.name, model: p.model, error: e instanceof Error ? e.message : 'unreachable' });
      continue;
    }
    let parsed: { choices?: { finish_reason?: string; message?: { content?: string } }[]; usage?: unknown } | null = null;
    try {
      parsed = JSON.parse(body);
    } catch {
      /* keep raw */
    }
    const attempt = {
      provider: p.name,
      model: p.model,
      status,
      finish: parsed?.choices?.[0]?.finish_reason,
      usage: parsed?.usage,
      content: stripThinking(parsed?.choices?.[0]?.message?.content ?? body.slice(0, 600)).slice(0, 600),
    };
    attempts.push(attempt);
    if (status === 200 && attempt.content) return { ok: true, ...attempt, attempts };
  }
  return { ok: false, attempts };
}

/**
 * The Mastra-facing model. We hand Mastra an AI-SDK provider over the primary
 * endpoint; for Ollama we splice `reasoning_effort:"none"` into every request
 * so thinking models answer directly.
 */
export function buildMastraModel(): MastraLanguageModel {
  const p = llmEndpoint();
  const provider = createOpenAICompatible({
    name: p.name,
    baseURL: p.baseURL,
    apiKey: p.apiKey,
    ...(p.suppressThinking
      ? { transformRequestBody: (body: Record<string, unknown>) => ({ ...body, reasoning_effort: 'none' }) }
      : {}),
  });
  return provider.chatModel(p.model) as unknown as MastraLanguageModel;
}

export function providerReady(): boolean {
  return providerConfigured();
}

export function resolvedTextModel(): string {
  return resolvedEndpoint().model;
}

export function providerLabel(): string {
  const p = resolvedEndpoint();
  return `${p.name}/${p.model}`;
}

export function registerWinner(p: LlmEndpoint): void {
  _winner = p;
}
