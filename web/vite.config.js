import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'path';
import fs from 'fs';
import { execSync } from 'child_process';

export default defineConfig({
  plugins: [vue()],
  define: {
    __APP_VERSION__: JSON.stringify(getAppVersion()),
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
    __GIT_COMMIT__: JSON.stringify(getGitCommit())
  },
  build: {
    outDir: path.resolve(__dirname, '../public'),
    emptyOutDir: true
  },
  server: {
    port: 5173
  }
});

function getAppVersion() {
  try {
    const pkgPath = path.resolve(__dirname, 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch (error) {
    return '0.0.0';
  }
}

function getGitCommit() {
  try {
    const repoRoot = path.resolve(__dirname, '..', '..');
    const hash = execSync('git rev-parse --short HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
    return hash || 'nogit';
  } catch (error) {
    return 'nogit';
  }
}
