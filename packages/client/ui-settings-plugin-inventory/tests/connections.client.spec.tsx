// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { registerDomSnapshotSerializer } from '@workspacealberta/wa-client-test-runtime'
import { ConnectionsSettings, type ConnectionsOperations, type ConnectionsSettingsProps } from '../src/client/ConnectionsSettings.tsx'
import { connectionEn } from '../src/client/connections-locales.ts'
import type { ConnectionInput, ConnectionView } from '@workspacealberta/wa-mcp-connections/types'
registerDomSnapshotSerializer()
afterEach(() => { cleanup(); vi.restoreAllMocks() })
function bench(initial: ConnectionView[] = []) {
  let rows = initial
  const operations: ConnectionsOperations = {
    list: vi.fn(async () => rows),
    save: vi.fn<ConnectionsOperations['save']>(async (input) => { const row = { ...input, id: input.id ?? 'new', status: 'sign-in-required', signedIn: false } satisfies ConnectionView; rows = [...rows.filter(value => value.id !== row.id), row] }),
    remove: vi.fn<ConnectionsOperations['remove']>(async (id) => { rows = rows.filter(value => value.id !== id) }),
    reconnect: vi.fn(async () => {}), disconnect: vi.fn(async () => {}),
    signIn: vi.fn(async () => ({ authorizationUrl: 'https://issuer.example.test/authorize' })),
  }
  const t: ConnectionsSettingsProps['t'] = key => key in connectionEn ? connectionEn[key as keyof typeof connectionEn] : key
  return { operations, props: { operations, t } as ConnectionsSettingsProps }
}
describe('Connections Settings', () => {
  it('adds a remote OAuth server from the form and shows the supported management actions', async () => {
    const b = bench(); const view = render(<ConnectionsSettings {...b.props} />)
    await screen.findByText('No connections added yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Business tools' } })
    fireEvent.change(screen.getByLabelText('Server URL'), { target: { value: 'https://mcp.example.test/mcp' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Business tools')
    expect(b.operations.save).toHaveBeenCalledWith(expect.objectContaining({ name: 'Business tools', url: 'https://mcp.example.test/mcp', oauth: true }))
    expect(view.container).toMatchSnapshot()
    fireEvent.click(screen.getByRole('button', { name: 'Disable' }))
    await waitFor(() =>{  expect(b.operations.save).toHaveBeenLastCalledWith(expect.objectContaining({ enabled: false })) })
  })
  it('adds a local command with arguments and rejects malformed credential references', async () => {
    const b = bench(); render(<ConnectionsSettings {...b.props} />)
    fireEvent.click(screen.getByRole('button', { name: 'Add connection' }))
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Local tools' } })
    fireEvent.change(screen.getByLabelText('Connection type'), { target: { value: 'stdio' } })
    fireEvent.change(screen.getByLabelText('Command'), { target: { value: 'node' } })
    fireEvent.change(screen.getByLabelText('Arguments (JSON array)'), { target: { value: '["server.js"]' } })
    fireEvent.change(screen.getByLabelText('Credential references (JSON object)'), { target: { value: '{"KEY":123}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByRole('alert'); expect(b.operations.save).not.toHaveBeenCalled()
    fireEvent.change(screen.getByLabelText('Credential references (JSON object)'), { target: { value: '{"KEY":"BUSINESS_KEY"}' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await screen.findByText('Local tools')
    expect(b.operations.save).toHaveBeenCalledWith(expect.objectContaining({ command: 'node', args: ['server.js'], envRefs: { KEY: 'BUSINESS_KEY' }, oauth: false }))
  })
  it('opens the authorization page returned by the host and removes a connection', async () => {
    const initial: ConnectionInput = { id: 'one', name: 'Protected tools', transport: 'streamable-http', url: 'https://mcp.example.test/mcp', command: '', args: [], envRefs: {}, enabled: true, oauth: true }
    const b = bench([{ ...initial, id: 'one', status: 'sign-in-required', signedIn: false }])
    const popupLocation = { href: '' }
    const popup = new Proxy(window, {
      get(target, key, receiver): unknown { return key === 'location' ? popupLocation : Reflect.get(target, key, receiver) },
      set(target, key, value, receiver) { return key === 'opener' || Reflect.set(target, key, value, receiver) },
    })
    vi.spyOn(window, 'open').mockReturnValue(popup)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<ConnectionsSettings {...b.props} />)
    await screen.findByText('Protected tools')
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }))
    await waitFor(() =>{  expect(popupLocation.href).toBe('https://issuer.example.test/authorize') })
    await waitFor(() =>{  expect(screen.getByRole('button', { name: 'Remove' }).hasAttribute('disabled')).toBe(false) })
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }))
    await screen.findByText('No connections added yet.')
    expect(b.operations.remove).toHaveBeenCalledWith('one')
  })
})
