import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve } from 'path';

// A unique id per build. Vercel exposes the commit SHA at build time; the
// timestamp fallback covers local builds and any host that doesn't set it.
// This is what makes the "new version deployed, reload" check work: the id
// is baked into the JS bundle AND written to version.json, so a browser
// still running an older bundle sees its baked-in id disagree with the
// freshly-served version.json and reloads itself.
const BUILD_ID = process.env.VERCEL_GIT_COMMIT_SHA
  ? process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 8)
  : `local-${Date.now()}`;

// Writes version.json into the built output. Runs at closeBundle so it lands
// after Vite copies public/ over, overwriting the placeholder there.
function writeVersionFile() {
  return {
    name: 'jovelin-write-version',
    closeBundle() {
      const outDir = resolve(process.cwd(), 'dist');
      mkdirSync(outDir, { recursive: true });
      writeFileSync(resolve(outDir, 'version.json'), JSON.stringify({ version: BUILD_ID }));
    },
  };
}

export default defineConfig({
  plugins: [react(), writeVersionFile()],
  define: {
    __BUILD_ID__: JSON.stringify(BUILD_ID),
  },
  server: {
    host: true,
    port: 5173
  }
});
