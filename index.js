'use strict'

const Hoek = require('@hapi/hoek')
const pino = require('pino')
const { stdSerializers } = pino
const serializersSym = Symbol.for('pino.serializers')
const nullLogger = require('abstract-logging')
const getCallerFile = require('get-caller-file')

const levelTags = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal'
}

let ignoredEventTags = {
  log: '*',
  request: '*'
}

async function register (server, options) {
  // clone all user options to account for internal mutations, except for existing stream and pino instances
  options = Object.assign(Hoek.clone(options), {
    stream: options.stream,
    instance: options.instance
  })

  options.serializers = options.serializers || {}

  const wrapSerializers = 'wrapSerializers' in options ? options.wrapSerializers : true
  const reqSerializer = options.serializers.req || stdSerializers.req
  const resSerializer = options.serializers.res || stdSerializers.res

  options.serializers.err = options.serializers.err || pino.stdSerializers.err
  options.serializers.req = wrapSerializers ? stdSerializers.wrapRequestSerializer(reqSerializer) : reqSerializer
  options.serializers.res = wrapSerializers ? stdSerializers.wrapResponseSerializer(resSerializer) : resSerializer

  if (options.logEvents === undefined) {
    options.logEvents = ['onPostStart', 'onPostStop', 'response', 'request-error']
  }

  let logger
  if (options.instance) {
    logger = options.instance
    const overrideDefaultErrorSerializer =
      typeof options.serializers.err === 'function' && logger[serializersSym].err === stdSerializers.err
    logger[serializersSym] = Object.assign({}, options.serializers, logger[serializersSym])
    if (overrideDefaultErrorSerializer) {
      logger[serializersSym].err = options.serializers.err
    }
  } else {
    if (options.transport && !options.transport.caller) {
      options.transport.caller = getCallerFile()
    }
    options.stream = options.stream || process.stdout
    const stream = options.stream || process.stdout
    logger = pino(options, stream)
  }

  const levels = Object.keys(logger.levels.values)
  const tagToLevels = Object.assign({}, levelTags, options.tags)
  const allTags = options.allTags || 'info'

  const validTags = Object.keys(tagToLevels).filter(key => levels.indexOf(tagToLevels[key]) < 0).length === 0
  if (!validTags || levels.indexOf(allTags) < 0) {
    throw new Error('invalid tag levels')
  }

  const tagToLevelValue = {}
  for (const tag in tagToLevels) {
    tagToLevelValue[tag] = logger.levels.values[tagToLevels[tag]]
  }

  const ignoreTable = {}
  if (options.ignorePaths) {
    for (let i = 0; i < options.ignorePaths.length; i++) {
      ignoreTable[options.ignorePaths[i]] = true
    }
  }

  if (options.ignoredEventTags) {
    ignoredEventTags = { ...ignoredEventTags, ...options.ignoredEventTags }
  }

  const mergeHapiLogData = options.mergeHapiLogData
  const messageKey = options.messageKey || 'msg'
  const getChildBindings = options.getChildBindings ? options.getChildBindings : (request) => ({ req: request })
  const shouldLogRequestStart = typeof options.logRequestStart === 'function'
    ? (request) => options.logRequestStart(request)
    : typeof options.logRequestStart === 'boolean'
      ? () => !!options.logRequestStart
      : () => false
  const shouldLogRequestComplete = typeof options.logRequestComplete === 'function'
    ? (request) => options.logRequestComplete(request)
    : typeof options.logRequestComplete === 'boolean'
      ? () => !!options.logRequestComplete
      : () => true

  const requestStartMessage = options.customRequestStartMessage || function () { return 'request start' }
  const requestCompleteMessage = options.customRequestCompleteMessage || function (request, responseTime) { return `[response] ${request.method} ${request.path} ${request.raw.res.headersSent ? request.raw.res.statusCode : '-'} (${responseTime}ms)` }
  const requestErrorMessage = options.customRequestErrorMessage || function (request, error) { return error.message } // Will default to `Internal Server Error` by hapi

  // expose logger as 'server.logger'
  server.decorate('server', 'logger', logger)

  // set a logger for each request
  server.ext('onRequest', (request, h) => {
    if (isLoggingIgnored(options, request)) {
      request.logger = nullLogger
      return h.continue
    }

    const childBindings = getChildBindings(request)
    request.logger = logger.child(childBindings)

    if (shouldLogRequestStart(request)) {
      request.logger.info({
        req: childBindings.req ? undefined : request
      }, requestStartMessage(request))
    }

    return h.continue
  })

  server.events.on('log', function (event) {
    if (!isCustomTagsLoggingIgnored(event, ignoredEventTags.log)) { // first check on ignoring tags
      if (event.error) {
        logger.error({ err: event.error, tags: event.tags })
      } else {
        logEvent(logger, event)
      }
    }
  })

  // log via `request.log()` and optionally when an internal `accept-encoding`
  // error occurs or request completes with an error
  server.events.on('request', function (request, event, tags) {
    if (
      (event.channel === 'internal' && !tags['accept-encoding']) ||
      isLoggingIgnored(options, request)
    ) {
      return
    }

    if (!request.logger) {
      const childBindings = getChildBindings(request)
      request.logger = logger.child(childBindings)
    }

    if (event.error && isEnabledLogEvent(options, 'request-error')) {
      request.logger.error(
        {
          tags: event.tags,
          err: event.error
        },
        requestErrorMessage(request, event.error)
      )
    } else if (event.channel === 'app' && !isCustomTagsLoggingIgnored(event, ignoredEventTags.request)) {
      logEvent(request.logger, event)
    }
  })

  // log when a request completes
  tryAddEvent(server, options, 'on', 'response', function (request) {
    if (isLoggingIgnored(options, request)) {
      return
    }

    if (shouldLogRequestComplete(request)) {
      const info = request.info
      const statusCode = request.response.statusCode
      if (!request.logger) {
        const childBindings = getChildBindings(request)
        request.logger = logger.child(childBindings)
      }

      // If you want `req` to be added either use the default `getChildBindings` or make sure `req` is passed in your custom bindings.
      const responseTime = (info.completed !== undefined ? info.completed : info.responded) - info.received
      request.logger.info(
        {
          payload: options.logPayload ? request.payload : undefined,
          queryParams: options.logQueryParams ? request.query : undefined,
          pathParams: options.logPathParams ? request.params : undefined,
          tags: options.logRouteTags ? request.route.settings.tags : undefined,
          err: options.log4xxResponseErrors && (statusCode >= 400 && statusCode < 500) ? request.response.source : undefined,
          res: request.raw.res,
          responseTime
        },
        requestCompleteMessage(request, responseTime)
      )
    }
  })

  tryAddEvent(server, options, 'ext', 'onPostStart', async function (s) {
    logger.info(server.info, 'server started')
  })

  tryAddEvent(server, options, 'ext', 'onPostStop', async function (s) {
    logger.info(server.info, 'server stopped')
  })

  function isCustomTagsLoggingIgnored (event, ignoredTags) {
    if (event.tags && ignoredTags !== '*') {
      return event.tags.some(tag => ignoredTags.indexOf(tag) > -1)
    }
    return false
  }

  function isLoggingIgnored (options, request) {
    if (typeof options.ignoreFunc === 'function') {
      return !!options.ignoreFunc(options, request)
    }

    // note: from hapi@18.0.0 the `request.url` can be undefined
    // based on that we prefer to use request.path instead of request.url.pathname
    if (options.ignorePaths && ignoreTable[request.path]) {
      return true
    }

    const ignoreTags = options.ignoreTags
    const routeTags = request.route.settings.tags

    if (!ignoreTags || !routeTags) {
      return false
    }

    for (let index = ignoreTags.length; index >= 0; index--) {
      if (routeTags.includes(ignoreTags[index])) {
        return true
      }
    }

    return false
  }

  function isEnabledLogEvent (options, name) {
    return options.logEvents && options.logEvents.indexOf(name) !== -1
  }

  function tryAddEvent (server, options, type, event, cb) {
    const name = typeof event === 'string' ? event : event.name
    if (isEnabledLogEvent(options, name)) {
      if (type === 'on') {
        server.events.on(event, cb)
      } else if (type === 'ext') {
        server.ext(event, cb)
      } else {
        throw new Error(`unsupported type ${type}`)
      }
    }
  }

  function logEvent (current, event) {
    // check for null logger
    if (current === nullLogger) {
      return
    }

    const tags = event.tags
    let data = event.data

    let logObject
    if (mergeHapiLogData) {
      if (typeof data === 'string' || typeof data === 'number') {
        data = { [messageKey]: data }
      }

      logObject = Object.assign({ tags }, data)
    } else {
      logObject = { tags, data }
    }

    let highest = 0

    for (const tag of tags) {
      const level = tagToLevelValue[tag]
      if (level && level > highest) {
        highest = level
      }
    }

    if (highest > 0) {
      current[current.levels.labels[highest]](logObject)
    } else {
      current[allTags](logObject)
    }
  }
}

module.exports = {
  register,
  name: 'hapi-pino'
}
