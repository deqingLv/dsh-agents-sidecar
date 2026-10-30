/**
 * Resolve the configured `sidecar.command` argv into something the host can
 * actually spawn.
 *
 * The default command is the bare PATH name `agents-sidecar`, but a macOS GUI
 * host inherits launchd's `PATH`, which does not include `~/.local/bin` — the
 * prefix `install.sh` links the CLI into. A bare name is therefore searched on
 * `PATH` first and then in the conventional install directories, and a hit is
 * rewritten to its absolute path. Explicit paths and multi-part argv (for
 * example `python3 /path/to/agents-sidecar.pyz`) are used verbatim: the plugin
 * never second-guesses an operator's explicit invocation.
 *
 * Pure: every filesystem answer arrives through {@link CommandResolutionDeps},
 * so the search is unit-testable without touching a real host.
 *
 * @module
 */

import { isAbsolute, join } from 'node:path'

/** Filesystem and environment seams the resolution reads. */
export interface CommandResolutionDeps {
  /** True when `path` is an executable regular file. */
  isExecutable(path: string): boolean
  /** Ambient environment; only `PATH` is read. */
  env: NodeJS.ProcessEnv | undefined
  /** Home directory used to derive the user-level install prefix. */
  homedir: string
  /** Platform switches the PATH delimiter and the fallback directory set. */
  platform: NodeJS.Platform
}

/** Outcome of {@link resolveSidecarCommand}. */
export interface CommandResolution {
  /** argv to spawn; rewritten to an absolute path when a fallback matched. */
  command: string[]
  /** Absolute path substituted for a bare name, when one was found. */
  resolvedPath?: string
  /** Directories probed in vain; empty unless the name was never found. */
  searched: string[]
}

/** Directories searched after `PATH` for a bare command name. */
export function fallbackDirectories(deps: CommandResolutionDeps): string[] {
  const directories = [join(deps.homedir, '.local', 'bin')]
  if (deps.platform === 'darwin') directories.push('/opt/homebrew/bin')
  directories.push('/usr/local/bin')
  return directories
}

/** `PATH` entries in search order, without empty segments. */
export function searchPath(deps: CommandResolutionDeps): string[] {
  const raw = deps.env?.PATH ?? deps.env?.Path ?? ''
  const delimiter = deps.platform === 'win32' ? ';' : ':'
  return raw.split(delimiter).filter((entry) => entry !== '')
}

/**
 * True when the argv head is an explicit location rather than a PATH lookup.
 * Both separators count so a Windows-style relative path also passes through.
 */
function isExplicitLocation(head: string): boolean {
  return isAbsolute(head) || head.includes('/') || head.includes('\\')
}

/**
 * Resolve `command` against PATH and then the fallback directories.
 *
 * A bare name found on PATH is returned unchanged — the spawn's own lookup
 * already handles it, and keeping the name preserves `PATH` precedence. Only
 * when `PATH` misses does the fallback directory set get a chance, and only
 * then does the result carry {@link CommandResolution.resolvedPath}.
 */
export function resolveSidecarCommand(
  command: string[],
  deps: CommandResolutionDeps,
): CommandResolution {
  const argv = [...command]
  const head = argv[0]
  if (
    argv.length !== 1 ||
    head === undefined ||
    head === '' ||
    isExplicitLocation(head)
  ) {
    return { command: argv, searched: [] }
  }
  for (const directory of searchPath(deps)) {
    if (deps.isExecutable(join(directory, head))) {
      return { command: argv, searched: [] }
    }
  }
  for (const directory of fallbackDirectories(deps)) {
    const candidate = join(directory, head)
    if (deps.isExecutable(candidate)) {
      return { command: [candidate], resolvedPath: candidate, searched: [] }
    }
  }
  return { command: argv, searched: fallbackDirectories(deps) }
}
