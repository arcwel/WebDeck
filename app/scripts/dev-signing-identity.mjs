#!/usr/bin/env node
// A stable code-signing identity for local test builds.
//
// Every build we hand over is signed ad-hoc, and an ad-hoc signature is a
// different signature each time. macOS ties a Keychain item's permission to
// the signature of the app that asked for it, so an app that is a stranger on
// every launch is asked for the login password on every launch — which is what
// testing a rebuilt browser feels like. "Always Allow" cannot stick to
// something that never looks the same twice.
//
// A self-signed certificate fixes exactly that and nothing else: it makes the
// app the same app across rebuilds, so one "Always Allow" holds. It is not an
// Apple Developer ID, it does not notarize, and it does not make the build
// distributable — a release still needs the paid certificate (chromium/RELEASING.md).
//
// The identity lives in its own keychain under ~/.webdeck/signing, never in the
// login keychain, so nothing here can disturb passwords already stored there,
// and --remove takes it all back out.
//
// Usage:
//   node scripts/dev-signing-identity.mjs [--json] [--dry-run]
//   node scripts/dev-signing-identity.mjs --remove [--json]
// Exit codes: 0 ready · 1 could not create it · 2 not supported here
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
  chmodSync,
  readFileSync
} from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const IDENTITY = 'Arcwel WebDeck Dev'
const SIGNING_DIR = join(homedir(), '.webdeck', 'signing')
const KEYCHAIN = join(SIGNING_DIR, 'webdeck-dev.keychain-db')
const PASSWORD_FILE = join(SIGNING_DIR, 'keychain-password')

const asJson = process.argv.includes('--json')
const dryRun = process.argv.includes('--dry-run')
const remove = process.argv.includes('--remove')

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`dev-signing-identity — a stable signature for local test builds

  --remove    delete the identity and its keychain
  --dry-run   say what would happen, change nothing
  --json      machine-readable result

Then build with: node scripts/package-fork.mjs --identity "${IDENTITY}" ...`)
  process.exit(0)
}

const done = (status, detail) => {
  if (asJson)
    console.log(JSON.stringify({ status, identity: IDENTITY, keychain: KEYCHAIN, detail }, null, 2))
  else console.log(detail)
  process.exit(status === 'error' ? 1 : 0)
}
const fail = (why) => {
  if (asJson) console.log(JSON.stringify({ status: 'error', detail: why }, null, 2))
  else console.error(`cannot create the identity: ${why}`)
  process.exit(1)
}

if (process.platform !== 'darwin') {
  const why = 'macOS only — codesign and the Keychain are not portable'
  if (asJson) console.log(JSON.stringify({ status: 'unsupported', detail: why }, null, 2))
  else console.error(why)
  process.exit(2)
}

const sh = (cmd, args, { allowFail = false } = {}) => {
  try {
    return execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  } catch (err) {
    if (allowFail) return null
    throw new Error(
      `${cmd} ${args.join(' ')} failed: ${(err.stderr || err.message).toString().trim()}`,
      {
        cause: err
      }
    )
  }
}

/** The user's keychain search list, minus ours. Order is preserved. */
const searchList = () =>
  (sh('/usr/bin/security', ['list-keychains', '-d', 'user']) ?? '')
    .split('\n')
    .map((line) => line.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)
    .filter((path) => path !== KEYCHAIN)

// Deliberately the FULL identity list, not the valid-only one. A self-signed
// certificate is never trusted by macOS, so it never appears as "valid" — and
// codesign signs with it regardless. Adding a trust setting would ask for the
// login password, which is the thing this whole file exists to stop asking for.
const identityHash = () => {
  const out =
    sh('/usr/bin/security', ['find-identity', '-p', 'codesigning'], { allowFail: true }) ?? ''
  const row = [...out.matchAll(/^\s*\d+\)\s+([0-9A-F]{40})\s+"(.+?)"/gm)].find(
    (m) => m[2] === IDENTITY
  )
  return row ? row[1] : null
}

if (remove) {
  if (dryRun) done('ok', `would remove ${KEYCHAIN} and drop it from the search list`)
  sh('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...searchList()], {
    allowFail: true
  })
  sh('/usr/bin/security', ['delete-keychain', KEYCHAIN], { allowFail: true })
  rmSync(SIGNING_DIR, { recursive: true, force: true })
  done('ok', `removed ${IDENTITY}`)
}

// A keychain locks itself when the Mac reboots, and a locked one hands out no
// identities: codesign fails with errSecInternalComponent and `find-identity`
// simply does not list this one. The certificate is still there, so the check
// below still finds it — which is why this used to report "already in the
// keychain" and leave the build unable to sign. Unlock it here, with the
// password this script generated, so a reboot costs nothing.
unlockKeychain()

