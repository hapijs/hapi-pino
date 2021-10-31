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
  options.serializers.req = stdSerializers.wrapRequestSerializer(options.serializers.req || stdSerializers.req)
  options.serializers.res = stdSerializers.wrapResponseSerializer(options.serializers.res || stdSerializers.res)
  options.serializers.err = options.serializers.err || pino.stdSerializers.err

  if (options.logEvents === undefined) {
    options.logEvents = ['onPostStart', 'onPostStop', 'response', 'request-error']
  }

  var logger
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
    var stream = options.stream || process.stdout
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

  var ignoreTable = {}
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
        req: request
      }, 'request start')
    }

    return h.continue
  })

  server.events.on('log', function (event) {
    if (event.error) {
      logger.error({ err: event.error })
    } else if (!isCustomTagsLoggingIgnored(event, ignoredEventTags.log)) {
      logEvent(logger, event)
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
          err: event.error
        },
        'request error'
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
      if (!request.logger) {
        const childBindings = getChildBindings(request)
        request.logger = logger.child(childBindings)
      }
      request.logger.info(
        {
          payload: options.logPayload ? request.payload : undefined,
          queryParams: options.logQueryParams ? request.query : undefined,
          tags: options.logRouteTags ? request.route.settings.tags : undefined,
          // note: pino doesnt support unsetting a key, so this next line
          // has the effect of setting it or "leaving it as it was" if it was already added via child bindings
          req: shouldLogRequestStart(request) ? undefined : request,
          res: request.raw.res,
          responseTime: (info.completed !== undefined ? info.completed : info.responded) - info.received
        },
        'request completed'
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

    for (var index = ignoreTags.length; index >= 0; index--) {
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
    var name = typeof event === 'string' ? event : event.name
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

    var tags = event.tags
    var data = event.data

    var logObject
    if (mergeHapiLogData) {
      if (typeof data === 'string') {
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
