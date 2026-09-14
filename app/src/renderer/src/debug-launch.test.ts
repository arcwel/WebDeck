import { describe, it, expect } from 'vitest'
import { launchConfiguration } from './debug'
import { debugLanguageOf } from '@shared/debug-languages'

describe('debugLanguageOf', () => {
  it('maps extensions to adapters and leaves the rest without one', () => {
    expect(debugLanguageOf('src/a.ts')).toBe('node')
    expect(debugLanguageOf('a.mjs')).toBe('node')
    expect(debugLanguageOf('tool.py')).toBe('python')
    expect(debugLanguageOf('cmd/main.go')).toBe('go')
    expect(debugLanguageOf('src/main.rs')).toBe('rust')
    expect(debugLanguageOf('x.cpp')).toBe('c')
    expect(debugLanguageOf('README.md')).toBeNull()
    expect(debugLanguageOf('Makefile')).toBeNull()
    expect(debugLanguageOf(null)).toBeNull()
  })
})

describe('launchConfiguration', () => {
  it('gives js-debug the file with source maps', () => {
    expect(launchConfiguration('pwa-node', 'node', '/w/src/a.ts', '/w')).toMatchObject({
      type: 'pwa-node',
      program: '/w/src/a.ts',
      cwd: '/w',
      sourceMaps: true
    })
  })

  it('gives Delve the package directory to build', () => {
    expect(launchConfiguration('go', 'go', '/w/cmd/tool/main.go', '/w')).toMatchObject({
      type: 'go',
      mode: 'debug',
      program: '/w/cmd/tool'
    })
  })

  it('lets codelldb build a crate itself, and points lldb-dap at the debug binary', () => {
    expect(launchConfiguration('lldb', 'rust', '/w/src/main.rs', '/w/mycrate')).toMatchObject({
      type: 'lldb',
      cargo: { args: ['build'] },
      terminal: 'console'
    })
    expect(launchConfiguration('lldb-dap', 'rust', '/w/src/main.rs', '/w/mycrate')).toMatchObject({
      type: 'lldb-dap',
      program: '/w/mycrate/target/debug/mycrate'
    })
  })

  it('expects a C binary beside its source with the same stem', () => {
    expect(launchConfiguration('lldb-dap', 'c', '/w/demo/hello.c', '/w')).toMatchObject({
      program: '/w/demo/hello'
    })
    expect(launchConfiguration('lldb', 'c', '/w/demo/hello.cpp', '/w')).toMatchObject({
      program: '/w/demo/hello'
    })
  })

  it('runs Python through debugpy on the file', () => {
    expect(launchConfiguration('debugpy', 'python', '/w/t.py', '/w')).toMatchObject({
      type: 'python',
      program: '/w/t.py',
      justMyCode: true
    })
  })
})
