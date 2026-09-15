import { describe, it, expect } from 'vitest'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'
import { workspaceRelative } from './workspace-relative'

describe('workspaceRelative', () => {
  it('maps a URI inside the workspace to its relative path, and the root to ""', () => {
    expect(workspaceRelative(URI.file('/w/proj/src/a.ts'), '/w/proj')).toBe('src/a.ts')
    expect(workspaceRelative(URI.file('/w/proj'), '/w/proj/')).toBe('')
  })

  it('refuses anything outside, a sibling with the same prefix, other schemes, and no workspace', () => {
    expect(workspaceRelative(URI.file('/w/other/a.ts'), '/w/proj')).toBeNull()
    expect(workspaceRelative(URI.file('/w/proj2/a.ts'), '/w/proj')).toBeNull()
    expect(workspaceRelative(URI.parse('untitled:Untitled-1'), '/w/proj')).toBeNull()
    expect(workspaceRelative(URI.file('/w/proj/a.ts'), null)).toBeNull()
  })
})
