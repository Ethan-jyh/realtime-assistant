const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const local = require('./local-signing.cjs');
function requirement(manifest, identifier = manifest.appId) {
  if (!/^[A-Za-z0-9._-]+$/.test(identifier)) throw new Error('Invalid signing identifier');
  return `identifier "${identifier}" and anchor H"${manifest.certificateSha1}"`;
}
function machOFiles(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) result.push(...machOFiles(file));
    else if (entry.isFile()) {
      const fd = fs.openSync(file, 'r'); const buffer = Buffer.alloc(4);
      try { if (fs.readSync(fd, buffer, 0, 4, 0) === 4 && ['feedface', 'cefaedfe', 'feedfacf', 'cffaedfe', 'cafebabe', 'bebafeca', 'cafebabf', 'bfbafeca'].includes(buffer.toString('hex'))) result.push(file); }
      finally { fs.closeSync(fd); }
    }
  }
  return result;
}
async function signApp(opts, _packager, dependencies = {}) {
  const run = dependencies.run || local.run;
  const signAsync = dependencies.signAsync || require('@electron/osx-sign').signAsync;
  const manifest = local.validateManifest(dependencies.manifest || local.readManifest());
  if (process.env.CSC_LINK || process.env.CSC_KEY_PASSWORD || process.env.CSC_INSTALLER_LINK || _packager?.config?.cscLink || _packager?.platformSpecificBuildOptions?.cscLink) throw new Error('Automatic builder certificate import is prohibited for local signing');
  const app = path.resolve(opts.app);
  if (!fs.existsSync(manifest.keychain) || !fs.existsSync(manifest.certificate)) throw new Error('Missing pinned signing certificate/keychain');
  if (crypto.createHash('sha1').update(fs.readFileSync(manifest.certificate)).digest('hex').toUpperCase() !== manifest.certificateSha1) throw new Error('Pinned certificate fingerprint mismatch');
  const identifier = run('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIdentifier', path.join(app, 'Contents/Info.plist')]).trim();
  if (identifier !== manifest.appId) throw new Error('Application identifier does not match pinned signing configuration');
  const identities = run('/usr/bin/security', ['find-identity', '-p', 'codesigning', manifest.keychain]);
  if (!identities.includes(manifest.certificateSha1)) throw new Error('Exact pinned signing identity not found');
  const nativeFiles = machOFiles(path.join(app, 'Contents'));
  const nativeHelper = path.join(app, 'Contents/Resources/option-modifier');
  const audioHelper = path.join(app, 'Contents/Resources/system-audio');
  if (!nativeFiles.includes(audioHelper)) throw new Error('Required native system-audio helper is missing or not Mach-O');
  if (!nativeFiles.includes(nativeHelper)) throw new Error('Required native option-modifier helper is missing or not Mach-O');
  const passwordFile = path.join(path.dirname(manifest.keychain), 'keychain-password');
  const secureRun = dependencies.secureRun || local.secureRun;
  await secureRun('/usr/bin/security', ['-i'], local.securityLine(['unlock-keychain', '-p', fs.readFileSync(passwordFile, 'utf8'), manifest.keychain]));
  try {
    await signAsync({
      ...opts, app, identity: manifest.certificateSha1, keychain: manifest.keychain,
      identityValidation: false, strictVerify: true, preAutoEntitlements: false, preEmbedProvisioningProfile: false,
      // Require signing every discovered Mach-O. No signIgnore or inherited exclusions.
      ignore: undefined,
      binaries: [...new Set([...(opts.binaries || []), ...nativeFiles])],
      optionsForFile(file) {
        const base = opts.optionsForFile ? opts.optionsForFile(file) : {};
        const extra = (base.additionalArguments || []).filter(arg => !/^--(?:sign|keychain|requirements|identifier|preserve-metadata)/.test(arg));
        return { ...base, timestamp: 'none', requirements: undefined, additionalArguments: extra,
          ...(file === app ? { requirements: '=designated => ' + requirement(manifest) } : {}),
          ...(file === audioHelper ? { requirements: '=designated => ' + requirement(manifest, manifest.appId + '.system-audio'), additionalArguments: [...extra, '--identifier', manifest.appId + '.system-audio'] } : {}),
          ...(file === nativeHelper ? { requirements: '=designated => ' + requirement(manifest, manifest.appId + '.option-modifier'), additionalArguments: [...extra, '--identifier', manifest.appId + '.option-modifier'] } : {}) };
      }
    });
    run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', app]);
    run('/usr/bin/codesign', ['--verify', '--strict', '-R=' + requirement(manifest), app]);
    for (const file of nativeFiles) run('/usr/bin/codesign', ['--verify', '--strict', '-R=anchor H"' + manifest.certificateSha1 + '"', file]);
  } finally { run('/usr/bin/security', ['lock-keychain', manifest.keychain]); }
}
module.exports = signApp;
module.exports.requirement = requirement;
module.exports.machOFiles = machOFiles;
