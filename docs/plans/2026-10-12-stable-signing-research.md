# Stable local macOS signing research — 2026-10-12

Status: research and proposed commands only. No keys, certificates, keychains, trust settings, app signatures or privacy permissions were changed. Tested against installed electron-builder 26.15.3 and @electron/osx-sign 1.3.3 source; signing feasibility still requires an explicitly authorized local experiment.

## Decision and important constraint

A long-lived self-signed code-signing certificate plus fixed `local.realtime.assistant` identifier can give updates a stable designated requirement (DR). The DR must retain a certificate hash anchor; an identifier-only DR is unacceptable. Apple distinguishes signature integrity / code identity from trust policy. Its guide says ordinary requirement verification does not consult trust settings unless `anchor trusted` is requested. This is suitable for local identity stability, not Developer ID distribution or notarization.

The strict request “never modify the user's keychain search list” conflicts with the supported creation command: local `security help` explicitly says `create-keychain` creates keychains **and adds them to the search list**. The public `SecKeychainCreate` implementation also creates via `storageManager.make(pathName, true, true)`. A create-and-restore flow has a transient modification; do not describe it as no modification. No supported no-side-effect creation workflow was established. Do not use private deprecated keychain APIs, edit keychain databases, repurpose HOME, or copy a user keychain as a workaround.

Two honest choices:

1. User provides an existing detached project keychain containing the signing identity. Signing uses an explicit keychain path and makes no deliberate search-list/default/trust mutations. This must first be validated on this macOS version.
2. User explicitly authorizes one project-keychain creation with its documented transient search-list append, followed immediately by restoration of the exact original list. Never change default/login keychain or trust settings. Treat this as a separate authorization, not implied by repository edits. Future builds need only unlock the detached project keychain.

If neither is authorized, stop before identity creation. The supported paid alternative is an Apple-issued signing identity; switching signer later may require a fresh privacy consent.

## Proposed setup, after explicit authorization only

Use a dedicated persistent private directory outside Git, e.g. `/Users/air/Library/Application Support/REA/Signing`, mode 0700. Never commit/export private keys, PKCS#12 containers or keychain passwords. Record only public certificate DER, exact SHA-1 certificate fingerprint and intended identifier in project configuration. Keep an encrypted offline backup under user control: changing the actual certificate (including replacing it with a regenerated certificate having the same name) changes this pinned identity.

Commands below are a reviewable design, **not executed**. Run password prompts in the user's terminal / SecurityAgent, never paste passwords into chat, tool arguments, environment variables, CLI `-p` / `-P` arguments or logs.

```sh
umask 077
SIGNING_DIR='/Users/air/Library/Application Support/REA/Signing'
mkdir -p "$SIGNING_DIR"
chmod 700 "$SIGNING_DIR"
openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -aes-256-cbc -out "$SIGNING_DIR/private-key.pem"
openssl req -new -x509 -sha256 -days 3650 -key "$SIGNING_DIR/private-key.pem" -out "$SIGNING_DIR/certificate.pem" -subj '/CN=REA Local Code Signing/O=REA Local' -addext 'basicConstraints=critical,CA:FALSE' -addext 'keyUsage=critical,digitalSignature' -addext 'extendedKeyUsage=codeSigning'
openssl x509 -in "$SIGNING_DIR/certificate.pem" -outform DER -out "$SIGNING_DIR/certificate.der"
openssl x509 -in "$SIGNING_DIR/certificate.pem" -noout -fingerprint -sha1
openssl pkcs12 -export -inkey "$SIGNING_DIR/private-key.pem" -in "$SIGNING_DIR/certificate.pem" -out "$SIGNING_DIR/identity.p12" -name 'REA Local Code Signing'
```

Encryption passphrases are prompted by OpenSSL. The cert has code-signing EKU and cannot serve as a CA. Do not add it as a trusted certificate, neither globally nor for only codesigning.

If choice 2 is approved, a small setup helper should snapshot `security list-keychains -d user` into a parsed array and `security default-keychain -d user` for equality checks, fail if destination exists, and install cleanup/restoration before creation. Use an argument-array process API, not whitespace splitting or shell eval. Create with `security create-keychain -P <absolute-project-keychain-path>` (SecurityAgent prompt), restore original search-list array immediately with `security list-keychains -d user -s <original-path-1> ...`, and verify byte-for-byte path sequence and unchanged default. Restoration is an authorized mutation; fail closed on failure. Ensure no other keychain-management operation runs concurrently. Do not discard concurrent external user changes blindly. No signature step may run if restoration fails.

