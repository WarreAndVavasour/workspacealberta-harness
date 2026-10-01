// Synthetic CLI peer: exercises the real subprocess protocol without accounts or real credentials.
import { appendFileSync, readFileSync } from 'node:fs'
const [audit, state, operation, uri, flag] = process.argv.slice(2)
appendFileSync(audit, JSON.stringify({ operation, uri, flag, envNames: Object.keys(process.env) }) + '\n')
if (operation !== 'read' || flag !== '--no-newline') process.exit(3)
if (uri.includes('/error/')) {
  process.stderr.write('synthetic-sensitive-error')
  process.stdout.write('synthetic-sensitive-output')
  process.exit(2)
}
if (uri.includes('/empty/')) process.exit(0)
if (uri.includes('/slow/')) await new Promise(resolve => setTimeout(resolve, 30000))
if (uri.includes('/large/')) process.stdout.write('x'.repeat(70000))
else if (uri.includes('/bad-record/')) process.stdout.write('{"kind":"unknown","key":"synthetic-sensitive-output"}')
else if (uri.endsWith('/browser-session-record')) {
  process.stdout.write(JSON.stringify({ kind: 'grant', payload: { version: 1, secret: Buffer.alloc(32, 7).toString('base64url') } }))
} else process.stdout.write(`synthetic-v${readFileSync(state, 'utf8').trim()}`)
