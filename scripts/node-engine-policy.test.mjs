import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import semver from 'semver'
import { parse } from 'yaml'

const manifests = [
  'package.json',
  'native/landlock-run/packages/entry/package.json',
  'native/landlock-run/packages/linux-arm64/package.json',
  'native/landlock-run/packages/linux-x64/package.json',
]
const vulnerable = ['18.20.8', '20.20.0', '22.23.3', '24.0.0', '24.22.0', '25.9.0', '26.0.0', '26.12.0', '27.0.0']
const patched = ['22.23.4', '24.22.1', '24.22.2', '26.12.1', '26.13.0']

test('pnpm 11 enforces the Node engine floor', () => {
  const config = parse(readFileSync(new URL('../pnpm-workspace.yaml', import.meta.url), 'utf8'))
  assert.equal(config.engineStrict, true)
})

for (const path of manifests) {
  test(`${path} admits patched supported branches and rejects vulnerable or unverified branches`, () => {
    const { engines } = JSON.parse(readFileSync(new URL(`../${path}`, import.meta.url), 'utf8'))
    for (const version of vulnerable) assert.equal(semver.satisfies(version, engines.node), false, version)
    for (const version of patched) assert.equal(semver.satisfies(version, engines.node), true, version)
  })
}
