/**
 * Host half of the dsh-desktop-autostart-win bundle.
 *
 * Owns exactly two things: finding the installed DeepSeek Harness desktop
 * executable, and the per-user Windows startup entry that launches it after
 * sign-in. The entry itself is the single source of truth, so no second copy
 * of the state is persisted and the page cannot drift from what Windows will
 * actually start.
 *
 * The browser half reaches this code through two same-origin routes on the
 * profile's web server:
 *   GET  /dsh-desktop-autostart-win/state  → detection + registration state
 *   POST /dsh-desktop-autostart-win/set    → { enabled: boolean } → new state
 *
 * Detection never hard-codes an install path. It tries, in order: the running
 * desktop app (`process.execPath` under Electron), the registry `App Paths`
 * keys, the usual per-user/per-machine install folders, and finally the
 * uninstall records. Only a real `.exe` that is not `node.exe`/`electron.exe`
 * and not an uninstaller is accepted.
 *
 * @module dsh-desktop-autostart-win
 */

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { promisify } from 'node:util'

const runCommand = promisify(execFile)

/** `webServer` is a hard dependency: the Loader waits for the HTTP carrier. */
export const inject = ['webServer']

const STATE_ROUTE = '/dsh-desktop-autostart-win/state'
const SET_ROUTE = '/dsh-desktop-autostart-win/set'

/** Current-user startup key (HKCU means no elevation and no machine-wide state). */
const RUN_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run'
/** Task Manager's per-entry enable/disable record for the same startup item. */
const APPROVED_KEY =
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StartupApproved\\Run'
/** Startup entry name; also what Windows shows under Startup apps. */
const VALUE_NAME = 'DeepSeek Harness'

const APP_PATH_KEYS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\DeepSeek Harness.exe',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\App Paths\\DeepSeek Harness.exe',
]
const UNINSTALL_KEYS = [
  'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
  'HKLM\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
]
const REGISTRY_VIEWS = ['64', '32']

const EXE_NAMES = ['DeepSeek Harness.exe', 'DeepSeekHarness.exe', 'deepseek-harness.exe']
const INSTALL_DIR_NAMES = ['DeepSeek Harness', 'DeepSeekHarness', 'deepseek-harness']
/** A desktop executable must carry the product name; this rejects unrelated .exe files. */
const APP_NAME_PATTERN = /deepseek[\s._-]*harness/i

const COMMAND_TIMEOUT_MS = 10_000
const REGISTRY_TIMEOUT_MS = 8_000
const MAX_BODY_BYTES = 4096
const RESOLUTION_TTL_MS = 60_000

/**
 * Register the two routes, owned by this plugin's fiber.
 * @param ctx - the host plugin context.
 */
export function apply(ctx) {
  const webServer = ctx.webServer
  if (webServer === undefined || typeof webServer.register !== 'function') {
    throw new Error('desktop-autostart: the web server is unavailable in this profile')
  }
  ctx.effect(() => {
    const disposeState = webServer.register({
      kind: 'exact',
      path: STATE_ROUTE,
      handler: (request, response) => {
        void answer(response, request, readState)
      },
    })
    const disposeSet = webServer.register({
      kind: 'exact',
      path: SET_ROUTE,
      handler: (request, response) => {
        void answer(response, request, writeState)
      },
    })
    return () => {
      disposeSet()
      disposeState()
    }
  }, 'desktop-autostart: startup routes')
}

/**
 * Run one request handler and write its JSON envelope.
 * @param response - node:http response.
 * @param request - node:http request.
 * @param handler - method-aware handler returning status and body.
 */
async function answer(response, request, handler) {
  try {
    if (!isLoopback(request)) {
      writeJson(response, request, 403, { ok: false, error: 'loopback-only' })
      return
    }
    const result = await handler(request)
    writeJson(response, request, result.status, result.body)
  } catch (error) {
    writeJson(response, request, 500, { ok: false, error: messageOf(error) })
  }
}

/**
 * Read the current detection and startup state.
 * @param request - node:http request.
 * @returns status and body.
 */
async function readState(request) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    return { status: 405, body: { ok: false, error: 'method-not-allowed' } }
  }
  return { status: 200, body: await snapshot() }
}

