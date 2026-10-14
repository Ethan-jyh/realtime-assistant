const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const local = require('./local-signing.cjs');
const signing = require('./sign-app.cjs');
const helperIcons = require('./helper-icons.cjs');
const PR_VARIABLES = ['TRAVIS_PULL_REQUEST', 'CIRCLE_PULL_REQUEST', 'BITRISE_PULL_REQUEST', 'APPVEYOR_PULL_REQUEST_NUMBER', 'GITHUB_BASE_REF'];
const IMPORT_VARIABLES = ['CSC_LINK', 'CSC_KEY_PASSWORD', 'CSC_INSTALLER_LINK', 'CSC_INSTALLER_KEY_PASSWORD'];
function checkEnvironment(platform, env, argv) {
  if (platform !== 'darwin') throw new Error('Signed macOS packaging requires macOS');
  if (argv.some(arg => arg !== '--dir') || argv.length > 1) throw new Error('Only the optional --dir flag is accepted; signing/configuration overrides are prohibited');
  if (IMPORT_VARIABLES.some(key => env[key])) throw new Error('Automatic certificate import environment is prohibited before electron-builder starts');
  // Match installed builder-util isPullRequest; reject instead of altering signing policy.
  if (PR_VARIABLES.some(key => env[key] && env[key] !== 'false')) throw new Error('Pull-request packaging is prohibited because electron-builder may skip signing');
}
function checkConfig(config) {
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (['cscLink', 'cscInstallerLink', 'cscKeyPassword', 'cscInstallerKeyPassword'].includes(key) && child != null) throw new Error('Automatic certificate import configuration is prohibited before electron-builder starts');
      visit(child);
    }
  }
  visit(config);
  if (config.appId !== local.APP_ID || config.mac?.identity !== '-' || config.mac?.sign !== './scripts/sign-app.cjs') throw new Error('Required pinned local-signing hook configuration is missing');
  if (typeof config.productName !== 'string' || !config.productName || /[\/\\\x00-\x1f]/.test(config.productName)) throw new Error('Invalid app productName');
  const bundleName = config.mac?.extendInfo?.CFBundleName;
  if (bundleName != null && bundleName !== config.productName) throw new Error('CFBundleName must match productName for Electron helper lookup; use CFBundleDisplayName for display-only renaming');
  if (typeof config.directories?.output !== 'string') throw new Error('An explicit package output directory is required');
}
function verifyLayout(app, run) {
  const plist = path.join(app, 'Contents/Info.plist');
  const readName = key => {
    const name = run('/usr/libexec/PlistBuddy', ['-c', 'Print :' + key, plist]).trim();
    if (!name || name === '.' || name === '..' || /[\/\\\x00-\x1f\x7f]/.test(name)) throw new Error('Invalid ' + key + ' in packaged app');
    return name;
  };
  const bundleName = readName('CFBundleName');
  const executable = readName('CFBundleExecutable');
  const icon = readName('CFBundleIconFile');
  const requireFile = (file, label, executableFile = false) => {
    let stat;
    try { stat = fs.statSync(file); } catch { throw new Error('Missing packaged ' + label + ': ' + file); }
    if (!stat.isFile() || (executableFile && !(stat.mode & 0o111))) throw new Error('Invalid packaged ' + label + ': ' + file);
  };
  requireFile(path.join(app, 'Contents/MacOS', executable), 'main executable', true);
  for (const suffix of [' Helper', ' Helper (Renderer)']) {
    const helper = bundleName + suffix;
    requireFile(path.join(app, 'Contents/Frameworks', helper + '.app', 'Contents/MacOS', helper), helper + ' executable', true);
  }
  const iconFile = path.join(app, 'Contents/Resources', icon);
  requireFile(!path.extname(icon) && !fs.existsSync(iconFile) ? iconFile + '.icns' : iconFile, 'resource icon');
}
function verifyPackage(app, manifest, run = local.run) {
  run('/usr/bin/codesign', ['--verify', '--deep', '--strict', '--verbose=4', app]);
  verifyLayout(app, run);
  helperIcons.verify(app, run);
  run('/usr/bin/codesign', ['--verify', '--strict', '-R=' + signing.requirement(manifest), app]);
  for (const helper of ['option-modifier', 'system-audio']) {
    run('/usr/bin/codesign', ['--verify', '--strict', '-R=' + signing.requirement(manifest, manifest.appId + '.' + helper), path.join(app, 'Contents/Resources', helper)]);
  }
  for (const file of signing.machOFiles(path.join(app, 'Contents'))) run('/usr/bin/codesign', ['--verify', '--strict', '-R=anchor H"' + manifest.certificateSha1 + '"', file]);
}
async function packageMac(argv = [], dependencies = {}) {
  const root = dependencies.root || local.ROOT;
  const env = dependencies.env || process.env;
  checkEnvironment(dependencies.platform || process.platform, env, argv);
  const manifest = local.validateManifest(dependencies.manifest || local.readManifest(root));
  if (!dependencies.manifest) {
    if (!fs.existsSync(manifest.keychain) || !fs.existsSync(manifest.certificate)) throw new Error('Missing persistent project signing keychain/certificate');
    if (crypto.createHash('sha1').update(fs.readFileSync(manifest.certificate)).digest('hex').toUpperCase() !== manifest.certificateSha1) throw new Error('Pinned public signing certificate mismatch');
  }
  const configFile = path.join(root, 'electron-builder.yml');
  const getConfig = dependencies.getConfig || require('app-builder-lib/out/util/config/config').getConfig;
  const config = await getConfig(root, configFile, null);
  checkConfig(config);
  const output = path.resolve(root, config.directories.output);
  if (output === root || !output.startsWith(root + path.sep)) throw new Error('Package output must be within a dedicated project subdirectory');
  const args = [require.resolve('electron-builder/cli.js'), '--mac', '--arm64', '--config', configFile, ...(argv.includes('--dir') ? ['--dir'] : [])];
  const build = dependencies.build || ((file, buildArgs) => require('node:child_process').execFileSync(file, buildArgs, { cwd: root, env, stdio: 'inherit' }));
  await build(process.execPath, args);
  const app = path.join(output, 'mac-arm64', config.productName + '.app');
  (dependencies.verify || verifyPackage)(app, manifest);
  console.log('Packaged app passed strict verification with the pinned signing identity');
  return app;
}
module.exports = { checkEnvironment, checkConfig, verifyPackage, packageMac };
if (require.main === module) packageMac(process.argv.slice(2)).catch(error => { console.error(error.message); process.exitCode = 1; });