Then import only into the explicit project keychain:

```sh
security import "$SIGNING_DIR/identity.p12" -k "$SIGNING_DIR/rea-signing.keychain-db" -x -T /usr/bin/codesign
security find-identity -p codesigning "$SIGNING_DIR/rea-signing.keychain-db"
security unlock-keychain -u "$SIGNING_DIR/rea-signing.keychain-db"
```

Without `-P`, import prompts securely through the GUI. `-x` makes the imported private key nonextractable (the separately encrypted backup remains under user control). `-T /usr/bin/codesign` is a narrow intended key-use grant. Do not use `-A` or an unattended broad `set-key-partition-list` grant. If modern key ACLs require an authorization dialog, the user approves codesign access interactively; never silently broaden access. `find-identity` deliberately omits `-v`: an untrusted self-signed identity can be absent from the valid-only list. Its SHA-1 fingerprint must exactly match the independently calculated public certificate fingerprint.

If PKCS#12 import rejects OpenSSL 3's default encoding on this OS, investigate the precise error before choosing compatibility encoding; do not fall back to plaintext private keys. No build process receives passwords. Lock only the dedicated keychain after signing, never lock all keychains.

## Electron integration design

Avoid `CSC_LINK` / `CSC_KEY_PASSWORD`: builder's automatic certificate import creates a keychain, changes the search list and adds Apple root-cert keychains. Fail if these automatic-import variables/configuration are set. Explicit `CSC_KEYCHAIN` alone does not create/import a keychain, but a separate `REA_SIGNING_KEYCHAIN` avoids accidental reliance on builder discovery.

In this installed builder version, a `mac.sign` custom hook is invoked only after `findSigningIdentity` returns a truthy object. A genuinely untrusted identity is filtered by builder discovery. Retain `mac.identity: "-"` strictly as a dispatcher sentinel and set `mac.sign: scripts/sign-local-mac.cjs`; the hook must override it with the exact real certificate fingerprint before `signAsync`. Never fall back to actual ad-hoc signing when identity/keychain validation fails. An alternative afterPack workflow needs review of ordering, because builder can later overwrite it with ad-hoc signing.

Hook outline (design, not implementation):

```js
const { signAsync } = require('@electron/osx-sign');
module.exports = async function signLocal(opts) {
  // Read a public manifest containing exact cert fingerprint + app identifier.
  // Validate keychain/manifest exist and fingerprint is 40 hex characters.
  // Enumerate identity in ONLY that keychain and require exact fingerprint match.
  // Reject CSC_LINK/config cscLink, identity '-', or incorrect app CFBundleIdentifier.
  // Preserve builder's optionsForFile entitlements and existing hardenedRuntime=false.
  const baseOptionsForFile = opts.optionsForFile;
  await signAsync({
    ...opts,
    identity: manifest.certificateSha1,
    keychain: absoluteProjectKeychainPath,
    identityValidation: false,
    strictVerify: true,
    preAutoEntitlements: false,
    preEmbedProvisioningProfile: false,
    optionsForFile(filePath) {
      const base = baseOptionsForFile(filePath);
      return {
        ...base,
        timestamp: 'none',
        ...(filePath === opts.app ? {
          requirements: '=designated => identifier "local.realtime.assistant" and anchor H"' + manifest.certificateSha1 + '"'
        } : {})
      };
    }
  });
  // Require deep/strict codesign verification and test exact pinned DR.
};
```

`identityValidation:false` skips osx-sign's *identity-discovery filter*, not signature verification: installed sign.js still invokes `codesign --verify --deep --strict --verbose=2`. The hook must add its own exact certificate lookup and post-sign requirement match. Use no `anchor trusted`, no identifier-only requirement, no `strictVerify:false`, no `--deep` signing. osx-sign orders nested code deepest-first. Nested helpers retain their own identifiers and automatically generated cert-bound DR; check these for stability too, particularly the native `Contents/Resources/option-modifier` tool. Do not blanket-assign the main app's identifier to unrelated components. Preserve existing entitlements and hardened runtime policy; enabling hardened runtime is a separate task.

`codesign --keychain` searches that keychain for the identity, but its man page warns that certificate-chain resolution still consults the user's ordinary search list. With a single self-signed certificate there is no intermediate chain to discover; the existing implementation's success still needs an authorized proof on this host. On any failure, keep the existing installed app and stop. Do not resolve failures by trusting the cert or changing the search list.