/**
 * Turn the startup entry on or off, then report the state Windows holds.
 * @param request - node:http request carrying `{ enabled: boolean }`.
 * @returns status and body.
 */
async function writeState(request) {
  if (request.method !== 'POST') {
    return { status: 405, body: { ok: false, error: 'method-not-allowed' } }
  }
  const body = await readJsonBody(request)
  if (typeof body.enabled !== 'boolean') {
    return { status: 400, body: { ok: false, error: 'invalid-enabled-flag' } }
  }
  try {
    const state = await setEnabled(body.enabled)
    return { status: 200, body: { ok: true, ...state } }
  } catch (error) {
    if (error?.code === 'unsupported') {
      return { status: 409, body: { ok: false, error: 'unsupported', ...(await snapshot()) } }
    }
    if (error instanceof Error && error.message === 'verification-failed') {
      return { status: 500, body: { ok: false, error: 'verification-failed', ...(await snapshot()) } }
    }
    throw error
  }
}

/**
 * Apply the requested startup state and verify Windows now reports it.
 * @param enabled - true to register the app, false to remove the entry.
 * @returns the verified state.
 */
export async function setEnabled(enabled) {
  let target
  if (enabled) {
    target = await resolveExecutable()
    if (target === undefined) {
      const error = new Error('unsupported')
      error.code = 'unsupported'
      throw error
    }
    // `/d` receives one argument holding the quoted path, which is how a value
    // with spaces survives; `/f` overwrites a stale entry silently.
    await reg(['add', RUN_KEY, '/v', VALUE_NAME, '/t', 'REG_SZ', '/d', quoteRunCommand(target.path), '/f'])
  } else {
    await removeRegistration()
  }
  // Clear a previous "disabled" decision from Task Manager, otherwise the
  // value would exist but Windows would still skip it at sign-in.
  await clearApproval()

  const state = await snapshot()
  if (state.enabled !== enabled) throw new Error('verification-failed')
  if (enabled && target !== undefined && !sameCommand(state.command, target.path)) {
    throw new Error('verification-failed')
  }
  return state
}

/**
 * Describe the platform, the launch target, and the entry Windows holds.
 * @returns the state body shared by both routes.
 */
export async function snapshot() {
  const target = await resolveExecutable()
  let registered = false
  let approved = true
  let command
  let error
  if (process.platform === 'win32') {
    try {
      const registration = await readRegistration()
      registered = registration.registered
      approved = registration.approved
      command = registration.command
    } catch (cause) {
      error = messageOf(cause)
    }
  }
  return {
    platform: process.platform,
    supported: target !== undefined,
    appPath: target?.path,
    appPathSource: target?.source,
    unsupportedReason: target === undefined ? unsupportedReason() : undefined,
    registered,
    approved,
    enabled: registered && approved,
    command,
    error,
  }
}

let cachedResolution

/**
 * Find the desktop executable, caching a miss or a hit for a short while.
 * @returns `{ path, source }`, or undefined when nothing plausible is installed.
 */
export async function resolveExecutable() {
  if (cachedResolution !== undefined && Date.now() - cachedResolution.at < RESOLUTION_TTL_MS) {
    return cachedResolution.value
  }
  let value
  for (const probe of [probeRunningApp, probeAppPaths, probeInstallDirs, probeUninstall]) {
    try {
      value = await probe()
    } catch {
      value = undefined
    }
    if (value !== undefined) break
  }
  cachedResolution = { at: Date.now(), value }
  return value
}

/**
 * The running desktop app is the best answer: the shell starts the Host by
 * spawning its own binary in Node mode, so `execPath` is the installed app.
 * @returns a detection result, or undefined for a CLI/Node session.
 */
function probeRunningApp() {
  if (process.platform !== 'win32') return undefined
  const executable = process.execPath
  if (!isRunnableApp(executable)) return undefined
  if (!looksLikeDesktopAppName(basename(executable))) return undefined
  return { path: executable, source: 'running-app' }
}

/**
 * Electron-builder and most Windows installers register the app under the
 * per-machine or per-user `App Paths` key.
 * @returns a detection result, or undefined.
 */