/** Unlock the dev keychain with the password this script stores beside it. */
function unlockKeychain() {
  if (!existsSync(KEYCHAIN) || !existsSync(PASSWORD_FILE)) return
  const stored = readFileSync(PASSWORD_FILE, 'utf8').trim()
  if (!stored) return
  sh('/usr/bin/security', ['unlock-keychain', '-p', stored, KEYCHAIN], { allowFail: true })
  // Belt and braces: a keychain created before set-keychain-settings was added
  // still carries an auto-lock timeout, which would relock it mid-build.
  sh('/usr/bin/security', ['set-keychain-settings', KEYCHAIN], { allowFail: true })
}

const existing = identityHash()
if (existing) {
  done(
    'ok',
    `${IDENTITY} is already in the keychain (${existing}) and unlocked — build with --identity "${IDENTITY}"`
  )
}

if (dryRun) {
  done('ok', `would create a self-signed "${IDENTITY}" certificate in ${KEYCHAIN}`)
}

// A password we generate and keep, so nothing here ever asks the user for
// theirs. It guards a keychain that holds one throwaway signing key and
// nothing else.
mkdirSync(SIGNING_DIR, { recursive: true, mode: 0o700 })
// Hex, so the password can never begin with a dash and be read as a flag by
// the security tool, which takes it as a bare argument.
const password = existsSync(PASSWORD_FILE)
  ? readFileSync(PASSWORD_FILE, 'utf8').trim()
  : randomBytes(24).toString('hex')
writeFileSync(PASSWORD_FILE, `${password}\n`, { mode: 0o600 })
chmodSync(PASSWORD_FILE, 0o600)

const work = mkdtempSync(join(tmpdir(), 'webdeck-signing-'))
try {
  // codeSigning is the extended key usage codesign insists on; a certificate
  // without it imports fine and then is not offered as an identity, which
  // looks like the import silently doing nothing.
  const config = join(work, 'openssl.cnf')
  writeFileSync(
    config,
    `[req]
distinguished_name = dn
x509_extensions = v3
prompt = no

[dn]
CN = ${IDENTITY}
O = Arcwel
OU = Local test builds

[v3]
basicConstraints = critical,CA:false
keyUsage = critical,digitalSignature
extendedKeyUsage = critical,codeSigning
subjectKeyIdentifier = hash
`
  )
  const key = join(work, 'key.pem')
  const cert = join(work, 'cert.pem')
  const bundle = join(work, 'identity.p12')
  sh('/usr/bin/openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-sha256',
    '-days',
    '3650',
    '-nodes',
    '-keyout',
    key,
    '-out',
    cert,
    '-config',
    config
  ])
  sh('/usr/bin/openssl', [
    'pkcs12',
    '-export',
    '-inkey',
    key,
    '-in',
    cert,
    '-out',
    bundle,
    '-name',
    IDENTITY,
    '-passout',
    `pass:${password}`
  ])

  if (existsSync(KEYCHAIN))
    sh('/usr/bin/security', ['delete-keychain', KEYCHAIN], { allowFail: true })
  sh('/usr/bin/security', ['create-keychain', '-p', password, KEYCHAIN])
  // No auto-lock: a keychain that relocks mid-build brings the password prompt
  // back, which is the whole thing we are removing.
  sh('/usr/bin/security', ['set-keychain-settings', KEYCHAIN])
  sh('/usr/bin/security', ['unlock-keychain', '-p', password, KEYCHAIN])
  sh('/usr/bin/security', [
    'import',
    bundle,
    '-k',
    KEYCHAIN,
    '-P',
    password,
    '-A',
    '-T',
    '/usr/bin/codesign'
  ])
  // Without this the key is usable only after a prompt, per use.
  sh(
    '/usr/bin/security',
    ['set-key-partition-list', '-S', 'apple-tool:,apple:', '-s', '-k', password, KEYCHAIN],
    { allowFail: true }
  )
  // codesign only searches keychains on the list.
  sh('/usr/bin/security', ['list-keychains', '-d', 'user', '-s', ...searchList(), KEYCHAIN])
} catch (err) {
  fail(err.message)
} finally {
  rmSync(work, { recursive: true, force: true })
}

const hash = identityHash()
if (!hash) fail('the certificate imported but codesign does not offer it as an identity')
// Prove the stored password opens the keychain, now, while it is cheap to
// redo: a keychain that later refuses its own password surfaces as codesign
// asking the user for a password nobody knows.
if (
  sh('/usr/bin/security', ['unlock-keychain', '-p', password, KEYCHAIN], { allowFail: true }) ===
  null
) {
  fail('the keychain was created but does not unlock with the password that was stored for it')
}

done('ok', `${IDENTITY} is ready (${hash}) — build with --identity "${IDENTITY}"`)
