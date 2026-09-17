import { describe, expect, it } from 'vitest'
import type { NpmPackageLock, RegistryIndex } from './benchmark-npm-resolution.ts'
import {
  assertDualDshInstallLayout,
  buildDualDshRegistry,
} from './verify-npm-install-layout.ts'

function validLayout(): NpmPackageLock {
  return {
    lockfileVersion: 3,
    packages: {
      '': { dependencies: { '@workspacealberta/wa': '0.2.0', 'dsh-previous': 'npm:@workspacealberta/wa@0.1.0' } },
      'node_modules/@workspacealberta/cordis': { version: '4.0.1' },
      'node_modules/@workspacealberta/wa': {
        version: '0.2.0',
        dependencies: { '@workspacealberta/wa-child': '^0.2.0' },
        peerDependencies: { '@workspacealberta/cordis': '^4.0.1' },
      },
      'node_modules/@workspacealberta/wa-child': {
        version: '0.2.0',
        dependencies: { '@workspacealberta/wa-leaf': '^0.2.0' },
      },
      'node_modules/@workspacealberta/wa-leaf': { version: '0.2.0' },
      'node_modules/dsh-previous': {
        name: '@workspacealberta/wa',
        version: '0.1.0',
        dependencies: { '@workspacealberta/wa-child': '^0.1.0' },
        peerDependencies: { '@workspacealberta/cordis': '^4.0.1' },
      },
      'node_modules/dsh-previous/node_modules/@workspacealberta/wa-child': {
        version: '0.1.0',
        dependencies: { '@workspacealberta/wa-leaf': '^0.1.0' },
      },
      'node_modules/dsh-previous/node_modules/@workspacealberta/wa-leaf': { version: '0.1.0' },
    },
  }
}

describe('npm install layout verifier', () => {
  it('creates two incompatible versions of every DSH package', () => {
    const index: RegistryIndex = new Map([
      ['@workspacealberta/wa', new Map([['0.1.1-rc.2', {
        name: '@workspacealberta/wa',
        version: '0.1.1-rc.2',
        dependencies: { '@workspacealberta/wa-child': '^0.1.1-rc.2' },
        peerDependencies: { '@workspacealberta/cordis': '^4.0.1' },
      }]])],
      ['@workspacealberta/wa-child', new Map([['0.1.1-rc.2', {
        name: '@workspacealberta/wa-child',
        version: '0.1.1-rc.2',
      }]])],
      ['@workspacealberta/cordis', new Map([['4.0.1', {
        name: '@workspacealberta/cordis',
        version: '4.0.1',
      }]])],
    ])

    const dual = buildDualDshRegistry(index, '0.1.1-rc.2')

    expect([...dual.get('@workspacealberta/wa')?.keys() ?? []]).toEqual(['0.1.0', '0.2.0'])
    expect(dual.get('@workspacealberta/wa')?.get('0.1.0')).toMatchObject({
      version: '0.1.0',
      dependencies: { '@workspacealberta/wa-child': '^0.1.0' },
      peerDependencies: { '@workspacealberta/cordis': '^4.0.1' },
    })
    expect(dual.get('@workspacealberta/wa')?.get('0.2.0')).toMatchObject({
      version: '0.2.0',
      dependencies: { '@workspacealberta/wa-child': '^0.2.0' },
    })
    expect(dual.get('@workspacealberta/cordis')).toBe(index.get('@workspacealberta/cordis'))
  })

  it('accepts isolated DSH releases with one shared Cordis installation', () => {
    expect(assertDualDshInstallLayout(validLayout())).toEqual({
      dshPackagesPerVersion: 3,
      checkedDshEdges: 4,
    })
  })

  it('rejects an internal edge that crosses release versions', () => {
    const layout = validLayout()
    const packages = { ...layout.packages }
    Reflect.deleteProperty(packages, 'node_modules/dsh-previous/node_modules/@workspacealberta/wa-leaf')

    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      'node_modules/dsh-previous/node_modules/@workspacealberta/wa-child: dependencies '
      + '@workspacealberta/wa-leaf resolves to node_modules/@workspacealberta/wa-leaf@0.2.0, expected 0.1.0',
    )
  })

  it('rejects a second Cordis installation', () => {
    const layout = validLayout()
    const packages = {
      ...layout.packages,
      'node_modules/dsh-previous/node_modules/@workspacealberta/cordis': { version: '4.0.1' },
    }

    expect(() => assertDualDshInstallLayout({ ...layout, packages })).toThrow(
      'expected one shared @workspacealberta/cordis',
    )
  })
})