async function probeAppPaths() {
  if (process.platform !== 'win32') return undefined
  for (const key of APP_PATH_KEYS) {
    for (const view of REGISTRY_VIEWS) {
      let values
      try {
        values = parseRegValues(await reg(['query', key, `/reg:${view}`]))
      } catch (error) {
        if (isMissing(error)) continue
        continue
      }
      const fallback = values.find((value) => value.name === '(Default)')
      const candidate = cleanIconPath(fallback?.data)
      if (candidate !== '' && isRunnableApp(candidate) && looksLikeDesktopAppName(basename(candidate))) {
        return { path: candidate, source: 'app-paths' }
      }
    }
  }
  return undefined
}

/**
 * Check the folders a per-user or per-machine install normally uses.
 * @returns a detection result, or undefined.
 */
function probeInstallDirs() {
  if (process.platform !== 'win32') return undefined
  const roots = [
    process.env.LOCALAPPDATA === undefined ? undefined : join(process.env.LOCALAPPDATA, 'Programs'),
    process.env.LOCALAPPDATA,
    process.env.ProgramFiles,
    process.env['ProgramFiles(x86)'],
  ]
  for (const root of roots) {
    if (root === undefined || root === '') continue
    for (const directory of INSTALL_DIR_NAMES) {
      for (const executable of EXE_NAMES) {
        const candidate = join(root, directory, executable)
        if (isRunnableApp(candidate)) return { path: candidate, source: 'install-dir' }
      }
    }
  }
  return undefined
}

/**
 * The installer's uninstall record names the display icon, install folder, or
 * uninstaller next to the app. This is the fallback for custom install paths.
 * @returns a detection result, or undefined.
 */
async function probeUninstall() {
  if (process.platform !== 'win32') return undefined
  for (const key of UNINSTALL_KEYS) {
    for (const view of REGISTRY_VIEWS) {
      let listing
      try {
        listing = await reg(['query', key, '/s', '/v', 'DisplayName', `/reg:${view}`])
      } catch {
        continue
      }
      for (const block of splitRegBlocks(listing)) {
        const displayName = block.values.find((value) => value.name === 'DisplayName')?.data
        if (displayName === undefined || !APP_NAME_PATTERN.test(displayName)) continue
        let values
        try {
          values = parseRegValues(await reg(['query', block.key, `/reg:${view}`]))
        } catch {
          continue
        }
        const candidate = executableFromUninstall(values)
        if (candidate !== undefined) return { path: candidate, source: 'uninstall' }
      }
    }
  }
  return undefined
}

/**
 * Pick an executable out of one uninstall record.
 * @param values - the record's registry values.
 * @returns an existing executable path, or undefined.
 */
function executableFromUninstall(values) {
  const icon = cleanIconPath(values.find((value) => value.name === 'DisplayIcon')?.data)
  if (isRunnableApp(icon)) return icon

  const location = expandEnv(values.find((value) => value.name === 'InstallLocation')?.data)
  if (location !== '') {
    for (const executable of EXE_NAMES) {
      const candidate = join(location, executable)
      if (isRunnableApp(candidate)) return candidate
    }
  }

  const uninstaller = quotedPath(values.find((value) => value.name === 'UninstallString')?.data)
  if (uninstaller !== undefined) {
    for (const executable of EXE_NAMES) {
      const candidate = join(dirname(uninstaller), executable)
      if (isRunnableApp(candidate)) return candidate
    }
  }
  return undefined
}

/**
 * Why {@link resolveExecutable} returned undefined.
 * @returns a stable reason code the page localizes.
 */
function unsupportedReason() {
  if (process.platform !== 'win32') return 'platform'
  return 'not-found'
}

/**
 * Read the startup value and Task Manager's approval flag.
 * @returns whether the entry exists, the command it runs, and whether it is approved.
 */
async function readRegistration() {
  let values
  try {
    values = parseRegValues(await reg(['query', RUN_KEY]))
  } catch (error) {
    if (isMissing(error)) return { registered: false, approved: true, command: undefined }
    throw error
  }
  const entry = values.find((value) => value.name.toLowerCase() === VALUE_NAME.toLowerCase())
  const registered = entry !== undefined
  return {
    registered,
    command: entry?.data,
    approved: registered ? await readApproval() : true,
  }
}

