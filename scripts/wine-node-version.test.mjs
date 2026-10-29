import assert from 'node:assert/strict'
import test from 'node:test'
import { resolveWineNodeVersion } from './wine-node-version.mjs'

test('an exact patched Node pin resolves without a release index or an older cached major', () => {
  assert.equal(resolveWineNodeVersion('24.22.2'), 'v24.22.2')
  assert.equal(resolveWineNodeVersion('22.23.4', [{ version: 'v22.23.3' }]), 'v22.23.4')
})

test('a major selector resolves only that major from the newest-first release index', () => {
  const releases = [{ version: 'v26.13.0' }, { version: 'v240.0.0' }, { version: 'v24.22.2' }, { version: 'v24.22.1' }]
  assert.equal(resolveWineNodeVersion('24', releases), 'v24.22.2')
  assert.equal(resolveWineNodeVersion('22', releases), undefined)
})

test('invalid selectors cannot become archive paths or partial-version matches', () => {
  for (const selector of ['24.22', '../24', '24;echo', 'v24.22.2', '']) {
    assert.throws(() => resolveWineNodeVersion(selector), /Invalid Wine Node version selector/u)
  }
})
