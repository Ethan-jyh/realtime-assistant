import { test, expect } from 'vitest';
import { createRequire } from 'node:module';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const require = createRequire(import.meta.url);
const local = require('../scripts/local-signing.cjs');
const hook = require('../scripts/sign-app.cjs');
test('reject absent or malformed signing config without any ad-hoc fallback', () => {
  expect(() => local.readManifest('/a/nonexistent/repo')).toThrow(/cannot fall back/);
  for (const patch of [{ certificateSha1: '-' }, { appId: 'other.app' }, { keychain: 'relative' }]) {
    expect(() => local.validateManifest({ version: 1, appId: local.APP_ID, certificateSha1: 'A'.repeat(40), keychain: '/tmp/keychain', certificate: '/tmp/cert', ...patch })).toThrow();
  }
});
test('restores only the known creation append, preserving spaces and original order', () => {
  const original = ['/Users/example/Library/My Keychain', '/Library/Keychains/System.keychain'];
  let state = [...original, '/tmp/project.keychain'];
  const calls: string[][] = [];
  const run = (_file: string, args: string[]) => {
    calls.push(args);
    if (args.includes('-s')) { state = args.slice(4); return ''; }
    return state.map(value => '    ' + JSON.stringify(value)).join('\n');
  };
  local.restoreSearchList(original, '/tmp/project.keychain', run);
  expect(state).toEqual(original);
  expect(calls.find(args => args.includes('-s'))).toEqual(['list-keychains', '-d', 'user', '-s', ...original]);
  expect(() => local.parseKeychains('unquoted path')).toThrow();
});
test('does not overwrite an unrelated concurrent keychain search-list change', () => {
  let mutated = false;
  expect(() => local.restoreSearchList(['/tmp/original'], '/tmp/project', (_: string, args: string[]) => {
    if (args.includes('-s')) mutated = true;
    return '"/tmp/original"\n"/tmp/new-user-keychain"\n"/tmp/project"';
  })).toThrow(/externally/);
  expect(mutated).toBe(false);
});
test('hook pins certificate, signs native helper, and verifies strict integrity plus anchor', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rea-signing-test-'));
  try {
    const app = join(dir, 'REA.app');
    mkdirSync(join(app, 'Contents/Resources'), { recursive: true });
    const helper = join(app, 'Contents/Resources/option-modifier');
    writeFileSync(helper, Buffer.from('cffaedfe00000000', 'hex'));
    const audioHelper = join(app, 'Contents/Resources/system-audio');
    writeFileSync(audioHelper, Buffer.from('cffaedfe00000000', 'hex'));
    const cert = join(dir, 'cert.der'); writeFileSync(cert, 'fake public certificate fixture');
    const keychain = join(dir, 'fake.keychain'); writeFileSync(keychain, 'not a keychain');
    writeFileSync(join(dir, 'keychain-password'), 'fixture password');
    const manifest = { version: 1, appId: local.APP_ID, certificateSha1: createHash('sha1').update('fake public certificate fixture').digest('hex').toUpperCase(), certificate: cert, keychain };
    const calls: { file: string; args: string[] }[] = [];
    let signed: any;
    const deps = {
      manifest,
      run(file: string, args: string[]) {
        calls.push({ file, args });
        if (file.endsWith('PlistBuddy')) return local.APP_ID;
        if (args[0] === 'find-identity') return manifest.certificateSha1;
        return '';
      },
      async secureRun() { return ''; },
      async signAsync(options: any) { signed = options; }
    };
    await hook({ app, identity: '-', ignore: /option-modifier/, optionsForFile: () => ({ hardenedRuntime: false, entitlements: '/fixture/entitlements' }) }, undefined, deps);
    expect(signed.identity).toBe(manifest.certificateSha1);
    expect(signed.keychain).toBe(keychain);
    expect(signed.strictVerify).toBe(true);
    expect(signed.ignore).toBeUndefined();
    expect(signed.binaries).toContain(helper);
    expect(signed.optionsForFile(app).requirements).toContain('anchor H"' + manifest.certificateSha1);
    expect(signed.optionsForFile(helper).requirements).toContain(local.APP_ID + '.option-modifier');
    expect(signed.optionsForFile(audioHelper).requirements).toContain(local.APP_ID + '.system-audio');
    expect(signed.optionsForFile(audioHelper).additionalArguments).toEqual(['--identifier', local.APP_ID + '.system-audio']);
    expect(signed.optionsForFile(helper).entitlements).toBe('/fixture/entitlements');
    expect(signed.optionsForFile(helper).hardenedRuntime).toBe(false);
    expect(calls.some(call => call.args.includes('--deep') && call.args.includes('--strict'))).toBe(true);
    expect(calls.some(call => call.args.at(-1) === helper && call.args.some(arg => arg.startsWith('-R=anchor')))).toBe(true);
    expect(calls.at(-1)?.args).toEqual(['lock-keychain', keychain]);
    let triedSign = false;
    await expect(hook({ app }, undefined, { ...deps, manifest: { ...manifest, certificateSha1: 'B'.repeat(40) }, signAsync: async () => { triedSign = true; } })).rejects.toThrow(/fingerprint mismatch/);
    expect(triedSign).toBe(false);
    await expect(hook({ app }, undefined, { ...deps, run: (file: string, args: string[]) => file.endsWith('PlistBuddy') ? local.APP_ID : args[0] === 'find-identity' ? '' : '' })).rejects.toThrow(/Exact pinned/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('OpenSSL consumes encrypted-key password from fd3 with ignored stdin', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'rea-openssl-pipe-test-'));
  const key = join(dir, 'dummy.pem');
  const cert = join(dir, 'dummy-cert.pem');
  const fixturePassword = 'synthetic-fixture-password';
  try {
    await local.secureRun('openssl', ['genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:1024', '-aes-256-cbc', '-pass', 'fd:3', '-out', key], '', [fixturePassword]);
    await local.secureRun('openssl', ['req', '-new', '-x509', '-key', key, '-passin', 'fd:3', '-out', cert, '-subj', '/CN=Dummy Offline Test', '-days', '1'], '', [fixturePassword]);
    expect(local.run('openssl', ['x509', '-in', cert, '-noout', '-subject'])).toContain('Dummy Offline Test');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('resume accepts an empty keychain or only the original identity and rejects others', () => {
  const pinned = 'A'.repeat(40);
  expect(local.existingIdentityState('0 identities found', pinned)).toBe('empty');
  expect(local.existingIdentityState('  1) ' + pinned + ' "REA Local Code Signing"\n1 identities found', pinned)).toBe('matching');
  expect(() => local.existingIdentityState('  1) ' + 'B'.repeat(40) + ' "Other"\n1 identities found', pinned)).toThrow(/unrelated/);
  expect(() => local.existingIdentityState('unexpected output', pinned)).toThrow(/Unexpected/);
});