/**
 * Whether Task Manager has disabled the startup entry.
 * @returns true when the entry is approved (or has no approval record).
 */
async function readApproval() {
  let values
  try {
    values = parseRegValues(await reg(['query', APPROVED_KEY]))
  } catch (error) {
    if (isMissing(error)) return true
    throw error
  }
  const record = values.find((value) => value.name.toLowerCase() === VALUE_NAME.toLowerCase())
  if (record === undefined) return true
  return !isDisabledApproval(record.data)
}

/**
 * Delete the startup value.
 */
async function removeRegistration() {
  try {
    await reg(['delete', RUN_KEY, '/v', VALUE_NAME, '/f'])
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
}

/**
 * Delete Task Manager's approval record, so the next sign-in uses the entry.
 */
async function clearApproval() {
  try {
    await reg(['delete', APPROVED_KEY, '/v', VALUE_NAME, '/f'])
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
}

/**
 * Run `reg.exe` and return its decoded text output.
 * @param args - arguments for `reg.exe`.
 * @returns command output.
 */
async function reg(args) {
  const { stdout } = await runCommand('reg.exe', args, {
    encoding: 'buffer',
    windowsHide: true,
    timeout: REGISTRY_TIMEOUT_MS,
    maxBuffer: 8 * 1024 * 1024,
  })
  return decodeRegOutput(stdout)
}

/**
 * Decode `reg.exe` output. Redirected console output uses the console code
 * page, which is GBK on Chinese Windows; valid UTF-8 wins, otherwise fall back.
 * @param bytes - raw command output.
 * @returns decoded text.
 */
export function decodeRegOutput(bytes) {
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes ?? '')
  if (buffer.length === 0) return ''
  const utf8 = new TextDecoder('utf-8').decode(buffer)
  if (!utf8.includes('\uFFFD')) return utf8
  try {
    return new TextDecoder('gbk').decode(buffer)
  } catch {
    return utf8
  }
}

/**
 * Parse every `name  REG_TYPE  data` line out of `reg query` output.
 * @param stdout - command output.
 * @returns the values found.
 */
export function parseRegValues(stdout) {
  const values = []
  for (const line of String(stdout).split(/\r?\n/)) {
    const value = parseRegValueLine(line)
    if (value !== undefined) values.push(value)
  }
  return values
}

const REG_VALUE_LINE = /^\s{2,}(.+?)\s{2,}(REG_[A-Z_]+)(?:\s{2,}(.*))?$/

/**
 * Parse one registry value line.
 * @param line - a line of `reg query` output.
 * @returns the value, or undefined for headers and blank lines.
 */
function parseRegValueLine(line) {
  const match = REG_VALUE_LINE.exec(line)
  if (match === null) return undefined
  return { name: match[1].trim(), type: match[2], data: (match[3] ?? '').trim() }
}

/**
 * Split `reg query /s` output into key blocks, each with its own values.
 * @param stdout - command output.
 * @returns one block per registry key.
 */
export function splitRegBlocks(stdout) {
  const blocks = []
  let current
  for (const line of String(stdout).split(/\r?\n/)) {
    if (/^HKEY_/i.test(line)) {
      current = { key: line.trim(), values: [] }
      blocks.push(current)
      continue
    }
    if (current === undefined) continue
    const value = parseRegValueLine(line)
    if (value !== undefined) current.values.push(value)
  }
  return blocks
}

/**
 * Expand `%VAR%` references in registry data.
 * @param value - raw registry data.
 * @returns the expanded string (unknown variables are left alone).
 */
export function expandEnv(value) {
  return String(value ?? '').replace(/%([^%]+)%/g, (whole, name) => {
    const replacement = process.env[name]
    return typeof replacement === 'string' ? replacement : whole
  })
}

/**
 * Reduce a `DisplayIcon` value to a file path.
 * @param value - raw registry data, possibly quoted and followed by an icon index.
 * @returns a plain path, or an empty string.
 */
export function cleanIconPath(value) {
  let text = expandEnv(String(value ?? '').trim())
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1)
    if (end > 0) return text.slice(1, end)
  }
  text = text.replace(/,\s*-?\d+\s*$/, '').trim()
  return text.replace(/^"|"$/g, '')
}

