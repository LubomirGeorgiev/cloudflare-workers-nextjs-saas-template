import type { Messages } from "next-intl";

// Dotted path to every string leaf of the message catalog, e.g.
// "Client.Dashboard.Teams.errorJoinLimit". Non-string leaves (arrays used via
// `t.raw`) are excluded — they can't be error messages.
type LeafPaths<T> = {
  [K in keyof T & string]: T[K] extends string
    ? K
    : T[K] extends readonly unknown[]
      ? never
      : `${K}.${LeafPaths<T[K]>}`;
}[keyof T & string];

export type ActionErrorMessageKey = LeafPaths<Messages>;

export type ActionErrorMessageParams = Record<string, string | number>;

interface ActionErrorKeyedMessage {
  key: ActionErrorMessageKey;
  params?: ActionErrorMessageParams;
}

export type ActionErrorMessage = string | ActionErrorKeyedMessage;

// Prefer the `(code, { key, params })` form: throw sites stay free of
// translation (and stay sync); `actionClient` translates the key once in
// `handleServerError` and surfaces it to clients as a stable `reason` for
// branching. The plain-string form remains for messages translated at the
// throw site (legacy convention) — those pass through untranslated.
export class ActionError extends Error {
  readonly code: string;
  readonly messageKey?: ActionErrorMessageKey;
  readonly messageParams?: ActionErrorMessageParams;

  constructor(code: string, message: ActionErrorMessage) {
    if (typeof message === "string") {
      super(message);
    } else {
      // `Error.message` holds the raw key (+ params) for server logs; the
      // user-facing translation happens in `handleServerError`.
      super(message.params ? `${message.key} ${JSON.stringify(message.params)}` : message.key);
      this.messageKey = message.key;
      this.messageParams = message.params;
    }
    this.name = "ActionError";
    this.code = code;
  }
}
