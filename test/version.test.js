import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { isSupportedNodeVersion, MIN_NODE_VERSION, VERSION } from '../src/version.js'

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))

test('VERSION matches package.json', () => {
  assert.equal(VERSION, pkg.version)
})

test('MIN_NODE_VERSION matches package.json engines', () => {
  assert.equal(pkg.engines.node, `>=${MIN_NODE_VERSION}`)
})

test('accepts only Node.js versions from MIN_NODE_VERSION on', () => {
  for (const version of ['26.12.1', '26.13.0', '27.0.0', '28.1.0']) {
    assert.equal(isSupportedNodeVersion(version), true, version)
  }
  for (const version of ['20.18.2', '24.22.2', '26.12.0', '26.3.1']) {
    assert.equal(isSupportedNodeVersion(version), false, version)
  }
})
