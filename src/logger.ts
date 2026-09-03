import { randomUUID } from 'crypto';
import { IncomingMessage, ServerResponse } from 'http';
import pino from 'pino';
import pinoHttp from 'pino-http';

// Structured JSON to stdout, and nothing else. In a container the platform
// owns the log file: the kubelet captures stdout and rotates it (k3s defaults
// to 10Mi x 5 per container). Writing our own file here would fight that
// rotation and could fill the container layer or the bulbs-data PVC, so there
// is deliberately no file transport.
//
// LOG_LEVEL exists so tests can silence output and so the level can be raised
// in production without a code change. Default `info`: request lines are info
// so they ship; /health is debug so it does not (see levelFor).
function loggerOptions(): pino.LoggerOptions {
  return {
    level: process.env.LOG_LEVEL || 'info',
    base: undefined, // drop pid/hostname - the pod name already identifies this
    timestamp: pino.stdTimeFunctions.epochTime,
  };
}

// Always constructed with an explicit destination so there is one call shape
// and one resulting type. Defaults to fd 1, which is what pino would do
// anyway; tests pass their own stream to assert on the emitted JSON.
function makeLogger(destination: pino.DestinationStream = pino.destination(1)): pino.Logger {
  return pino(loggerOptions(), destination);
}

export const logger = makeLogger();

// Health checks are the highest-volume and least interesting traffic here:
// Knative probes them continuously and the deploy smoke-test hits them too.
// Logging them at info would bury real API calls and burn Grafana Cloud quota
// for no signal, so they drop to debug and are silent at the default level.
export function levelFor(status: number, url: string): 'debug' | 'info' | 'warn' | 'error' {
  if (url.split('?')[0] === '/health') return 'debug';
  if (status >= 500) return 'error';
  // 401 unauthorised, 403 forbidden (a non-allowlisted email, or the
  // cross-origin CSRF rejection), 429 rate limited - by the per-client
  // limiter or the per-device one. These are the lines worth alerting on:
  // before this, every one of them failed silently.
  if (status === 401 || status === 403 || status === 429) return 'warn';
  return 'info';
}

function flatten(
  // pino types req.id as ReqId, which is string | number | object, and
  // Express adds .ip - neither is on the bare IncomingMessage.
  req: IncomingMessage & { id?: unknown; ip?: unknown },
  res: ServerResponse,
  val: Record<string, unknown>
): Record<string, unknown> {
  return {
    ...val,
    kind: 'api_request',
    reqId: req.id as string,
    method: req.method,
    // Path only, without the query string. `?id=` is not sensitive today, but
    // keeping query strings out by default means a parameter added later
    // cannot leak here by accident.
    path: (req.url || '').split('?')[0],
    status: res.statusCode,
    // Client address. This was removed once as unobtainable: the Traefik
    // Service ran externalTrafficPolicy: Cluster, so kube-proxy SNAT'd the
    // source and every request reported the same in-cluster address. That
    // policy has since been changed to Local, so a real address now arrives
    // and `trust proxy` resolves it (see src/trustProxy.ts).
    //
    // This is personal data leaving the cluster, kept deliberately: it is
    // what makes the 401/403/429 lines usable for seeing where an attack
    // comes from, which is the reason those lines are logged at all.
    //
    // Expect the router's address, not a public one, for anything
    // originating inside the LAN - the router hairpins the request and
    // becomes the source. That is correct, not a regression.
    ip: req.ip as string | undefined,
  };
}

