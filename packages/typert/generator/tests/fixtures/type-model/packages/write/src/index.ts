import { Service } from '@workspacealberta/cordis'

/** Service whose public annotations are intentionally absent. */
export class WritableService extends Service {
  value = 1

  echo(input = 'value') {
    return input
  }
}

declare module '@workspacealberta/cordis' {
  interface Context {
    writable: WritableService
  }
}

export default WritableService
