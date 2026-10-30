import z from "@deepseek-ai/schemastery";
import { IncomingMessage, ServerResponse } from "node:http";
import { Readable, Writable } from "node:stream";
import { Context } from "@deepseek-ai/cordis";

//#region src/session-events.d.ts
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
interface SessionEventSnapshotFace {
  readonly type: string;
  readonly data?: unknown;
}
/** Log face exposing the current snapshot API and/or the legacy property. */
interface SessionSnapshotFace<E extends SessionEventSnapshotFace = SessionEventSnapshotFace> {
  /** Current Harness API (`0.2.1-rc.3` and newer). */
  snapshotEvents?(): readonly E[];
  /** Legacy Harness snapshot property (`0.1.1-rc.2` and older). */
  readonly events?: readonly E[];
}
//#endregion
//#region src/analysis.d.ts
/** Widened user-message face (same shape family as dsh-inject's, F11). */
interface AnalysisUserMessageFace {
  readonly id: string;
  readonly role: 'user';
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
  readonly source: {
    readonly kind: string;
    readonly plugin?: string;
  };
}
/** Widened derived-message face over dsh-llm `Message` (message.d.ts:120-129). */
interface AnalysisDerivedMessageFace {
  readonly role: string;
  readonly content: ReadonlyArray<{
    readonly type: string;
    readonly text?: string;
  }>;
}
/** Widened session-event envelope face (dsh-session types.d.ts:425-443). */
interface AnalysisSessionEventFace {
  readonly type: string;
  /** `assistant/message` events carry `{ usage?: TokenUsage }` here. */
  readonly data?: unknown;
}
/** Read face over the live session log (dsh-session index.d.ts:106-267). */
interface AnalysisSessionLogFace extends SessionSnapshotFace<AnalysisSessionEventFace> {
  /** Cached surface projection of the derived LLM history (index.d.ts:259). */
  deriveMessages(): ReadonlyArray<AnalysisDerivedMessageFace>;
}
/** Cancellation cause face; `{kind:'user'}` ∈ `AgentCancelCause` (dsh-session types.d.ts:118-127). */
interface AnalysisCancelCauseFace {
  readonly kind: 'user';
}
/** Live-agent face: prompt in, quiescence + log read back (runtime-types.d.ts:60-133). */
interface AnalysisAgentDriverFace {
  readonly session: AnalysisSessionLogFace;
  followup(message: AnalysisUserMessageFace): void;
  cancel(cause: AnalysisCancelCauseFace): void;
  whenIdle(): Promise<void>;
}
/**
 * The dedicated analysis session handle — `AgentHandle` face
 * (index.d.ts:155-158): send messages via `agent.followup`, read responses via
 * `agent.whenIdle` + `agent.session`, stop via `dispose()`.
 */
