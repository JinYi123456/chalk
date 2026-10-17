import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { config } from '../config.js';

export function ttsEnabled(): boolean {
  return Boolean(config.elevenLabsKey);
}

function cacheName(text: string): string {
  return `${createHash('sha1').update(`${config.elevenLabsVoice}:${text}`).digest('hex')}.mp3`;
}

/** Ask ElevenLabs for the audio. Null whenever voice is off or the API declines. */
export async function synthesize(text: string): Promise<Buffer | null> {
  if (!ttsEnabled() || !text.trim()) return null;
  try {
    const res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${config.elevenLabsVoice}?output_format=mp3_44100_128`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'xi-api-key': config.elevenLabsKey },
        body: JSON.stringify({
          text: text.slice(0, 2500),
          model_id: 'eleven_multilingual_v2',
          voice_settings: { stability: 0.45, similarity_boost: 0.75 },
        }),
        signal: AbortSignal.timeout(45_000),
      }
    );
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > 512 ? buf : null;
  } catch {
    return null;
  }
}

/** Generate (or reuse) audio, then return its served URL. */
export async function ensureAudio(text: string): Promise<string | null> {
  if (!ttsEnabled() || !text.trim()) return null;
  const name = cacheName(text);
  const path = resolve(config.audioCacheDir, name);
  if (existsSync(path)) return `/audio/${name}`;
  const buf = await synthesize(text);
  if (!buf) return null;
  try {
    await mkdir(config.audioCacheDir, { recursive: true });
    await writeFile(path, buf);
  } catch {
    /* read-only filesystem (serverless) — the data URL below still works */
  }
  return `/audio/${name}`;
}

/** Stateless audio for serverless hosts: a data URL the browser can play directly. */
export async function readAloudDataUrl(text: string): Promise<string | null> {
  if (!ttsEnabled() || !text.trim()) return null;
  const name = cacheName(text);
  const path = resolve(config.audioCacheDir, name);
  if (existsSync(path)) {
    try {
      return `data:audio/mpeg;base64,${(await readFile(path)).toString('base64')}`;
    } catch {
      /* fall through to a fresh synthesis */
    }
  }
  const buf = await synthesize(text);
  if (!buf) return null;
  try {
    await mkdir(config.audioCacheDir, { recursive: true });
    await writeFile(path, buf);
  } catch {
    /* ignore */
  }
  return `data:audio/mpeg;base64,${buf.toString('base64')}`;
}

export async function audioFile(name: string): Promise<Buffer | null> {
  // Only serve names we generated — no path traversal.
  if (!/^[a-f0-9]{40}\.mp3$/.test(name)) return null;
  try {
    return await readFile(resolve(config.audioCacheDir, name));
  } catch {
    return null;
  }
}
