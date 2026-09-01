// Writes public/version.json from src/version.js so the two can never disagree.
// Runs as `prebuild`, i.e. automatically on every `npm run build`.
import { readFileSync, writeFileSync } from 'node:fs';

const src = readFileSync(new URL('../src/version.js', import.meta.url), 'utf8');
const m = src.match(/APP_VERSION\s*=\s*'([^']+)'/);
if (!m) { console.error('sync-version: no APP_VERSION in src/version.js'); process.exit(1); }

// Emit both `version` (read by the fixed banner) and `build` (read by older
// bundles that shipped before the version field was added).  Both fields carry
// the same value so any live client can detect a deploy regardless of which
// field its copy of UpdateBanner reads.
writeFileSync(new URL('../public/version.json', import.meta.url),
  JSON.stringify({ version: m[1], build: m[1] }) + '\n');
console.log(`sync-version: public/version.json -> ${m[1]}`);
