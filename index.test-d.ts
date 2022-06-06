import { Request, Server } from '@hapi/hapi';
import pino from 'pino';
import * as HapiPino from '.';
import { expectType } from 'tsd';

const pinoLogger = pino();

const server = new Server();

const options: HapiPino.Options = {
  timestamp: () => `,"time":"${new Date(Date.now()).toISOString()}"`,
  logQueryParams: false,
  logPathParams: false,
  logPayload: false,
  logRouteTags: false,
  logRequestStart: false,
  logRequestComplete: true,
  stream: process.stdout,
  prettyPrint: process.env.NODE_ENV !== 'PRODUCTION',
  tags: {
    trace: 'trace',
    debug: 'debug',
    info: 'info',
    warn: 'warn',
    error: 'error',
    fatal: 'fatal',
  },
  allTags: 'info',
  serializers: {
    req: (req: any) => console.log(req),
  },
  getChildBindings: (req: Request) => ({
    'x-request-id': req.headers['x-request-id'],
  }),
  customRequestStartMessage: (req: Request) => `request start ${req.path}`,
  customRequestCompleteMessage: (req: Request, responseTime: number) => `request complete ${req.path} in ${responseTime}ms`,
  customRequestErrorMessage: (req: Request, error: Error) => `request failed ${req.path} with error ${error.message}`,
  instance: pinoLogger,
  logEvents: false,
  mergeHapiLogData: false,
  ignorePaths: ['/testRoute'],
  level: 'debug',
  redact: ['test.property'],
  ignoreTags: ['healthcheck'],
  ignoreFunc: (options, request) => request.path.startsWith('/static'),
  ignoredEventTags: [{ log: ['DEBUG', 'TEST'], request: ['DEBUG', 'TEST'] }],
};

expectType<Promise<void>>(server.register({ plugin: HapiPino, options }));
