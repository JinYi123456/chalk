import { config } from '../config.js';

/* Chalk's quote voice, served by a Tinker LoRA. The prompt contract here must
   match services/tinker/train_voice.py exactly — the fine-tune only learned
   this shape. A general model writes generic quotes; this one learned how
   *this* pro talks to clients. */

export const TINKER_SYSTEM =
  "You write ONE client message for a solo home-service pro's quote. Voice: warm, plain, " +
  'confident, first person. No corporate filler, no "don\'t hesitate", no emojis. 60-120 words. ' +
  'Say what you will do, the total, what you assumed, and the validity window.';

export const USER_PREFIX = 'WRITE THE QUOTE MESSAGE';

export type QuoteVoiceContext = {
  client: string;
  headline: string;
  jobType: string;
  totalHours: number;
  lines: { label: string; total: number }[];
  total: number;
  acceptedPhrases?: string[];
};

export function tinkerEnabled(): boolean {
  return Boolean(config.tinkerApiKey && config.tinkerSamplerPath);
}

export function quoteVoicePrompt(context: QuoteVoiceContext): string {
  return `${USER_PREFIX}\n${JSON.stringify(context)}`;
}

export function parseVoiceResponse(data: unknown): string | null {
  const text = (data as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content;
  if (typeof text !== 'string') return null;
  const clean = text.trim().replace(/^["']|["']$/g, '');
  if (clean.length < 40 || clean.length > 1800) return null;
  return clean;
}

/** Null whenever Tinker isn't configured or can't answer — the caller keeps its own draft. */
export async function voiceFromTinker(context: QuoteVoiceContext): Promise<string | null> {
  if (!tinkerEnabled()) return null;
  try {
    const res = await fetch(`${config.tinkerBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${config.tinkerApiKey}`,
      },
      body: JSON.stringify({
        model: config.tinkerSamplerPath,
        messages: [
          { role: 'system', content: TINKER_SYSTEM },
          // Qwen3's own control token. `chat_template_kwargs` alone did not
          // hold: measured on the sampler, the answer came back in
          // `reasoning_content` with `content` empty, and parseVoiceResponse
          // (correctly) refused it. /no_think costs 2 reasoning tokens instead
          // of 2015 and returns the message.
          { role: 'user', content: `${quoteVoicePrompt(context)} /no_think` },
        ],
        max_tokens: 400,
        temperature: 0.8,
        // Qwen3 answers inside a reasoning block and leaves `content` empty
        // unless thinking is turned off — the sampler trained on it still
        // inherits the template. Measured: 180 tokens of budget, 0 of them
        // an answer.
        chat_template_kwargs: { enable_thinking: false },
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) return null;
    return parseVoiceResponse(await res.json());
  } catch {
    return null;
  }
}
