#!/usr/bin/env node
// Checks the extension before a commit or release:
//  1. every .js file parses,
//  2. manifest.json is valid and every file it points to exists,
//  3. nothing private slipped in (keys, tokens, emails, private chat links, personal paths).
// Optional: list extra words to block, one per line, in scripts/private-terms.txt (git-ignored).
import fs from 'fs';
import path from 'path';
import vm from 'vm';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const ext = path.join(root, 'extension');
let failures = 0;
const fail = (msg) => { failures++; console.error('✗ ' + msg); };

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'dist'].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    e.isDirectory() ? walk(p, out) : out.push(p);
  }
  return out;
}

// 1. Syntax
for (const f of walk(ext).filter((f) => f.endsWith('.js'))) {
  try { new vm.Script(fs.readFileSync(f, 'utf8'), { filename: f }); }
  catch (e) { fail(`${path.relative(root, f)}: ${e.message}`); }
}

// 2. Manifest
let manifest;
try { manifest = JSON.parse(fs.readFileSync(path.join(ext, 'manifest.json'), 'utf8')); }
catch (e) { fail('manifest.json: ' + e.message); }
if (manifest) {
  if (manifest.manifest_version !== 3) fail('manifest_version must be 3');
  if (!/^\d+\.\d+\.\d+$/.test(manifest.version || '')) fail('version must look like 1.2.3');
  const refs = [manifest.background?.service_worker, manifest.action?.default_popup, manifest.options_ui?.page,
    ...Object.values(manifest.icons || {}), ...Object.values(manifest.action?.default_icon || {})].filter(Boolean);
  for (const r of refs) if (!fs.existsSync(path.join(ext, r))) fail(`manifest points to a missing file: ${r}`);
  for (const f of walk(ext).filter((f) => f.endsWith('.html'))) {
    const html = fs.readFileSync(f, 'utf8');
    for (const m of html.matchAll(/(?:src|href)="([^"#:?]+\.(?:js|css|png))"/g)) {
      if (!fs.existsSync(path.join(path.dirname(f), m[1]))) fail(`${path.relative(root, f)} links to a missing file: ${m[1]}`);
    }
  }
}

// 3. Privacy scan over the whole repository
const patterns = [
  [/sk-ant-[A-Za-z0-9_-]{10,}/, 'Anthropic API key'],
  [/sk-[A-Za-z0-9]{32,}/, 'API key'],
  [/gh[pousr]_[A-Za-z0-9]{30,}/, 'GitHub token'],
  [/AIza[0-9A-Za-z_-]{30,}/, 'Google API key'],
  [/xox[abpr]-[A-Za-z0-9-]{10,}/, 'Slack token'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'private key'],
  [/\b[A-Za-z0-9._%+-]+@(?!users\.noreply\.github\.com)[A-Za-z0-9.-]+\.(?:com|net|org|io|co|ai|dev|sg|in|uk)\b/, 'email address'],
  [/claude\.ai\/(?:chat|share)\/[0-9a-f-]{20,}/, 'link to a Claude chat'],
  [/chatgpt\.com\/(?:c|share)\/[0-9a-f-]{20,}/, 'link to a ChatGPT chat'],
  [/gemini\.google\.com\/app\/[0-9a-f]{8,}/, 'link to a Gemini chat'],
  [/\/Users\/[A-Za-z0-9._-]+\//, 'personal file path'],
  [/C:\\Users\\[A-Za-z0-9._-]+\\/, 'personal file path'],
];
const termsFile = path.join(root, 'scripts', 'private-terms.txt');
if (fs.existsSync(termsFile)) {
  for (const t of fs.readFileSync(termsFile, 'utf8').split('\n').map((s) => s.trim()).filter((s) => s && !s.startsWith('#'))) {
    patterns.push([new RegExp(t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i'), `private term "${t}"`]);
  }
}
const self = path.join(root, 'scripts', 'check.mjs');
for (const f of walk(root)) {
  if (f === self || f === termsFile || /\.(png|jpe?g|gif|ico|woff2?|zip)$/i.test(f)) continue;
  const lines = fs.readFileSync(f, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [re, what] of patterns) if (re.test(line)) fail(`${path.relative(root, f)}:${i + 1} looks like a ${what}`);
  });
}

if (failures) { console.error(`\n${failures} problem(s) found.`); process.exit(1); }
console.log(`✓ All checks passed (extension v${manifest.version}).`);
