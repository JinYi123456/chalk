/**
 * The client's face of a quote.
 *
 * The link a pro texts a stranger is public, so "the client never sees my
 * odds" cannot be a rendering convention — anyone holding the URL could read
 * the win probability, the usual price and the hourly rate out of the pro's
 * own endpoint. This is the allow-list the server answers with: everything
 * not named here never leaves the process.
 */
const CLIENT_FIELDS = [
  'id',
  'client',
  'headline',
  'jobType',
  'currency',
  'photos',
  'photoCaptions',
  'clientMessage',
  'assumptions',
  'validDays',
  'total',
  'createdAt',
  'outcome',
  'audioUrl',
] as const;

/** Line items the client is shown: the label, the sentence the pro wrote for
 *  it, the cost, and the photograph that justifies it. The structured inputs
 *  the price was computed from — qty, unit, hours, complexity — do not travel. */
const CLIENT_LINE_FIELDS = ['label', 'detail', 'total', 'photo'] as const;

const pick = (src: Record<string, any>, keys: readonly string[]) => {
  const out: Record<string, any> = {};
  for (const key of keys) if (src[key] !== undefined) out[key] = src[key];
  return out;
};

export function clientQuoteView(quote: Record<string, any>): Record<string, any> {
  const lines = Array.isArray(quote.lines) ? quote.lines : [];
  return { ...pick(quote, CLIENT_FIELDS), lines: lines.map((l: any) => pick(l ?? {}, CLIENT_LINE_FIELDS)) };
}
