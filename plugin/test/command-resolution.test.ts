/**
 * Unit tests for the sidecar command resolution (src/command-resolution.ts):
 * PATH-first lookup, the `~/.local/bin` + Homebrew/USR fallback that covers a
 * launchd GUI host whose PATH omits the user prefix, and the pass-through
 * rules for explicit paths and multi-part argv. No real filesystem: every
 * executable answer is injected.
 */

import { describe, expect, it } from 'vitest'
import {
  fallbackDirectories,
  resolveSidecarCommand,
  searchPath,
  type CommandResolutionDeps,
} from '../src/command-resolution.ts'

const HOME = '/Users/operator'
const DEFAULT_NAME = 'agents-sidecar'

/** Deps over a fake file system whose executable set is enumerated per test. */
function deps(
  executable: string[],
  overrides: Partial<CommandResolutionDeps> = {},
): CommandResolutionDeps {
  const known = new Set(executable)
  return {
    isExecutable: (path) => known.has(path),
    env: { PATH: '/usr/bin:/bin:/opt/homebrew/bin' },
    homedir: HOME,
    platform: 'darwin',
    ...overrides,
  }
}

describe('searchPath', () => {
  it('splits on the POSIX delimiter and drops empty segments', () => {
    expect(searchPath(deps([], { env: { PATH: '/usr/bin::/bin:' } }))).toEqual([
      '/usr/bin',
      '/bin',
    ])
  })

  it('splits on the Windows delimiter when the platform says so', () => {
    expect(
      searchPath(
        deps([], { platform: 'win32', env: { PATH: 'C:\\bin;;D:\\tools' } }),
      ),
    ).toEqual(['C:\\bin', 'D:\\tools'])
  })

  it('treats a missing or empty PATH as no search path at all', () => {
    expect(searchPath(deps([], { env: {} }))).toEqual([])
    expect(searchPath(deps([], { env: undefined }))).toEqual([])
  })
})

describe('fallbackDirectories', () => {
  it('includes the user prefix and the macOS Homebrew prefix on darwin', () => {
    expect(fallbackDirectories(deps([]))).toEqual([
      `${HOME}/.local/bin`,
      '/opt/homebrew/bin',
      '/usr/local/bin',
    ])
  })

  it('omits the Homebrew-only prefix on linux', () => {
    expect(
      fallbackDirectories(deps([], { platform: 'linux' })),
    ).toEqual([`${HOME}/.local/bin`, '/usr/local/bin'])
  })
})

describe('resolveSidecarCommand', () => {
  it('leaves a bare name that PATH already resolves unchanged', () => {
    // PATH hit means the spawn's own lookup works; the name is not rewritten.
    const resolution = resolveSidecarCommand(
      [DEFAULT_NAME],
      deps(['/opt/homebrew/bin/agents-sidecar']),
    )

    expect(resolution).toEqual({ command: [DEFAULT_NAME], searched: [] })
    expect(resolution.resolvedPath).toBeUndefined()
  })

  it('rewrites to ~/.local/bin when the GUI host PATH misses the user prefix', () => {
    const resolution = resolveSidecarCommand(
      [DEFAULT_NAME],
      deps([`${HOME}/.local/bin/agents-sidecar`]),
    )

    expect(resolution.command).toEqual([`${HOME}/.local/bin/agents-sidecar`])
    expect(resolution.resolvedPath).toBe(`${HOME}/.local/bin/agents-sidecar`)
    expect(resolution.searched).toEqual([])
  })

  it('falls back to /usr/local/bin after the user prefix', () => {
    const resolution = resolveSidecarCommand(
      [DEFAULT_NAME],
      deps(['/usr/local/bin/agents-sidecar']),
    )

    expect(resolution.resolvedPath).toBe('/usr/local/bin/agents-sidecar')
  })

  it('keeps the bare name and reports what was searched when nothing exists', () => {
    const resolution = resolveSidecarCommand([DEFAULT_NAME], deps([]))

    expect(resolution.command).toEqual([DEFAULT_NAME])
    expect(resolution.resolvedPath).toBeUndefined()
    expect(resolution.searched).toEqual(fallbackDirectories(deps([])))
  })

  it('still searches the fallbacks when PATH is empty', () => {
    const resolution = resolveSidecarCommand(
      [DEFAULT_NAME],
      deps([`${HOME}/.local/bin/agents-sidecar`], { env: {} }),
    )

    expect(resolution.resolvedPath).toBe(`${HOME}/.local/bin/agents-sidecar`)
  })

  it('never rewrites an explicit absolute path', () => {
    const resolution = resolveSidecarCommand(
      ['/tmp/agents-sidecar'],
      deps([`${HOME}/.local/bin/agents-sidecar`]),
    )

    expect(resolution).toEqual({ command: ['/tmp/agents-sidecar'], searched: [] })
  })

  it('never rewrites multi-part argv such as python3 plus a zipapp', () => {
    const argv = ['python3', '/path/to/agents-sidecar.pyz']
    const resolution = resolveSidecarCommand(
      argv,
      deps([`${HOME}/.local/bin/agents-sidecar`]),
    )

    expect(resolution.command).toEqual(argv)
    expect(resolution.searched).toEqual([])
  })

  it('does not mutate the configured array', () => {
    const argv = [DEFAULT_NAME]
    resolveSidecarCommand(argv, deps([`${HOME}/.local/bin/agents-sidecar`]))

    expect(argv).toEqual([DEFAULT_NAME])
  })
})
