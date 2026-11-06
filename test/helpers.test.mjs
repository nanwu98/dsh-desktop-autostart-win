import assert from 'node:assert/strict'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  cleanIconPath,
  decodeRegOutput,
  expandEnv,
  isDisabledApproval,
  isRunnableApp,
  looksLikeDesktopAppName,
  parseRegValues,
  quoteRunCommand,
  splitRegBlocks,
} from '../index.js'

const here = fileURLToPath(new URL('.', import.meta.url))

test('parseRegValues reads named and default values', () => {
  const output = [
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Run',
    '    DeepSeek Harness    REG_SZ    "C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe"',
    '    Other value    REG_SZ    a value with spaces',
    '    (Default)    REG_SZ    C:\\Apps\\DeepSeek Harness.exe',
    '',
  ].join('\r\n')

  const values = parseRegValues(output)
  assert.equal(values.length, 3)
  assert.deepEqual(values[0], {
    name: 'DeepSeek Harness',
    type: 'REG_SZ',
    data: '"C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe"',
  })
  assert.equal(values[1].name, 'Other value')
  assert.equal(values[1].data, 'a value with spaces')
  assert.equal(values[2].name, '(Default)')
})

test('splitRegBlocks keeps each key together with its values', () => {
  const output = [
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\A',
    '    DisplayName    REG_SZ    DeepSeek Harness',
    '    InstallLocation    REG_SZ    C:\\Apps\\DeepSeek Harness',
    '',
    'HKEY_CURRENT_USER\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\B',
    '    DisplayName    REG_SZ    Something Else',
    '',
  ].join('\r\n')

  const blocks = splitRegBlocks(output)
  assert.equal(blocks.length, 2)
  assert.equal(blocks[0].values.length, 2)
  assert.equal(blocks[0].values[0].data, 'DeepSeek Harness')
  assert.equal(blocks[1].values[0].data, 'Something Else')
})

test('decodeRegOutput prefers UTF-8 and falls back to GBK', () => {
  assert.equal(decodeRegOutput(Buffer.from('C:\\Apps\\DeepSeek Harness.exe', 'utf8')), 'C:\\Apps\\DeepSeek Harness.exe')
  assert.equal(decodeRegOutput(Buffer.from('C:\\用户\\应用.exe', 'utf8')), 'C:\\用户\\应用.exe')
  assert.equal(decodeRegOutput(Buffer.from([0xd3, 0xc3, 0xbb, 0xa7])), '用户')
  assert.equal(decodeRegOutput(Buffer.alloc(0)), '')
})

test('expandEnv resolves known variables and leaves unknown ones alone', () => {
  process.env.DSH_TEST_ROOT = 'C:\\Root'
  try {
    assert.equal(expandEnv('%DSH_TEST_ROOT%\\App\\app.exe'), 'C:\\Root\\App\\app.exe')
    assert.equal(expandEnv('%DSH_TEST_MISSING%\\app.exe'), '%DSH_TEST_MISSING%\\app.exe')
  } finally {
    delete process.env.DSH_TEST_ROOT
  }
})

test('cleanIconPath strips quotes, icon indexes, and expands variables', () => {
  process.env.DSH_TEST_ROOT = 'C:\\Root'
  try {
    assert.equal(
      cleanIconPath('"C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe",0'),
      'C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe',
    )
    assert.equal(cleanIconPath('C:\\Apps\\app.exe,0'), 'C:\\Apps\\app.exe')
    assert.equal(cleanIconPath('%DSH_TEST_ROOT%\\app.exe'), 'C:\\Root\\app.exe')
    assert.equal(cleanIconPath(undefined), '')
  } finally {
    delete process.env.DSH_TEST_ROOT
  }
})

test('looksLikeDesktopAppName accepts the product and rejects other programs', () => {
  assert.equal(looksLikeDesktopAppName('DeepSeek Harness.exe'), true)
  assert.equal(looksLikeDesktopAppName('deepseek-harness.exe'), true)
  assert.equal(looksLikeDesktopAppName('DeepSeekHarness.exe'), true)
  assert.equal(looksLikeDesktopAppName('node.exe'), false)
  assert.equal(looksLikeDesktopAppName('chrome.exe'), false)
})

test('isRunnableApp requires a real .exe that is not node, Electron, or an uninstaller', () => {
  const directory = join(here, '.tmp')
  mkdirSync(directory, { recursive: true })
  const app = join(directory, 'DeepSeek Harness.exe')
  writeFileSync(app, '')
  try {
    assert.equal(isRunnableApp(app), true)
    assert.equal(isRunnableApp(join(directory, 'missing.exe')), false)
    assert.equal(isRunnableApp(join(directory, 'node.exe')), false)
    assert.equal(isRunnableApp(join(directory, 'Uninstall DeepSeek Harness.exe')), false)
    assert.equal(isRunnableApp(app.replace(/\.exe$/, '.dll')), false)
    assert.equal(isRunnableApp(''), false)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})

test('isDisabledApproval reads Task Manager approval bytes', () => {
  assert.equal(isDisabledApproval('03 00 00 00 00 00 00 00 00 00 00 00'), true)
  assert.equal(isDisabledApproval('07 00 00 00 00 00 00 00'), true)
  assert.equal(isDisabledApproval('02 00 00 00 00 00 00 00 00 00 00 00'), false)
  assert.equal(isDisabledApproval('06 00 00 00 00 00 00 00'), false)
  assert.equal(isDisabledApproval(undefined), false)
  assert.equal(isDisabledApproval(''), false)
})

test('quoteRunCommand produces one quoted argument', () => {
  assert.equal(quoteRunCommand('C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe'), '"C:\\Program Files\\DeepSeek Harness\\DeepSeek Harness.exe"')
})
