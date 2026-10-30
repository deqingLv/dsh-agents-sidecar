/**
 * Structural browser-plugin context faces shared by every client seat.
 *
 * The plugin supports two harness generations from one bundle: dsh 0.1.x
 * exposes the browser services through `dsh-client-runtime` (`slots` +
 * `settingsScope`), while dsh 0.2.x derives them from individual client
 * plugins (`slots` from ui-slots, `configForms` from ui-settings). Cordis
 * `Context` is the stable base, and every optional service is declared here
 * as a narrow structural face and resolved lazily through `ctx.inject` — a
 * service this generation does not provide simply never resolves, so its
 * seat stays inert instead of taking the whole bundle down.
 */

import type { Context } from '@deepseek-ai/cordis'

/** The slot seats this plugin occupies across harness generations. */
export type SidecarSlotName =
  | 'shell.overlay'
  | 'conversation.view'
  | 'sidebar.footer.action'
  /** 0.1.x: one keyed cell per Host settings namespace. */
  | 'settings.plugin.item'
  /** 0.2.x: the row configuration page of this plugin's own row. */
  | 'plugins.row.config'

export interface SlotEntryLike {
  readonly options: { readonly id?: string; readonly key?: string }
}

export interface SlotRegisterOptions {
  name: SidecarSlotName
  id?: string
  key?: string
  order?: number
  /** Human-readable label (0.2.x row configuration page header). */
  label?: string
}

/** Registrar surface shared by the 0.1.x runtime registry and the 0.2.x renderer. */
export interface SlotsPort {
  entries(slot: SidecarSlotName): readonly SlotEntryLike[]
  inject(slot: SidecarSlotName, acquire: () => () => void): unknown
  register(options: SlotRegisterOptions, component: unknown): () => void
}

/**
 * Settings snapshot narrowed to what the card needs. `mode` only exists on
 * the 0.1.x scope; the 0.2.x `ConfigForm` carries `writable` alone.
 */
export interface SettingsFormSnapshot<T> {
  status: 'loading' | 'ready' | 'unavailable'
  value: T | undefined
  writable: boolean
  /** 0.1.x only: 'host' when the Host owns the document (never 'local'). */
  mode?: string
}

/** Read/write face both `SettingsScope` (0.1.x) and `ConfigForm` (0.2.x) satisfy. */
export interface SettingsFormPort<T> {
  getSnapshot(): SettingsFormSnapshot<T>
  subscribe(listener: () => void): () => void
  set(field: string, value: unknown): Promise<boolean>
}

/** 0.2.x settings service: per-namespace forms over the shared describe mirror. */
export interface ConfigFormsPort {
  get<T>(namespace: string): SettingsFormPort<T>
  whileServed(
    namespaces: readonly string[],
    register: (served: ReadonlySet<string>) => () => void,
  ): () => void
}

export type ClientContext = Context & { slots: SlotsPort }