## Acceptance evidence

Build A and B as separate output copies with identical appId and signer but a demonstrable content change (e.g. build/version string). Do not edit an installed app or privacy DB. For each independently signed app:

```sh
codesign --verify --deep --strict --verbose=4 '/path/to/A/Realtime Assistant.app'
codesign --verify --deep --strict --verbose=4 '/path/to/B/Realtime Assistant.app'
codesign -d -r- '/path/to/A/Realtime Assistant.app'
codesign -d -r- '/path/to/B/Realtime Assistant.app'
codesign -d --verbose=4 '/path/to/A/Realtime Assistant.app'
codesign -d --verbose=4 '/path/to/B/Realtime Assistant.app'
codesign --verify --strict -R='identifier "local.realtime.assistant" and anchor H"ACTUAL_CERT_SHA1"' '/path/to/A/Realtime Assistant.app'
codesign --verify --strict -R='identifier "local.realtime.assistant" and anchor H"ACTUAL_CERT_SHA1"' '/path/to/B/Realtime Assistant.app'
```

Assertions: signing identifier equal; DR expression byte-equal and contains exact certificate anchor; CDHash different; signature not ad-hoc; both integrity/requirement checks pass; nested helper DRs stable; user's search-list/default unchanged at completion and no trust mutations occurred. Export and inspect embedded public certificate if necessary. Negative control: an unrelated certificate must fail the pinned `-R` check; can use an existing artifact with a different signer rather than create a second secret identity. `spctl --assess` may reject a local self-signed app, and that is not permission to disable Gatekeeper or overwrite its policy.

Only after passing signing acceptance, and separately authorized installation/launch, manually test microphone/system-audio/screen access on A, quit all processes, replace at the same installation path with B, and test again. Privacy permission prompts remain user-approved. Record observations per service rather than promising universal persistence. Do not query/read/write TCC DB, reset permissions, suppress prompts or automate consent clicks. Transition from existing ad-hoc build to this new cert-bound identity may need one fresh consent. Future cert replacement, appId/helper/responsible-process changes, user revocation, OS changes, and periodic screen-capture policy prompts can still cause consent.

## Sources

- [Apple Code Signing Guide — Code Signing Tasks](https://developer.apple.com/library/archive/documentation/Security/Conceptual/CodeSigningGuide/Procedures/Procedures.html): self-signed testing identities, explicit anchor syntax, trust-setting distinction, nested-code ordering.
- [Apple TN2206](https://developer.apple.com/library/archive/technotes/tn2206/): DR stability and subsystem trust policy distinction.
- [Apple TN3127](https://developer.apple.com/documentation/technotes/tn3127-inside-code-signing-requirements): privacy permission identity during development, ad-hoc versus cert signing. Web search exposed relevant official body, direct web open returned JS/Markdown unsupported response; do not overclaim access to full body.
- [Apple SecurityTool security.c](https://github.com/apple-oss-distributions/Security/blob/main/SecurityTool/macOS/security.c): create-keychain search-list side effect.
- [Apple SecKeychain.cpp](https://github.com/apple-oss-distributions/Security/blob/main/OSX/libsecurity_keychain/lib/SecKeychain.cpp): public create path and explicit open path.
- [Electron osx-sign](https://github.com/electron/osx-sign), locally installed dist/esm/sign.js lines 48–57, 129–155, 258–310; dist/cjs/types.d.ts and README: identityValidation, keychain, verification, timestamps.
- Local installed app-builder-lib/out/macPackager.js lines 288–334 and mac/MacTargetHelper.js lines 20–51: builder custom hook invocation details; codeSign/macCodeSign.js lines 81–168: automatic search-list mutations.
- Local `man codesign`, `security help`, `security help import`, `security help unlock-keychain`: keychain search-chain caveat and secret-safe GUI prompts.


## Implementation outcome

The root agent executed the explicitly authorized dedicated-keychain setup. Initial pipe/PKCS12 interoperability issues were corrected without replacing the original key/certificate. Final persistent signing directory is /Users/air/Documents/ChatGPT/REA/.local-signing. Two differing packages passed strict signatures and stable certificate-bound DR checks, with original search list/default preserved and no trust mutations. See ../acceptance/2026-10-12-audio-only-stable-signing.md for actual measurements and limitations; the research-only status above describes the earlier research stage.
