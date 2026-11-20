/** Rectangle in CSS pixels. Views carry rects relative to the top-level viewport. */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * How a challenge is solved:
 * - checkbox: click the `checkbox` target, no model involved
 * - select:   pick targets (image tiles, buttons) by id
 * - text:     read the image and type into the `input` target
 * - point:    click/drag free positions inside the region (canvas challenges)
 * - slider:   drag the `handle`, no model involved: until the `piece` image fits the gap in the
 *             `background` image (found by image analysis), or, without a piece, to the end of
 *             the `rail`. A visible `reload` without a handle (a refused slider) is clicked.
 */
export type ChallengeKind = "checkbox" | "select" | "text" | "point" | "slider";

/**
 * pending: something to do; waiting: in progress (spinner, checkbox gone), nothing to do;
 * solved: done; blocked: cannot be solved here (rate limit, hard block).
 */
export type ChallengeStatus = "pending" | "waiting" | "solved" | "blocked";

export interface Target {
  id: string;
  rect: Rect;
  label?: string;
  selected?: boolean;
  /** Current value of an input target. */
  value?: string;
}

/** A challenge as one frame sees it, rects in top-level viewport coordinates. */
export interface ChallengeView {
  adapter: string;
  kind: ChallengeKind;
  status: ChallengeStatus;
  region: Rect;
  instruction: string;
  errors: string[];
  targets: Target[];
  /** False when the element or one of its frames is hidden (it may still be scrolled out of view). */
  visible: boolean;
  /** Opaque key of the frame the view came from, set by the driver. */
  frame?: string;
}

/** One model-decided step. Flat with nullable fields so every structured-output dialect accepts it. */
export interface Action {
  kind: "click" | "type" | "clickPoint" | "drag" | "wait";
  target: string | null;
  text: string | null;
  x: number | null;
  y: number | null;
  toX: number | null;
  toY: number | null;
}

export interface Decision {
  reasoning: string;
  actions: Action[];
}

/** An earlier round on the same challenge, fed back so the model can correct itself. */
export interface HistoryEntry {
  instruction: string;
  decision: Decision;
  /** Errors the challenge showed after the round. */
  errorsAfter: string[];
}

/** What the top frame publishes for the driving agent on `<html data-captcha-state>`. */
export type PageState = "idle" | "solving" | "solved" | "failed";

export type ProviderKind = "openai-compatible" | "openai" | "anthropic" | "google";

export interface ModelConfig {
  provider: ProviderKind;
  /** Empty: the provider's default endpoint. */
  baseURL: string;
  apiKey: string;
  model: string;
}

/** Declarative adapter: a challenge described by selectors. Built-ins and user adapters share it. */
export interface AdapterSpec {
  id: string;
  kind: ChallengeKind;
  /** Regex the frame URL must match. */
  url?: string;
  /** First visible match is the challenge; its box is the region the model sees. */
  root: string;
  /** Selectors whose visible text is the task instruction. */
  instruction?: string[];
  /** Selectors whose visible text reports a failed attempt. */
  errors?: string[];
  /** Selector that matches anywhere in the document when solved. */
  solved?: string;
  /** Regex matched against visible leaf texts when solved. */
  solvedText?: string;
  /** Selector that matches when the challenge cannot be solved (e.g. "try again later"). */
  blocked?: string;
  blockedText?: string;
  /** Selector that matches while the challenge is busy (spinner). */
  waiting?: string;
  targets: TargetSpec[];
  /** Search inside open and closed shadow roots. */
  pierce?: boolean;
  /**
   * Least time between two checkbox clicks, so the vendor's verdict arrives first; clicking a
   * widget again while it verifies restarts its check. Default 5000.
   */
  retryMs?: number;
  /**
   * The challenge animates by design: each round captures 3 frames and the model gets them all
   * with the regions that moved. Otherwise any movement means the challenge has not settled yet
   * (tiles fading in) and the round waits. Default: true for point challenges.
   */
  animated?: boolean;
}

export interface TargetSpec {
  /** Target id; with `all`, ids become `${id}${index + 1}`. */
  id: string;
  selector: string;
  all?: boolean;
  /** Without it the view only exists when the target is found. */
  optional?: boolean;
  /** Selector the element matches, or a visible descendant matches, when it is selected. */
  selected?: string;
  /** Use the element's visible text as label. */
  labelFromText?: boolean;
}

/** Where failures are reported: GitHub issues, with the fixture bundle pushed to a branch. */
export interface ReportConfig {
  enabled: boolean;
  /** Token with `issues: write` on `repo` and `contents: write` on `fixtureRepo`. */
  token: string;
  /** owner/name that gets the issues (upstream). */
  repo: string;
  /** owner/name that gets the fixture branches; empty: `repo` (a fork when you cannot push upstream). */
  fixtureRepo: string;
  /** Reports per day at most. */
  maxPerDay: number;
}

export interface Settings {
  enabled: boolean;
  model: ModelConfig;
  /** Tried in order when a call to the model before them fails. */
  fallbackModels: ModelConfig[];
  report: ReportConfig;
  /** Model rounds per challenge session before giving up. */
  maxRounds: number;
  /**
   * Reload into a new build when the updater rebuilt dist/. Off for browsers that load the
   * extension through CDP Extensions.loadUnpacked: there a reload unloads it (they get the new
   * build at their next launch).
   */
  autoReload: boolean;
  /** Hostnames (suffix match) where the solver stays off. */
  denylist: string[];
  customAdapters: AdapterSpec[];
}

export interface LogEntry {
  time: number;
  url: string;
  adapter: string;
  kind: ChallengeKind;
  round: number;
  reasoning: string;
  actions: Action[];
  error?: string;
  ms: number;
}

/** A model round with everything needed to replay it as a fixture. */
export interface RoundRecord extends LogEntry {
  view: ChallengeView;
  history: HistoryEntry[];
  /** Region screenshots at model resolution without labels, PNG base64, oldest first; the last is current. */
  frames: string[];
  /** The labeled current frame the model saw; empty when the model call failed first. */
  labeled: string;
  /** Errors the challenge showed after the round, filled in by the next scan. */
  errorsAfter?: string[];
}

