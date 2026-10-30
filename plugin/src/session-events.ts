/**
 * Cross-cutting read of a live dsh session log's event snapshot.
 *
 * `@deepseek-ai/dsh-session` replaced the `events` getter with
 * `snapshotEvents(fromSeq?, toSeqExclusive?)` in the 0.2.x line; the
 * getter is simply absent, not deprecated, so a structural `readonly
 * events` claim reads `undefined` at runtime and the immediate `.length`
 * dereference throws. Every consumer that needs the whole log goes
 * through this one helper: current API first, legacy property second,
 * empty last. Method-syntax members keep the branded SDK types assignable,
 * and the default `toSeqExclusive` binds to the session, so the helper
 * always calls with the session as receiver.
 *
 * Pure DI: no cordis/dsh imports.
 *
 * @module
 */

/** Widened session-event envelope (dsh-session types.d.ts:425-443). */
export interface SessionEventSnapshotFace {
  readonly type: string
  readonly data?: unknown
}

/** Log face exposing the current snapshot API and/or the legacy property. */
export interface SessionSnapshotFace<
  E extends SessionEventSnapshotFace = SessionEventSnapshotFace,
> {
  /** Current Harness API (`0.2.1-rc.3` and newer). */
  snapshotEvents?(): readonly E[]
  /** Legacy Harness snapshot property (`0.1.1-rc.2` and older). */
  readonly events?: readonly E[]
}

/** Read the whole event log, preferring the current snapshot API. */
export function sessionEvents<E extends SessionEventSnapshotFace>(
  log: SessionSnapshotFace<E>,
): readonly E[] {
  return typeof log.snapshotEvents === 'function' ? log.snapshotEvents() : log.events ?? []
}