/**
 * Extract the quoted (or first) executable path from an uninstall command.
 * @param value - raw `UninstallString` data.
 * @returns the executable path, or undefined.
 */
function quotedPath(value) {
  const text = String(value ?? '').trim()
  if (text === '') return undefined
  if (text.startsWith('"')) {
    const end = text.indexOf('"', 1)
    if (end > 0) return text.slice(1, end)
  }
  const match = /^(.+?\.exe)(?:\s|$)/i.exec(text)
  return match?.[1]
}

/**
 * Whether a path names the DeepSeek Harness desktop executable.
 * @param name - a file name.
 * @returns true for the product name.
 */
export function looksLikeDesktopAppName(name) {
  return APP_NAME_PATTERN.test(String(name ?? ''))
}

/**
 * Whether a path is an existing, launchable application executable.
 * @param path - a candidate path.
 * @returns true for a real `.exe` that is not node, Electron, or an uninstaller.
 */
export function isRunnableApp(path) {
  if (typeof path !== 'string' || path.trim() === '') return false
  const cleaned = path.trim()
  if (!/\.exe$/i.test(cleaned)) return false
  const name = basename(cleaned)
  if (/^(node|electron)(\.exe)?$/i.test(name)) return false
  if (/unins|uninstall/i.test(name)) return false
  try {
    return existsSync(cleaned)
  } catch {
    return false
  }
}

/**
 * The exact command Windows runs at sign-in.
 * @param path - executable path.
 * @returns the quoted command line.
 */
export function quoteRunCommand(path) {
  return `"${path}"`
}

/**
 * Whether stored command data points at the given executable.
 * @param command - registry data.
 * @param path - executable path.
 * @returns true when both name the same file.
 */
function sameCommand(command, path) {
  const cleaned = String(command ?? '')
    .trim()
    .replace(/^"|"$/g, '')
  return cleaned.toLowerCase() === path.toLowerCase()
}

/**
 * Whether a `reg` failure means "value or key absent".
 * @param error - a failed execFile error.
 * @returns true for the not-found exit path.
 */
function isMissing(error) {
  if (error === null || typeof error !== 'object') return false
  if (error.code === 1) return true
  const text = [error.stderr, error.stdout, error.message]
    .map((part) => {
      if (typeof part === 'string') return part
      if (Buffer.isBuffer(part)) return decodeRegOutput(part)
      return ''
    })
    .join(' ')
  return /unable to find|cannot find|找不到/i.test(text)
}

/**
 * Whether Task Manager's binary record marks the entry disabled.
 * Enabled records start `02`/`06`, disabled ones `03`/`07`.
 * @param data - hex bytes from `StartupApproved`.
 * @returns true when the entry is disabled.
 */
export function isDisabledApproval(data) {
  const first = String(data ?? '').trim().split(/\s+/)[0]
  if (first === undefined) return false
  const byte = Number.parseInt(first, 16)
  if (!Number.isFinite(byte)) return false
  return (byte & 1) === 1
}

/**
 * Read a small JSON request body.
 * @param request - node:http request.
 * @returns the parsed body.
 */
function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = []
    let size = 0
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > MAX_BODY_BYTES) {
        reject(new Error('body-too-large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) {
        resolve({})
        return
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error('invalid-json'))
      }
    })
    request.on('error', reject)
  })
}

/**
 * Only the local page may read or change a startup entry.
 * @param request - node:http request.
 * @returns true for a loopback peer.
 */
function isLoopback(request) {
  const address = request.socket?.remoteAddress ?? ''
  return address === '::1' || address.startsWith('127.') || address.startsWith('::ffff:127.')
}

/**
 * Write a JSON response; a HEAD request carries no body.
 * @param response - node:http response.
 * @param request - node:http request.
 * @param status - HTTP status.
 * @param body - JSON-serializable body.
 */
function writeJson(response, request, status, body) {
  if (response.headersSent) return
  const payload = Buffer.from(JSON.stringify(body), 'utf8')
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(payload.byteLength),
    'cache-control': 'no-store',
  })
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  response.end(payload)
}

/**
 * Message text from an unknown thrown value.
 * @param error - thrown value.
 * @returns message text.
 */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}
