import { describe, it, expect } from 'vitest'
import { needsExtensionHost, shouldStartExtensionHost } from './extension-host-policy'

describe('the extension host starts only when something needs it', () => {
  const theme = { manifest: { contributes: { themes: [] } } }
  const desktopOnly = { manifest: { main: './dist/extension.js' } }
  const web = { manifest: { main: './dist/extension.js', browser: './dist/web/extension.js' } }

  it('a browser entry is what needs the host', () => {
    expect(needsExtensionHost(theme)).toBe(false)
    expect(needsExtensionHost(desktopOnly)).toBe(false)
    expect(needsExtensionHost(web)).toBe(true)
  })

  it('never without the loopback origin, and not for declarative or desktop-only extensions', () => {
    expect(shouldStartExtensionHost(false, [web])).toBe(false)
    expect(shouldStartExtensionHost(true, [])).toBe(false)
    expect(shouldStartExtensionHost(true, [theme, desktopOnly])).toBe(false)
    expect(shouldStartExtensionHost(true, [theme, web])).toBe(true)
  })
})
