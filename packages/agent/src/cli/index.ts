#!/usr/bin/env node

import { runZebricAgentCli } from './main.js'

process.exitCode = await runZebricAgentCli(process.argv.slice(2))
