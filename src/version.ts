// Stamped by the Docker build (ARG APP_VERSION); "dev" when running locally.
// Read per call rather than cached at import time, so the value is
// observable rather than frozen at module load.
export function appVersion(): string {
  return process.env.APP_VERSION || 'dev';
}
