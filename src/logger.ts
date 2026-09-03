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
    // Express's resolved client address, which depends on `trust proxy`
    // matching the real hop count (Traefik -> Kourier -> queue-proxy -> here).
    // If this shows an in-cluster 10.42.x/10.43.x address in production then
    // trust proxy is under-counting and the field is noise - check the first
    // real line before anything is built on it.
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
