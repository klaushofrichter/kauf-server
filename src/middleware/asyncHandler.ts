import { Request, Response, NextFunction, RequestHandler } from 'express';

// Express 4.x does not forward rejected promises from async route handlers
// to error-handling middleware. Wrapping a handler with this forwards any
// thrown/rejected error to `next(err)` instead of crashing the process on
// an unhandled rejection.
export function asyncHandler(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}