interface AnalysisSession {
  readonly agent: AnalysisAgentDriverFace;
  dispose(): Promise<void>;
}
/** Per-agent options face over SDK `AgentOptions` (runtime-types.d.ts:21-28). */
interface AnalysisAgentOptionsFace {
  /** Provider route (must have a registered adapter at call time). */
  readonly provider?: string;
  /** Model id interpreted by the selected provider adapter. */
  readonly model?: string;
  /** Maximum output tokens for each conversation-model request. */
  readonly maxTokens?: number;
}
/** `CreateAgentOptions` face (index.d.ts:65-118): engine-minted id + creation abort. */
interface AnalysisCreateOptions {
  readonly sessionId: string;
  readonly signal?: AbortSignal;
  /**
   * Provider/model routing for the analysis agent (`CreateAgentOptions.
   * agentOptions`). The engine never sets this — the integration layer's
   * create adapter resolves and attaches it (A-1: an agent created without
   * provider/model fails prompt assembly on the `{{model}}` variable and
   * `buildRequest`, completing with an empty summary and zero tokens).
   */
  readonly agentOptions?: AnalysisAgentOptionsFace;
  /**
   * Session creation metadata (`CreateAgentOptions.meta` subset). Also
   * attached by the create adapter, never the engine: the deployment
   * persona's `{{cwd}}` prompt variable reads `session.header.cwd`, which
   * only `meta.cwd` populates (same reason dsh-headless passes
   * `meta: { cwd: process.cwd() }` on its own create call).
   */
  readonly meta?: {
    readonly cwd?: string; /** Explicit marker for board/fusion filters; analysis is not user work. */
    readonly agentSidecarAnalysis?: true;
  };
}
/** Minimal `ctx.agents` face: the one factory entry point this engine uses. */
interface AnalysisAgentFace {
  /** `AgentRegistry.create` (index.d.ts:288). */
  create(options: AnalysisCreateOptions): Promise<AnalysisSession>;
}
//#endregion
//#region src/supervisor.d.ts
type SupervisorPolicy = 'adopt-or-host' | 'adopt-only' | 'off';
//#endregion
//#region src/config.d.ts
/** Daemon lifecycle governance (design §4.a). */
interface DaemonConfig {
  /** adopt-or-host: probe→adopt→else spawn; adopt-only: never spawn; off: no lifecycle management (read-only reconcile still runs). */
  policy: SupervisorPolicy;
  /** Consecutive hosting failures before the supervisor trips FAILED. */
  backoffLimit: number;
}
/** How to reach/launch the sidecar itself. */
interface SidecarInvocationConfig {
  /** argv prefix of the sidecar executable (PATH name, absolute path, or e.g. python3+zipapp as multiple entries). */
  command: string[];
  /** Empty = default `~/.agents_sidecar` (honoring AGENTS_SIDECAR_RUNTIME_DIR); non-empty redirects via env for spawned daemons. */
  runtimeDir: string;
}
/** Reconciler snapshot cadences (design §4.b / ADR-2). */
interface StreamConfig {
  /** `status` snapshot cadence while any session is working (ms). */
  reconcileActiveMs: number;
  /** `status` snapshot cadence otherwise (ms). */
  reconcileIdleMs: number;
}
/** Write-path master switch and defaults (M2 consumes defaultMode). */
interface InjectConfig {
  /** Master gate: false hides all inject affordances and 403s write actions server-side. */
  enabled: boolean;
  /** Default injection mode offered by the inject panel. */
  defaultMode: 'queue' | 'steer';
}
/** AI bypass-analysis switch and model routing (M3). */
interface AnalysisConfig {
  enabled: boolean;
  /**
   * Explicit provider route for the dedicated analysis agents. Empty (the
   * default) reuses the host's default model selection (`agentDefaultModel`
   * service, the same source dsh's own entry points read). Takes effect
   * only together with a non-empty `model`.
   */
  provider: string;
  /** Explicit model id for the analysis agents; see {@link provider}. */
  model: string;
}
/** Board rendering knobs (client half). */
interface UiConfig {
  /** Session recency window shown on the board (hours). */
  timeWindowHours: number;
  /** Whether dead sessions are listed. */
  showDead: boolean;
}
/**
 * Automatic archiving policy handed to daemons THIS plugin spawns.
 *
 * Deliberately conservative: off by default, a 24h threshold, and
 * archive-only — the automatic path never disposes anything, and a session
 * that speaks again is unarchived by the same scan that hid it. An adopted
 * or service-managed daemon keeps the policy it was started with; the
 * settings card reports what that daemon actually applies.
 */
interface ArchivePolicyConfig {
  /** Hide sessions idle past the threshold from the board. */
  auto: boolean;
  /** Inactivity threshold in hours; only read when `auto` is true. */
  autoAfterHours: number;
}
/** Skill provider switch (design §6/§7 path two; wired in M4/T6.2). */
interface SkillConfig {
  /** Register the embedded agents-sidecar skill on ctx.skills (read at apply; restart semantics). */
  provide: boolean;
}
/** Validated composition config (all defaults filled by the schema). */
interface Config {
  daemon: DaemonConfig;
  sidecar: SidecarInvocationConfig;
  stream: StreamConfig;
  inject: InjectConfig;
  analysis: AnalysisConfig;
  ui: UiConfig;
  archive: ArchivePolicyConfig;
  skill: SkillConfig;
}
declare const Config: z<Config>;
//#endregion
//#region src/dsh-inject.d.ts
/**
 * Widened message parameter face: the SDK's `UserMessage` is assignable to
 * this shape, which keeps `Agent`'s method signatures structurally
 * compatible with {@link DshAgentFace} without importing SDK types.
 */
