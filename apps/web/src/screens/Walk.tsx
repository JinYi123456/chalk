import { useRef, useState } from 'react';
import type { QuoteInput } from '../api.ts';
import { STEPS } from '../App.tsx';

type SpeechRecognitionLike = {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  onresult: ((e: { resultIndex: number; results: { length: number; [i: number]: { 0: { transcript: string }; isFinal: boolean } } }) => void) | null;
  onend: (() => void) | null;
};

function speechEngine(): SpeechRecognitionLike | null {
  const w = window as unknown as { SpeechRecognition?: new () => SpeechRecognitionLike; webkitSpeechRecognition?: new () => SpeechRecognitionLike };
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition;
  if (!Ctor) return null;
  const rec = new Ctor();
  rec.continuous = true;
  rec.interimResults = false;
  rec.lang = 'en-US';
  return rec;
}

const JOB_TYPES = [
  ['', 'Let Chalk work it out'],
  ['standard_clean', 'Standard home clean'],
  ['deep_clean', 'Deep clean'],
  ['move_out_clean', 'Move-out / end-of-lease'],
  ['window_clean', 'Window clean'],
  ['carpet_clean', 'Carpet clean'],
  ['handyman_small', 'Small handyman job'],
  ['handyman_medium', 'Handyman day'],
  ['odd_jobs', 'Odd jobs run'],
  ['gutter_clear', 'Gutter clear'],
  ['pressure_wash', 'Pressure wash'],
] as const;

export function Walk({
  busy,
  step,
  onPrice,
  onCancel,
}: {
  busy: boolean;
  step: number;
  onPrice: (input: QuoteInput) => void;
  onCancel: () => void;
}) {
  const [photos, setPhotos] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const [client, setClient] = useState('');
  const [location, setLocation] = useState('');
  const [jobType, setJobType] = useState('');
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  /**
   * A phone photo is 3–8MB and the vision model does not need that: downscale
   * once here and every later step is faster and cheaper — the upload, the
   * vision call, and the copy stored with the quote that the client sees.
   */
  const shrink = async (file: File): Promise<string | null> => {
    const MAX_EDGE = 1200;
    try {
      if (typeof createImageBitmap !== 'function') return null;
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      bitmap.close();
      return canvas.toDataURL('image/jpeg', 0.72);
    } catch {
      return null;
    }
  };

  const readAsIs = (file: File): Promise<string | null> =>
    new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(file);
    });

  const addPhoto = async (files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files).slice(0, 4 - photos.length)) {
      const url = (await shrink(file)) ?? (await readAsIs(file));
      if (url?.startsWith('data:image')) setPhotos((p) => [...p, url].slice(0, 4));
    }
  };

  const toggleTalk = () => {
    if (listening) {
      recRef.current?.stop();
      setListening(false);
      return;
    }
    const rec = speechEngine();
    if (!rec) {
      setNotes((n) => n + (n ? ' ' : '') + '');
      alert('This browser has no speech recognition — type it instead, it works just as well.');
      return;
    }
    recRef.current = rec;
    rec.onresult = (e) => {
      let add = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) add += e.results[i][0].transcript;
      }
      if (add) setNotes((n) => (n ? `${n} ${add.trim()}` : add.trim()));
    };
    rec.onend = () => setListening(false);
    rec.start();
    setListening(true);
  };

  const ready = photos.length > 0 || notes.trim().length >= 3;

  return (
    <div>
      <h1>Walk the job.</h1>
      <p className="lead">
        Photograph what you see. Say what you'd do. Two moves, gloves on — Chalk handles the rest.
      </p>

      <h2>Photos</h2>
      <div className="shots">
        {photos.map((p, i) => (
          <div className="shot" key={i}>
            <img src={p} alt={`site ${i + 1}`} />
            <button
              className="x"
              aria-label="remove photo"
              onClick={() => setPhotos((ps) => ps.filter((_, idx) => idx !== i))}
            >
              ×
            </button>
          </div>
        ))}
        {photos.length < 4 && (
          <button className="shutter" onClick={() => fileRef.current?.click()}>
            <span>+</span>
            <span>photo</span>
          </button>
        )}
      </div>
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        capture="environment"
        multiple
        hidden
        onChange={(e) => void addPhoto(e.target.files)}
      />

      <div className="row2">
        <div className="field">
          <label htmlFor="client">Client</label>
          <input id="client" value={client} onChange={(e) => setClient(e.target.value)} placeholder="Sam" />
        </div>
        <div className="field">
          <label htmlFor="loc">Where</label>
          <input id="loc" value={location} onChange={(e) => setLocation(e.target.value)} placeholder="Suburb, city" />
        </div>
      </div>

      <div className="field">
        <label htmlFor="type">What kind of job</label>
        <select id="type" value={jobType} onChange={(e) => setJobType(e.target.value)}>
          {JOB_TYPES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </select>
      </div>

      <div className="field">
        <label htmlFor="notes">What you'd do — hold to talk, or type</label>
        <textarea
          id="notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="e.g. end of lease, 3 bed 2 bath, greasy kitchen, carpets need steam, third floor no lift"
        />
      </div>
      <button className={`btn ghost talk ${listening ? 'rec' : ''}`} onClick={toggleTalk} type="button">
        {listening ? '● Listening — tap to stop' : '🎙 Talk through the job'}
      </button>

      {busy ? (
        <ul className="steps">
          {STEPS.map((s, i) => (
            <li key={s} className={step > i ? 'done' : step === i ? 'on' : ''}>
              <span className="tick" />
              {s}
            </li>
          ))}
        </ul>
      ) : (
        <>
          <button className="btn primary" style={{ marginTop: 16 }} disabled={!ready} onClick={() => onPrice({ photos, notes, jobType, client, location })}>
            Price this job
          </button>
          <button className="btn ghost" style={{ marginTop: 10 }} onClick={onCancel}>
            Back
          </button>
          {!ready && <p className="small-note">Add one photo or a few words and the button wakes up.</p>}
        </>
      )}
    </div>
  );
}
