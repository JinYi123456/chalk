// Tests must never reach a real partner service, and must never depend on
// whatever happens to be in the developer's .env. Setting these to an empty
// string (not deleting them) defeats the config loader's "only fill if
// undefined" rule, so the suite runs fully offline and deterministically.
process.env.MONGODB_URI = '';
process.env.TIGER_URL = '';
process.env.TEMPORAL_ADDRESS = '';
process.env.SENTRY_DSN = '';
process.env.SERPLOCAL = '';
process.env.SERPAPI_KEY = '';
process.env.ELEVENLABS_API_KEY = '';
process.env.TABPFN_TOKEN = '';
process.env.TABPFN_URL = 'http://127.0.0.1:1';
process.env.TINKER_API_KEY = '';
process.env.TINKER_SAMPLER_PATH = '';
process.env.GOOGLE_API_KEY = '';
process.env.FEATHERLESS_API_KEY = '';
process.env.NEBIUS_API_KEY = '';
process.env.OPENROUTER_API_KEY = '';
process.env.CUSTOM_BASE_URL = '';
process.env.CUSTOM_MODEL = '';