interface DshUserMessageFace {
  readonly id: string;
  readonly role: 'user';
  readonly content: ReadonlyArray<{
    readonly type: string;
  }>;
  readonly source: {
    readonly kind: string;
  };
}
/** Live-agent face: the two injection entry points (runtime-types.d.ts:115/:123). */
interface DshAgentFace {
  followup(message: DshUserMessageFace): void;
  steer(message: DshUserMessageFace): void;
}
/** `AgentHandle` face (index.d.ts:155-158), including late-timeout cleanup. */
interface DshAgentHandleFace {
  readonly agent: DshAgentFace;
  dispose(): Promise<void>;
}
/** Complete route required to start a cold resumed Agent. */
interface DshModelRoute {
  readonly provider: string;
  readonly model: string;
}
/** Synchronous publication commit returned by the rc.2 AgentSetup contract. */
interface DshAgentSetupCommitFace {
  commit(): void;
}
/** Unpublished setup context exposes the exact restored Agent + Session. */
interface AgentSetupContextFace {
  readonly agent?: {
    /** `snapshotEvents()` on current Harness; legacy `events` stays optional. */readonly session?: SessionSnapshotFace & {
      readonly header: unknown;
    };
  };
}
/** Setup accepted by `agents.resume`; the cold proof always supplies a sync one. */
type DshAgentSetupFace = (agentContext: AgentSetupContextFace) => DshAgentSetupCommitFace | Promise<DshAgentSetupCommitFace | void> | void;
/** Minimal `ctx.agents` (`AgentRegistry`) face: locate + resume. */
interface AgentsServiceFace {
  /** Whether the cold resume owner binding (agents + persistence) is live. */
  isAvailable(): boolean;
  /** Live lookup (index.d.ts:349); undefined = session not loaded. */
  get(sessionId: string): DshAgentFace | undefined;
  /** Load a persisted session and start an agent on it (index.d.ts:296). */
  resume(options: {
    readonly resumeSessionId: string;
    readonly agentOptions?: DshModelRoute;
    readonly signal?: AbortSignal;
    readonly setup?: DshAgentSetupFace;
  }): Promise<DshAgentHandleFace>;
}
//#endregion
//#region src/fusion.d.ts
/** `SessionHeader` subset (dsh-session types.d.ts:40-78). */
interface DshSessionHeaderFace {
  readonly createdAt: number;
  readonly cwd?: string;
  readonly parentSession?: string;
}
/** `SessionEvent` subset (dsh-session types.d.ts:425-457). */
interface DshSessionEventFace {
  readonly type: string;
  /** Monotonic sequence number within the session. */
  readonly seq: number;
  /** Unix epoch milliseconds. */
  readonly time: number;
  readonly data: unknown;
}
/** `Session` subset: identity, header, on-demand log snapshot (index.d.ts:106-174). */
interface DshSessionFace extends SessionSnapshotFace<DshSessionEventFace> {
  readonly id: string;
  readonly header: DshSessionHeaderFace;
}
//#endregion
//#region src/index.d.ts
declare const name = "dsh-agents-sidecar";
/** Required services; see the module doc for why `agents` is lazy instead. */
declare const inject: string[];
/** `ctx.webServer` face (route registration only). */
interface WebServerService {
  register(route: {
    kind: 'exact' | 'prefix';
    path: string;
    handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>;
  }): () => void;
}
/** Bounded in-memory collection for one child output stream. */
interface SubprocessCollectSpec {
  maxBytes: number;
  spill?: {
    maxBytes: number;
  };
}
/** Fully-specified spawn request (`ctx.subprocess` applies no defaults). */
interface SubprocessSpawnSpec {
  argv: readonly string[];
  cwd: string;
  stdio: {
    stdin: 'ignore' | 'pipe' | {
      readonly data: string;
    };
    stdout: 'pipe' | 'inherit' | SubprocessCollectSpec;
    stderr: 'pipe' | 'inherit' | SubprocessCollectSpec;
  };
  graceMs: number;
  signal?: AbortSignal;
  env?: NodeJS.ProcessEnv;
}
/** Exit facts of one closed process (Node `close`-event vocabulary). */
interface SubprocessOutcome {
  exitCode: number | null;
  signal: NodeJS.Signals | null;
}
/** Offset-based, non-consuming reader over one collect-mode stream. */
interface SubprocessOutputReader {
  readFrom(fromByte: number): {
    text: string;
    nextOffset: number;
    lossy: boolean;
  };
}
/** Live child-process handle rooted in its own process tree. */
interface SubprocessHandle {
  readonly pid: number;
  /** Present iff spawned with `stdin: 'pipe'` (dsh-subprocess types.d.ts:158). */
  readonly stdin: Writable | undefined;
  readonly stdout: Readable | undefined;
  readonly stderr: Readable | undefined;
  readonly collected: {
    readonly stdout?: SubprocessOutputReader;
    readonly stderr?: SubprocessOutputReader;
  };
  readonly done: Promise<SubprocessOutcome>;
  terminate(): void;
  waitForExit(signal?: AbortSignal): Promise<boolean>;
}
/** `ctx.subprocess` face (managed pipe-process primitive only). */
interface SubprocessService {
  spawn(spec: SubprocessSpawnSpec): SubprocessHandle;
}
/** Owner scope returned by `ctx.settings.register` (read/observe subset). */
interface SettingsScopeFace<T> {
  get(): T;
  watch(callback: (next: T, prev: T) => void): () => void;
}
/**
 * `ctx.settings` face (namespace registration only). Source:
 * dsh-settings SettingsProvider.register — `register(ns, schema, {base,
 * applies})` → owner scope; the namespace brand is compile-time only, so a
 * plain string is structurally sound. Registration rides the CALLER's
 * fiber (service proxy binds this.ctx), so disposal is automatic.
 */
