import * as esbuild from 'esbuild';

// Plugin to filter out specific warnings
// Plugin to filter out specific warnings
const filterWarningsPlugin = {
  name: 'filter-warnings',
  setup(build) {
    build.onStart(() => {
      // Filter out the sideEffects warning for googleapis
      const originalWarn = console.warn;
      console.warn = (message, ...args) => {
        if (typeof message === 'string' && message.includes('The value for "sideEffects" must be a boolean or an array')) {
          return; // Skip this warning
        }
        originalWarn(message, ...args);
      };
      
      // Restore original console.warn after build starts
      build.onEnd(() => {
        console.warn = originalWarn;
      });
    });
  },
};

await esbuild.build({
  entryPoints: ['src/index.js'],
  bundle: true,
  platform: 'node',
  target: 'node18',
  outfile: 'dist/index.js',
  format: 'esm',
  banner: {
    js: '#!/usr/bin/env node',
  },
  external: [
    '@napi-rs/canvas',
    'canvas',
    'node-telegram-bot-api',
    '@solana/web3.js',
    'mongodb',
    'googleapis'
  ],
  plugins: [filterWarningsPlugin]
});