/**
 * Structured logger. ALL output goes to stderr -- stdout is reserved for the
 * MCP JSON-RPC protocol (stdio transport) and writing a log line to stdout
 * would corrupt the message stream.
 *
 * Compliance note: this logger only ever receives level/timestamp/message and
 * a small structured context object (tool name, error message, counts). It is
 * never passed request arguments or response bodies -- see the domain handlers,
 * which log only `{ tool: name }` on failure, never `args` or `result`. Clio
 * data (matters, contacts, communications, documents) is attorney-client
 * privileged; this server does not log or persist request/response content
 * anywhere beyond these structured diagnostics.
 */
const LEVELS = { debug: 0, info: 1, warn: 2, error: 3 } as const;

type Level = keyof typeof LEVELS;

function getConfiguredLevel(): Level {
  const configured = (process.env.LOG_LEVEL || 'info').toLowerCase();
  return configured in LEVELS ? (configured as Level) : 'info';
}

function log(level: Level, message: string, context?: unknown): void {
  if (LEVELS[level] < LEVELS[getConfiguredLevel()]) return;
  const timestamp = new Date().toISOString();
  const prefix = `${timestamp} [${level.toUpperCase()}]`;
  if (context !== undefined) {
    console.error(`${prefix} ${message} ${JSON.stringify(context)}`);
  } else {
    console.error(`${prefix} ${message}`);
  }
}

export const logger = {
  debug: (msg: string, ctx?: unknown) => log('debug', msg, ctx),
  info: (msg: string, ctx?: unknown) => log('info', msg, ctx),
  warn: (msg: string, ctx?: unknown) => log('warn', msg, ctx),
  error: (msg: string, ctx?: unknown) => log('error', msg, ctx),
};
