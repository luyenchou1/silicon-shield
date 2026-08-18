// Regenerates silicon-shield.html — the standalone single-file build that runs
// from file:// with three.js inlined (no CDN, no server). Run after any source
// change:  node build-standalone.mjs
// Requires: npm i -D esbuild, and the pinned three@0.185.1 files in lib/
// (build/three.module.min.js and examples/jsm/controls/OrbitControls.js).
import { build } from 'esbuild';
import { readFileSync, writeFileSync, rmSync } from 'fs';

await build({
  entryPoints: ['src/main.js'],
  bundle: true,
  minify: true,
  format: 'iife',
  alias: {
    'three': './lib/three.module.min.js',
    'three/addons/controls/OrbitControls.js': './lib/addons/controls/OrbitControls.js',
  },
  outfile: 'bundle.tmp.js',
});

const css = readFileSync('css/style.css', 'utf8');
const js = readFileSync('bundle.tmp.js', 'utf8');
rmSync('bundle.tmp.js');

// Take the DOM shell from index.html: everything inside <body> minus the module script.
const index = readFileSync('index.html', 'utf8');
const body = index.match(/<body>([\s\S]*?)<script type="module"/)[1];

const out = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Silicon Shield</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'><text y='.9em' font-size='90'>🛡️</text></svg>">
<style>
${css}
</style>
</head>
<body>${body}<script>
${js}
</script>
</body>
</html>
`;
writeFileSync('silicon-shield.html', out);
console.log(`silicon-shield.html regenerated (${(out.length / 1024).toFixed(0)} KB)`);