interface SettingsServiceFace {
  register<T>(ns: string, schema: unknown, options?: {
    base?: Partial<T>;
    applies?: 'live' | 'restart';
  }): SettingsScopeFace<T>;
}
/**
 * The lazily-bound `ctx.agents` registry surface: M2 injection consumes
 * `get`/`resume` (dsh-inject's {@link AgentsServiceFace}), M3 analysis
 * consumes `create` (analysis.ts's {@link AnalysisAgentFace}). One lazy
 * binding serves both paths — and gates both degradations.
 */
type AgentsRegistryFace = Omit<AgentsServiceFace, 'isAvailable'> & Pick<AnalysisAgentFace, 'create'>;
/**
 * `ctx.agentDefaultModel` face (dsh-agent-default-model index.d.ts:40-56):
 * the host's default model selection — the SAME source dsh's own entry
 * points read when creating agents (dsh-headless `run()` passes
 * `agentOptions: {provider, model}` from `currentSelection()`;
 * dsh-host-apiproxy exposes it as `defaultModelSelection`). Resolved per
 * call via reflect `get` (never a hard inject): the service is core in
 * dsh-base compositions but the plugin must degrade honestly without it.
 */
interface AgentDefaultModelFace {
  currentSelection(): {
    provider: string;
    model: string;
  };
}
/** Public `sessionPersistence.list`/`inspect` slice used for cold authority. */
interface SessionPersistenceFace {
  list(signal?: AbortSignal): Promise<ReadonlyArray<{
    readonly id: string;
  }>>;
  inspect(sessionId: string, signal?: AbortSignal): Promise<{
    readonly meta: unknown;
    readonly events: readonly unknown[];
  }>;
}
/**
 * `ctx.sessions` direct live-session lookup used by fusion on demand, plus
 * the optional dispose the `dsh.dispose` action drives (the in-process form
 * of the host's `session.dispose` RPC). `dispose` is optional because a
 * host without it must degrade to "capability absent", never to a call
 * that throws at the moment the operator confirms it.
 */
interface SessionsServiceFace {
  get(sessionId: string): DshSessionFace | undefined;
  dispose?(sessionId: string): void | Promise<void>;
}
/** The plugin context with the two hard-injected services visible. */
type HostContext = Context & {
  webServer: WebServerService;
  subprocess: SubprocessService;
};
/**
 * Assemble the M1 host half.
 *
 * Teardown is order-sensitive, so the whole assembly lives in ONE
 * `ctx.effect` disposer (design §4.a: "顺序敏感拆除放同一 disposer"):
 * supervisor first (terminates a self-hosted daemon, never an adopted one),
 * then the reconciler (closes the subscribe stream and timers), then
 * `routes.dispose()` (ends SSE clients, unsubscribes), and the webServer
 * route disposer last.
 *
 * @param ctx - plugin context handed by the cordis loader.
 * @param config - schema-validated composition config (defaults filled).
 */
declare function apply(ctx: HostContext, config: Config): void;
//#endregion
export { AgentDefaultModelFace, AgentsRegistryFace, Config, HostContext, SessionPersistenceFace, SessionsServiceFace, SettingsScopeFace, SettingsServiceFace, SubprocessCollectSpec, SubprocessHandle, SubprocessOutcome, SubprocessOutputReader, SubprocessService, SubprocessSpawnSpec, WebServerService, apply, inject, name };