import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/* Load .env from the repo root without a dependency. Real environments
   (Vercel, CI) inject plain env vars, so anything already set wins. */
function loadDotEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = resolve(dir, '.env');
    if (existsSync(candidate)) {
      for (const line of readFileSync(candidate, 'utf8').split('\n')) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && process.env[m[1]] === undefined) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
        }
      }
      return;
    }
    dir = resolve(dir, '..');
  }
}
loadDotEnv();

export type ProviderName = 'ollama' | 'google' | 'featherless' | 'nebius' | 'openrouter' | 'custom';

export const config = {
  port: Number(process.env.PORT || 8787),
  // serve the built web app from this process — only when explicitly asked
  // (local demo). On Vercel the platform serves the static build.
  serveWeb: process.env.SERVE_WEB === '1',
  provider: (process.env.CHALK_PROVIDER || 'ollama') as ProviderName,
  model: process.env.CHALK_MODEL || 'gemma4:e2b',
  visionModel: process.env.CHALK_VISION_MODEL || process.env.CHALK_MODEL || 'gemma4:e2b',
  visionFallbackModel: process.env.CHALK_VISION_FALLBACK || 'gemma3:4b',
  ollamaBaseUrl: (process.env.OLLAMA_BASE_URL || 'http://127.0.0.1:11434').replace(/\/v1\/?$/, ''),

  googleApiKey: process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || '',
  googleModel: process.env.GOOGLE_MODEL || 'gemma-4-31b-it',

  featherlessApiKey: process.env.FEATHERLESS_API_KEY || '',
  featherlessModel: process.env.FEATHERLESS_MODEL || 'Qwen/Qwen3-VL-30B-A3B-Instruct',

  nebiusApiKey: process.env.NEBIUS_API_KEY || '',
  nebiusModel: process.env.NEBIUS_MODEL || 'Qwen/Qwen3-30B-A3B-Instruct-2507',

  openrouterApiKey: process.env.OPENROUTER_API_KEY || '',
  openrouterModel: process.env.OPENROUTER_MODEL || 'google/gemma-4-31b-it:free',

  customBaseUrl: process.env.CUSTOM_BASE_URL || '',
  customModel: process.env.CUSTOM_MODEL || '',
  customApiKey: process.env.CUSTOM_API_KEY || '',

  tabpfnUrl: process.env.TABPFN_URL || 'http://127.0.0.1:8790',
  tabpfnToken: process.env.TABPFN_TOKEN || '',

  temporalAddress: (process.env.TEMPORAL_ADDRESS || '').replace(/^https?:\/\//, ''),
  temporalNamespace: process.env.TEMPORAL_NAMESPACE || 'default',
  temporalTaskQueue: process.env.TEMPORAL_TASK_QUEUE || 'chalk-followups',
  // Where follow-up workflows can reach this deployment. Vercel exposes the
  // production domain only after the first deploy, so PUBLIC_BASE_URL wins.
  publicBaseUrl: (
    process.env.PUBLIC_BASE_URL ||
    (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : '') ||
    ''
  ).replace(/\/$/, ''),

  tinkerApiKey: process.env.TINKER_API_KEY || '',
  tinkerSamplerPath: process.env.TINKER_SAMPLER_PATH || '',
  tinkerBaseUrl: (process.env.TINKER_BASE_URL || 'https://tinker.thinkingmachines.dev/services/tinker-prod/oai/api/v1').replace(/\/$/, ''),

  elevenLabsKey: process.env.ELEVENLABS_API_KEY || '',
  elevenLabsVoice: process.env.ELEVENLABS_VOICE_ID || 'SAz9YHcvj6GT2YYXdXww',
  serpApiKey: process.env.SERPAPI_KEY || '',
  mongoUri: process.env.MONGODB_URI || '',
  mongoDb: process.env.MONGODB_DB || 'chalk',
  tigerUrl: process.env.TIGER_URL || '',
  sentryDsn: process.env.SENTRY_DSN || '',
  // Serverless filesystems are read-only apart from the temp dir, so voice
  // caching moves there and the app keeps working when it cannot write at all.
  audioCacheDir:
    process.env.CHALK_AUDIO_CACHE ||
    (process.env.VERCEL ? resolve(tmpdir(), 'chalk-audio') : resolve(dirname(fileURLToPath(import.meta.url)), '..', 'audio-cache')),
};

export type LlmEndpoint = {
  /** OpenAI-compatible base URL, e.g. http://127.0.0.1:11434/v1 */
  baseURL: string;
  apiKey: string;
  model: string;
  name: string;
  /** Ollama thinking models need reasoning_effort:"none" to answer directly */
  suppressThinking: boolean;
  /** whether this endpoint can carry images */
  vision: boolean;
  /** the id to use for image calls when it differs from the text model */
  visionModel?: string;
};

function endpointFor(name: ProviderName): LlmEndpoint {
  switch (name) {
    case 'google':
      return {
        baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
        apiKey: config.googleApiKey,
        model: config.googleModel,
        name: 'google',
        suppressThinking: false,
        // Gemma 4 on AI Studio is text-only, so a photo skips straight to the
        // next endpoint on the chain instead of burning a failing call here.
        vision: false,
      };
    case 'featherless':
      return {
        baseURL: 'https://api.featherless.ai/v1',
        apiKey: config.featherlessApiKey,
        model: config.featherlessModel,
        name: 'featherless',
        suppressThinking: false,
        vision: true,
        visionModel: process.env.FEATHERLESS_VISION_MODEL || 'Qwen/Qwen3-VL-30B-A3B-Instruct',
      };
    case 'nebius':
      return {
        baseURL: 'https://api.studio.nebius.com/v1',
        apiKey: config.nebiusApiKey,
        model: config.nebiusModel,
        name: 'nebius',
        suppressThinking: false,
        vision: true,
        // Nebius' text model is text-only; its open-weight vision model is Gemma 3.
        visionModel: process.env.NEBIUS_VISION_MODEL || 'google/gemma-3-27b-it',
      };
    case 'openrouter':
      return {
        baseURL: 'https://openrouter.ai/api/v1',
        apiKey: config.openrouterApiKey,
        model: config.openrouterModel,
        name: 'openrouter',
        suppressThinking: false,
        vision: true,
      };
    case 'custom':
      return {
        baseURL: config.customBaseUrl,
        apiKey: config.customApiKey || 'none',
        model: config.customModel,
        name: 'custom',
        suppressThinking: false,
        vision: true,
      };
    default:
      return {
        baseURL: `${config.ollamaBaseUrl}/v1`,
        apiKey: 'ollama',
        model: config.model,
        name: 'ollama',
        suppressThinking: true,
        vision: true,
      };
  }
}

/** The primary endpoint, chosen by CHALK_PROVIDER. */
export function llmEndpoint(): LlmEndpoint {
  return endpointFor(config.provider);
}

/**
 * Every configured endpoint, primary first. A hosted catalog can be flaky or
 * rate-limited; rather than fail a quote, the caller walks this chain. Each
 * layer reports which endpoint actually answered.
 */
export function llmEndpoints(): LlmEndpoint[] {
  const order: ProviderName[] = [config.provider, 'google', 'featherless', 'nebius', 'openrouter', 'custom', 'ollama'];
  const seen = new Set<string>();
  const out: LlmEndpoint[] = [];
  for (const name of order) {
    if (seen.has(name)) continue;
    seen.add(name);
    const p = endpointFor(name);
    const usable =
      name === 'ollama' ||
      name === 'custom'
        ? name === 'ollama' || Boolean(config.customBaseUrl && config.customModel)
        : name === 'google'
          ? Boolean(config.googleApiKey)
          : name === 'featherless'
            ? Boolean(config.featherlessApiKey)
            : name === 'nebius'
              ? Boolean(config.nebiusApiKey)
              : Boolean(config.openrouterApiKey);
    if (usable) out.push(p);
  }
  return out;
}

/** `modelOverride` lets callers report the model that actually answered, not just the configured one. */
export function engineLabel(modelOverride?: string): string {
  const p = llmEndpoint();
  const where = config.provider === 'ollama' ? 'on-device' : 'hosted';
  return `${modelOverride || p.model} · ${p.name} (${where}, open weights)`;
}
