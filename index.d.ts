/// <reference types='node' />

import type { pino } from 'pino';

import { Plugin, Request } from '@hapi/hapi';

declare module '@hapi/hapi' {
  interface Server {
    logger: pino.Logger;
  }

  interface Request {
    logger: pino.Logger;
  }
}

declare namespace HapiPino {
  interface Options extends pino.LoggerOptions {
    timestamp?: boolean | (() => string) | undefined;
    logQueryParams?: boolean | undefined;
    logPathParams?: boolean | undefined;
    logPayload?: boolean | undefined;
    logRouteTags?: boolean | undefined;
    log4xxResponseErrors?: boolean | undefined;
    logRequestStart?: boolean | ((req: Request) => boolean) | undefined;
    logRequestComplete?: boolean | ((req: Request) => boolean) | undefined;
    customRequestStartMessage?: ((req: Request) => string) | undefined;
    customRequestCompleteMessage?: ((req: Request, responseTime: number) => string) | undefined;
    customRequestErrorMessage?: ((req: Request, error: Error) => string) | undefined;
    tags?: { [key in pino.Level]?: string } | undefined;
    stream?: NodeJS.WriteStream | undefined;
    allTags?: pino.Level | undefined;
    instance?: pino.Logger | undefined;
    logEvents?: string[] | false | null | undefined;
    wrapSerializers?: boolean | undefined;
    mergeHapiLogData?: boolean | undefined;
    ignorePaths?: string[] | undefined;
    ignoreTags?: string[] | undefined;
    ignoreFunc?: ((options: Options, request: Request) => boolean) | undefined;
    ignoredEventTags?: object[] | undefined;
    getChildBindings?:
      | ((req: Request) => {
          level?: pino.Level | string | undefined;
          [key: string]: any;
        })
      | undefined;
  }
}

declare var HapiPino: Plugin<HapiPino.Options>;

export = HapiPino;
