// Minimal clean script to avoid external deps
const fs = require('fs');
const path = require('path');
const target = path.resolve(__dirname, '..', 'dist');
try {
  fs.rmSync(target, { recursive: true, force: true });
  console.log('Cleaned', target);
} catch (e) {
  console.error('Failed to clean', target, e);
  process.exit(0);
}

