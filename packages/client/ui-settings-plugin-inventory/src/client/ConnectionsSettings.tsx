/** Native MCP connection form and management controls. */
import { useEffect, useState } from 'react'
import type { ConnectionInput, ConnectionView, SignInRequest, SignInResult } from '@workspacealberta/wa-mcp-connections/types'
import type { InjectFace, PropsLocale, PropsRuntime } from '@workspacealberta/wa-client-ui-slots'
import css from './ConnectionsSettings.module.css'

/** Operations supplied by the authenticated Host Remote. */
export interface ConnectionsOperations {
  list: () => Promise<ConnectionView[]>
  save: (value: ConnectionInput) => Promise<void>
  remove: (id: string) => Promise<void>
  reconnect: (id: string) => Promise<void>
  disconnect: (id: string) => Promise<void>
  signIn: (value: SignInRequest) => Promise<SignInResult>
}
/** Component inputs; no credentials enter the browser form. */
export type ConnectionsSettingsProps = PropsRuntime<'settings.section'> & PropsLocale<'settings.connections'> & InjectFace<{ operations: ConnectionsOperations }>
const blank: ConnectionInput = { name: '', transport: 'streamable-http', url: '', command: '', args: [], envRefs: {}, enabled: true, oauth: true }

/** Display saved servers and add/edit a connection without a vendor catalog. */
export function ConnectionsSettings({ operations, t }: ConnectionsSettingsProps) {
  const [rows, setRows] = useState<ConnectionView[]>([])
  const [draft, setDraft] = useState<ConnectionInput | null>(null)
  const [args, setArgs] = useState('[]')
  const [envRefs, setEnvRefs] = useState('{}')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const refresh = async () => { setRows(await operations.list()) }
  useEffect(() => {
    let active = true
    const read = () => { void operations.list().then((value) => { if (active) setRows(value) }, () => { if (active) setError(t('loadError')) }) }
    read()
    const timer = setInterval(read, 3000)
    return () => { active = false; clearInterval(timer) }
  }, [operations, t])
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError('')
    try { await action(); await refresh() }
    catch (failure) { setError(failure instanceof Error ? failure.message : t('operationError')) }
    finally { setBusy(false) }
  }
  const edit = (row: ConnectionInput) => {
    setDraft({ ...row }); setArgs(JSON.stringify(row.args)); setEnvRefs(JSON.stringify(row.envRefs))
  }
  return (
    <section className={css.section} aria-label={t('title')}>
      <h2>{t('title')}</h2>
      <p>{t('intro')}</p>
      {error && <p role="alert" className={css.error}>{error}</p>}
      <button type="button" onClick={() =>{  edit(blank) }} disabled={busy}>{t('add')}</button>
      {draft && <form className={css.form} onSubmit={(event) => {
        event.preventDefault()
        void run(async () => {
          const parsedArgs: unknown = JSON.parse(args)
          const parsedRefs: unknown = JSON.parse(envRefs)
          if (!Array.isArray(parsedArgs) || parsedArgs.some(value => typeof value !== 'string')) throw new Error(t('argsError'))
          if (typeof parsedRefs !== 'object' || parsedRefs === null || Array.isArray(parsedRefs)
            || Object.values(parsedRefs).some(value => typeof value !== 'string')) throw new Error(t('envError'))
          const argumentsList: string[] = []
          for (const value of parsedArgs) if (typeof value === 'string') argumentsList.push(value)
          const refs: Record<string, string> = {}
          for (const [key, value] of Object.entries(parsedRefs)) if (typeof value === 'string') refs[key] = value
          await operations.save({ ...draft, args: argumentsList, envRefs: refs })
          setDraft(null)
        })
      }}>
        <label>{t('name')}<input value={draft.name} required maxLength={120} onChange={(event) =>{  setDraft({ ...draft, name: event.target.value }) }} /></label>
        <label>{t('transport')}<select value={draft.transport} onChange={(event) =>{  setDraft({ ...draft, transport: event.target.value === 'stdio' ? 'stdio' : 'streamable-http', oauth: event.target.value !== 'stdio' }) }}>
          <option value="streamable-http">{t('remote')}</option><option value="stdio">{t('local')}</option>
        </select></label>
        {draft.transport === 'streamable-http' ? <>
          <label>{t('url')}<input type="url" value={draft.url} required onChange={(event) =>{  setDraft({ ...draft, url: event.target.value }) }} /></label>
          <label><input type="checkbox" checked={draft.oauth} onChange={(event) =>{  setDraft({ ...draft, oauth: event.target.checked }) }} />{t('oauth')}</label>
        </> : <>
          <label>{t('command')}<input value={draft.command} required onChange={(event) =>{  setDraft({ ...draft, command: event.target.value }) }} /></label>
          <label>{t('args')}<textarea value={args} onChange={(event) =>{  setArgs(event.target.value) }} /></label>
          <label>{t('env')}<textarea value={envRefs} onChange={(event) =>{  setEnvRefs(event.target.value) }} /></label>
          <p>{t('envHelp')}</p>
        </>}
        <label><input type="checkbox" checked={draft.enabled} onChange={(event) =>{  setDraft({ ...draft, enabled: event.target.checked }) }} />{t('enabled')}</label>
        <div className={css.actions}><button type="submit" disabled={busy}>{t('save')}</button><button type="button" disabled={busy} onClick={() =>{  setDraft(null) }}>{t('cancel')}</button></div>
      </form>}
      {rows.length === 0 && <p>{t('empty')}</p>}
      <ul className={css.list}>{rows.map(row => <li key={row.id} className={css.card}>
        <strong>{row.name}</strong><p>{row.transport === 'stdio' ? row.command : row.url}</p>
        <p role="status">{t(row.status)}</p>
        <div className={css.actions}>
          <button type="button" disabled={busy} onClick={() =>{  edit(row) }}>{t('edit')}</button>
          <button type="button" disabled={busy} onClick={() => { void run(() => operations.save({ ...row, enabled: !row.enabled })) }}>{t(row.enabled ? 'disable' : 'enable')}</button>
          <button type="button" disabled={busy || !row.enabled} onClick={() => { void run(() => operations.reconnect(row.id)) }}>{t('reconnect')}</button>
          {row.oauth && <button type="button" disabled={busy || !row.enabled} onClick={() => {
            const popup = window.open('about:blank', '_blank')
            void run(async () => {
              try {
                const result = await operations.signIn({ id: row.id, origin: window.location.origin })
                if (result.authorizationUrl) {
                  if (popup) { popup.opener = null; popup.location.href = result.authorizationUrl }
                  else window.location.assign(result.authorizationUrl)
                } else popup?.close()
              } catch (failure) { popup?.close(); throw failure }
            })
          }}>{t('signIn')}</button>}
          {(row.signedIn || (row.oauth && row.status === 'failed')) && <button type="button" disabled={busy} onClick={() => { void run(() => operations.disconnect(row.id)) }}>{t('signOut')}</button>}
          <button type="button" disabled={busy} onClick={() => {
            if (window.confirm(t('removeConfirm'))) void run(() => operations.remove(row.id))
          }}>{t('remove')}</button>
        </div>
      </li>)}</ul>
    </section>
  )
}
