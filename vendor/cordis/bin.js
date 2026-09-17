#!/usr/bin/env node

import { Context } from '@workspacealberta/cordis'
import { pathToFileURL } from 'node:url'
import Loader from '@workspacealberta/cordis-plugin-loader'

const ctx = new Context()
ctx.baseUrl = pathToFileURL(process.cwd()).href + '/'

await ctx.plugin(Loader)
await ctx.loader.create({
  name: '@workspacealberta/cordis-plugin-include',
  config: {
    path: './cordis.yml',
  },
})
