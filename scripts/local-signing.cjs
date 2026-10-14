const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn, execFileSync } = require('node:child_process');
const ROOT = path.resolve(__dirname, '..');
const APP_ID = 'local.realtime.assistant';
function signingDirectory(root = ROOT) { return path.join(root, '.local-signing'); }
function configPath(root = ROOT) { return path.join(signingDirectory(root), 'manifest.json'); }
function parseKeychains(text) {
  return text.split('\n').map(line => line.trim()).filter(Boolean).map(line => {
    if (!/^"(?:[^"\\]|\\.)*"$/.test(line)) throw new Error('Unexpected keychain search-list output');
    return JSON.parse(line);
  });
}
function validateManifest(value) {
  if (value?.version !== 1 || value?.appId !== APP_ID || !/^[A-Fa-f0-9]{40}$/.test(value?.certificateSha1 || '')) throw new Error('Invalid pinned local-signing manifest');
  for (const field of ['keychain', 'certificate']) if (typeof value[field] !== 'string' || !path.isAbsolute(value[field])) throw new Error(`Invalid absolute ${field} path`);
  return { ...value, certificateSha1: value.certificateSha1.toUpperCase() };
}
function readManifest(root = ROOT) {
  const file = configPath(root);
  if (!fs.existsSync(file)) throw new Error('Local signing is not configured. Run node scripts/local-signing.cjs init after authorization; packaging cannot fall back to ad-hoc signing.');
  return validateManifest(JSON.parse(fs.readFileSync(file, 'utf8')));
}
function existingIdentityState(output, expectedSha1) {
  const fingerprints = [...output.matchAll(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+/gm)].map(match => match[1].toUpperCase());
  if (fingerprints.some(hash => hash !== expectedSha1.toUpperCase())) throw new Error('Project keychain contains an unrelated identity; refusing to change it');
  if (!fingerprints.length && !/0 (?:valid )?identities found/.test(output)) throw new Error('Unexpected project keychain identity output');
  return fingerprints.length ? 'matching' : 'empty';
}
function sameList(a, b) { return JSON.stringify(a) === JSON.stringify(b); }
function restoreSearchList(original, created, run) {
  const current = parseKeychains(run('/usr/bin/security', ['list-keychains', '-d', 'user']));
  const withoutCreated = current.filter(item => item !== created && item !== created.replace(/-db$/, ''));
  if (!sameList(withoutCreated, original)) throw new Error('Keychain search list changed externally. Refusing to overwrite unrelated changes; restore the pre-creation list manually.');
  if (!sameList(current, original)) run('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...original]);
  if (!sameList(parseKeychains(run('/usr/bin/security', ['list-keychains', '-d', 'user'])), original)) throw new Error('Failed to restore keychain search list');
}
function run(file, args) { return execFileSync(file, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }); }
function secureRun(file, args, input, extraSecrets = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { stdio: [input ? 'pipe' : 'ignore', 'pipe', 'pipe', ...extraSecrets.map(() => 'pipe')] });
    // Never relay output from a process receiving secret command input.
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.resume();
    child.on('error', () => reject(new Error(`Could not start ${path.basename(file)}`)));
    child.on('close', code => code === 0 ? resolve(output) : reject(new Error(`${path.basename(file)} failed (exit ${code}); secret-bearing output was withheld`)));
    if (child.stdin) { child.stdin.on('error', () => {}); child.stdin.end(input); }
    extraSecrets.forEach((secret, i) => { child.stdio[i + 3].on('error', () => {}); child.stdio[i + 3].end(secret + '\n'); });
  });
}
function securityLine(args) {
  return args.map(arg => '"' + String(arg).replaceAll('\\', '\\\\').replaceAll('"', '\\"') + '"').join(' ') + '\n';
}
async function init(root = ROOT, resume = false) {
  if (process.platform !== 'darwin') throw new Error('Local macOS signing requires macOS');
  const dir = signingDirectory(root);
  if (fs.existsSync(dir) && !resume) throw new Error('Signing directory already exists; use resume only for an incomplete setup, never replace the identity');
  if (resume && !fs.existsSync(dir)) throw new Error('No incomplete signing directory to resume');
  if (!resume) fs.mkdirSync(dir, { mode: 0o700 });
  const keychain = path.join(dir, 'rea.keychain');
  const certificate = path.join(dir, 'certificate.der');
  const key = path.join(dir, 'private-key.pem');
  const pem = path.join(dir, 'certificate.pem');
  const p12 = path.join(dir, 'identity.p12');
  if (resume && fs.existsSync(configPath(root))) throw new Error('Resume refuses an existing manifest; do not replace an established identity');
  const hasKeychain = fs.existsSync(keychain) || fs.existsSync(keychain + '-db');
  if (hasKeychain && (!fs.existsSync(pem) || fs.statSync(pem).size === 0)) throw new Error('Existing project keychain requires its original certificate; refusing to regenerate identity');
  if (resume && (!fs.existsSync(key) || !fs.existsSync(path.join(dir, 'original-keychain-state.json')))) throw new Error('Incomplete setup is missing its original private key or keychain snapshot');
  const password = resume ? fs.readFileSync(path.join(dir, 'keychain-password'), 'utf8') : crypto.randomBytes(32).toString('hex');
  const backupPassword = resume ? fs.readFileSync(path.join(dir, 'backup-password'), 'utf8') : crypto.randomBytes(32).toString('hex');
  if (!/^[0-9a-f]{64}$/.test(password) || !/^[0-9a-f]{64}$/.test(backupPassword)) throw new Error('Invalid stored signing password format');
  if (!resume) {
    fs.writeFileSync(path.join(dir, 'keychain-password'), password, { mode: 0o600 });
    fs.writeFileSync(path.join(dir, 'backup-password'), backupPassword, { mode: 0o600 });
  }
  const original = parseKeychains(run('/usr/bin/security', ['list-keychains', '-d', 'user']));
  const originalDefault = run('/usr/bin/security', ['default-keychain', '-d', 'user']);
  if (resume) {
    const snapshot = JSON.parse(fs.readFileSync(path.join(dir, 'original-keychain-state.json'), 'utf8'));
    if (!sameList(snapshot.searchList, original) || snapshot.defaultKeychain !== originalDefault) throw new Error('Original keychain state has changed since setup; refusing to continue');
  } else fs.writeFileSync(path.join(dir, 'original-keychain-state.json'), JSON.stringify({ searchList: original, defaultKeychain: originalDefault }, null, 2), { mode: 0o600 });
  try {
    console.log(resume ? 'Resuming local signing with the existing encrypted key' : 'Generating local signing key');
    if (!resume) await secureRun('openssl', ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:3072', '-aes-256-cbc', '-pass', 'fd:3', '-out', key], '', [backupPassword]);
    console.log('Preparing public code-signing certificate');
    if (!fs.existsSync(pem) || fs.statSync(pem).size === 0) await secureRun('openssl', ['req', '-new', '-x509', '-sha256', '-days', '3650', '-key', key, '-passin', 'fd:3', '-out', pem, '-subj', '/CN=REA Local Code Signing/O=REA Local', '-addext', 'basicConstraints=critical,CA:FALSE', '-addext', 'keyUsage=critical,digitalSignature', '-addext', 'extendedKeyUsage=codeSigning'], '', [backupPassword]);
    run('openssl', ['x509', '-in', pem, '-noout']);
    run('openssl', ['x509', '-in', pem, '-outform', 'DER', '-out', certificate]);
    await secureRun('openssl', ['pkcs12', '-export', '-inkey', key, '-in', pem, '-out', p12, '-name', 'REA Local Code Signing', '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1', '-iter', '100000', '-passin', 'fd:3', '-passout', 'fd:4'], '', [backupPassword, backupPassword]);
    const sha1 = crypto.createHash('sha1').update(fs.readFileSync(certificate)).digest('hex').toUpperCase();
    const identityState = hasKeychain ? existingIdentityState(run('/usr/bin/security', ['find-identity', '-p', 'codesigning', keychain]), sha1) : 'empty';
    console.log('Creating project keychain and immediately restoring the search list');
    try { if (!hasKeychain) await secureRun('/usr/bin/security', ['-i'], securityLine(['create-keychain', '-p', password, keychain])); }
    finally { restoreSearchList(original, keychain, run); }
    if (run('/usr/bin/security', ['default-keychain', '-d', 'user']) !== originalDefault) throw new Error('Default keychain unexpectedly changed; stop and investigate');
    await secureRun('/usr/bin/security', ['-i'], securityLine(['unlock-keychain', '-p', password, keychain]));
    console.log('Importing identity into project keychain');
    if (identityState === 'empty') await secureRun('/usr/bin/security', ['-i'], securityLine(['import', p12, '-k', keychain, '-x', '-T', '/usr/bin/codesign', '-P', backupPassword]));
    const identities = run('/usr/bin/security', ['find-identity', '-p', 'codesigning', keychain]);
    if (!identities.includes(sha1)) throw new Error('Imported identity does not match certificate fingerprint');
    if (!sameList(parseKeychains(run('/usr/bin/security', ['list-keychains', '-d', 'user'])), original)) throw new Error('Search list changed during import');
    if (run('/usr/bin/security', ['default-keychain', '-d', 'user']) !== originalDefault) throw new Error('Default keychain changed during import');
    const manifest = validateManifest({ version: 1, appId: APP_ID, certificateSha1: sha1, keychain, certificate });
    fs.writeFileSync(configPath(root), JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
    return manifest;
  } finally {
    for (const entry of fs.readdirSync(dir)) if (fs.statSync(path.join(dir, entry)).isFile()) fs.chmodSync(path.join(dir, entry), 0o600);
    if (fs.existsSync(keychain)) run('/usr/bin/security', ['lock-keychain', keychain]);
  }
}
module.exports = { APP_ID, ROOT, signingDirectory, configPath, parseKeychains, validateManifest, readManifest, sameList, restoreSearchList, existingIdentityState, run, secureRun, securityLine, init };
if (require.main === module) {
  const command = process.argv[2];
  if (command === 'prepare') console.log(JSON.stringify({ command: 'node scripts/local-signing.cjs init --authorize-keychain-creation', directory: signingDirectory(), operations: ['Generate dedicated encrypted RSA code-signing identity', 'Create dedicated keychain (temporarily appended to search list)', 'Immediately restore original search list; assert unchanged default keychain', 'Import identity only to project keychain; no trust settings changes', 'Persist private material locally with 0700/0600 permissions'] }, null, 2));
  else if (['init', 'resume'].includes(command) && process.argv.includes('--authorize-keychain-creation')) init(ROOT, command === 'resume').then(manifest => console.log(`Local signing configured: ${manifest.certificateSha1}`)).catch(error => { console.error(error.message); process.exitCode = 1; });
  else { console.error('Use prepare, or init/resume --authorize-keychain-creation after explicit authorization.'); process.exitCode = 1; }
}
