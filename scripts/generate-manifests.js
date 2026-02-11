/**
 * generate-manifests.js
 * 
 * Pre-build script that scans /public/ asset folders and writes
 * a JSON manifest so the client can list files without an API route.
 * 
 * Run: node scripts/generate-manifests.js
 * Automatically invoked by `npm run build` via the "prebuild" script.
 */
const fs = require('fs');
const path = require('path');

const publicDir = path.join(__dirname, '..', 'public');
const manifestDir = path.join(publicDir, 'manifest');

// Ensure manifest dir
fs.mkdirSync(manifestDir, { recursive: true });

// ── Scan helpers ─────────────────────────────────────────────────

function listFiles(dir, extensions) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => {
    const lower = f.toLowerCase();
    return extensions.some(ext => lower.endsWith(ext));
  }).sort();
}

// ── Collect assets ───────────────────────────────────────────────

const imageExts = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.hdr', '.exr'];

const vrmFiles = listFiles(path.join(publicDir, 'vrm'), ['.vrm']);
const hdriFiles = listFiles(path.join(publicDir, 'hdri'), imageExts);
const bg2dFiles = listFiles(path.join(publicDir, '2D'), imageExts);
const motionFiles = listFiles(path.join(publicDir, 'motions'), ['.fbx', '.vrma']);

// ── Write manifest ──────────────────────────────────────────────

const manifest = {
  version: 1,
  generated: new Date().toISOString(),
  files: {
    vrm: vrmFiles,
    backgrounds: {
      hdri: hdriFiles,
      '2D': bg2dFiles,
    },
    motions: motionFiles,
  },
};

const outPath = path.join(manifestDir, 'files.json');
fs.writeFileSync(outPath, JSON.stringify(manifest, null, 2));

console.log('✅ Manifest generated →', outPath);
console.log(`   VRM: ${vrmFiles.length}, HDRI: ${hdriFiles.length}, 2D: ${bg2dFiles.length}, Motions: ${motionFiles.length}`);