// Factory so tests can inject a destination and assert on real emitted JSON.
// Production uses the no-argument form, which writes to stdout.
export function createHttpLogger(destination?: pino.DestinationStream) {
  return pinoHttp({
    logger: destination ? makeLogger(destination) : logger,

    genReqId: (req: IncomingMessage) => (req.headers['x-request-id'] as string) || randomUUID(),

    // Backstop, not the primary control. The serializers below drop the req
    // and res objects entirely, so no headers are serialised in the first
    // place - verified by test/logger.test.ts asserting the token, the
    // session cookie and a freshly minted set-cookie appear nowhere in the
    // emitted line. This stays so that restoring a req/res serializer later
    // cannot silently start shipping credentials to Grafana Cloud.
    redact: {
      paths: ['req.headers.authorization', 'req.headers.cookie', 'res.headers["set-cookie"]'],
      remove: true,
    },

    customLogLevel: (req: IncomingMessage, res: ServerResponse, err?: Error) =>
      err ? 'error' : levelFor(res.statusCode, req.url || ''),

    // `kind` is a stable discriminator so a Loki query can select API lines
    // without matching on message text.
    customSuccessMessage: () => 'api_request',
    customErrorMessage: () => 'api_request',
    customAttributeKeys: { responseTime: 'durationMs' },

    // Flat, one object per request, built once at response time.
    //
    // customProps is deliberately NOT used: pino-http evaluates it twice -
    // once at request start, where res.statusCode is still its default 200,
    // and again on response - then emits both sets whenever they differ. That
    // silently produced duplicate keys on exactly the lines that matter most
    // (401/403/429), with the stale status:200 copy first. JSON.parse keeps
    // the last value, so assertions on the parsed object passed while the
    // emitted line was malformed and twice the size.
    customSuccessObject: (req, res, val) => flatten(req, res, val),
    customErrorObject: (req, res, _err, val) => flatten(req, res, val),
    serializers: {
      req: () => undefined,
      res: () => undefined,
    },
  });
}

export const httpLogger = createHttpLogger();

// Maximum response body captured per request. A body is held in memory until
// the response finishes, so this is a hard cap rather than a formatting
// nicety - the rendered page alone is ~20KB and nothing is gained by keeping
// all of it.
const MAX_BODY_BYTES = 8 * 1024;

// Only bodies we can read as text. A favicon or other binary payload would
// be noise at best and could corrupt the log line at worst.
function isTextual(contentType: string | number | string[] | undefined): boolean {
  const value = Array.isArray(contentType) ? contentType[0] : String(contentType ?? '');
  return /json|text\/|javascript|xml/i.test(value);
}

// Logs the full response body, at DEBUG and only at DEBUG.
//
// THIS LEVEL IS THE ENTIRE SAFETY MECHANISM. The Alloy collector discards
// pino level 20 (debug) before anything leaves the cluster, so these lines
// are visible in `kubectl logs` and Headlamp but never reach Grafana Cloud.
// Everything at info/warn/error DOES ship to a third party.
//
// So: a response body must never be logged above debug. Raising this level,
// or copying the body onto the api_request line (which is info/warn/error),
// would route around every redaction decision in this file at once - the
// Authorization and Cookie headers stripped at source, the query strings
// dropped so a later parameter cannot leak, the authenticated email left
// out as PII. A body can contain any of them, and this service is behind
// Google OAuth.
//
// Capture is skipped entirely unless debug is enabled, so normal operation
// pays nothing for it.
export function responseBodyLogger(req: IncomingMessage, res: ServerResponse, next: () => void): void {
  if (!logger.isLevelEnabled('debug')) {
    next();
    return;
  }

  const chunks: Buffer[] = [];
  let captured = 0;
  let truncated = false;

  const originalWrite = res.write.bind(res);
  const originalEnd = res.end.bind(res);

  const capture = (chunk: unknown): void => {
    if (!chunk || captured >= MAX_BODY_BYTES) {
      if (chunk && captured >= MAX_BODY_BYTES) truncated = true;
      return;
    }
    const buf = Buffer.isBuffer(chunk) ? chunk : typeof chunk === 'string' ? Buffer.from(chunk) : null;
    if (!buf) return;
    const room = MAX_BODY_BYTES - captured;
    if (buf.length > room) truncated = true;
    chunks.push(buf.subarray(0, room));
    captured += Math.min(buf.length, room);
  };

  res.write = function (this: ServerResponse, chunk: unknown, ...rest: unknown[]) {
    capture(chunk);
    return (originalWrite as (...a: unknown[]) => boolean)(chunk, ...rest);
  } as typeof res.write;

  res.end = function (this: ServerResponse, chunk?: unknown, ...rest: unknown[]) {
    if (typeof chunk !== 'function') capture(chunk);
    return (originalEnd as (...a: unknown[]) => ServerResponse)(chunk, ...rest);
  } as typeof res.end;

  res.on('finish', () => {
    const contentType = res.getHeader('content-type');
    const body = isTextual(contentType)
      ? Buffer.concat(chunks).toString('utf8')
      : `[${String(contentType ?? 'unknown')}, not captured]`;

    logger.debug(
      {
        kind: 'api_response_body',
        reqId: (req as IncomingMessage & { id?: unknown }).id as string,
        method: req.method,
        path: (req.url || '').split('?')[0],
        status: res.statusCode,
        truncated,
        body,
      },
      'api_response_body'
    );
  });

  next();
}
