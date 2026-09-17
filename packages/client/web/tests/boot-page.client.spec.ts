// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { BootPage } from '../src/boot-page.ts'

afterEach(() => { document.body.innerHTML = '' })

function mount() {
  const el = document.createElement('div')
  document.body.append(el)
  return { el, page: new BootPage(el) }
}

describe('BootPage', () => {
  it('attaches nothing while boot has not failed', () => {
    const { el } = mount()
    expect(el.childNodes).toHaveLength(0)
  })

  it('stays detached while entries are active or loading', () => {
    const { el, page } = mount()
    page.setTotal(2)
    page.setState('a', 'active')
    page.setState('b', 'loading')
    page.setState('b', 'active')
    expect(el.childNodes).toHaveLength(0)
  })

  it('lists failed entries de-scoped: npm scopes never reach the user', () => {
    const { el, page } = mount()
    page.setState('@workspacealberta/wa-client-ui-layout', 'failed')
    page.setState('ok', 'active')
    page.setState('@workspacealberta/wa-client-ui-tool', 'failed')
    expect(el.firstElementChild?.getAttribute('data-dsh-boot')).toBe('')
    expect(el.textContent).toContain('Failed to load plugins')
    expect(el.textContent).toContain('dsh-client-ui-layout')
    expect(el.textContent).toContain('dsh-client-ui-tool')
    expect(el.textContent).not.toContain('@workspacealberta')
    expect(el.textContent).not.toContain('ok')
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('shows the complete sweep report', () => {
    const { el, page } = mount()
    const report = 'web boot: 1 entry did not activate\nx: pending (waiting for service: y)'
    page.fail(report)
    page.setState('a', 'active')
    expect(el.textContent).toContain(report)
    expect(el.textContent).not.toContain('Loading plugins…')
  })

  it('strips npm scopes from free-text failure reports', () => {
    const { el, page } = mount()
    page.fail('web boot: 1 entry did not activate\n@workspacealberta/wa-client-runtime: import failed')
    expect(el.textContent).toContain('dsh-client-runtime: import failed')
    expect(el.textContent).not.toContain('@workspacealberta')
  })

  it('detaches on disposal', () => {
    const { el, page } = mount()
    page.fail('boom')
    page.dispose()
    expect(el.childNodes).toHaveLength(0)
  })
})
