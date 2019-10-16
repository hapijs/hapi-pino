'use strict'

const Hoek = require('@hapi/hoek')
const pino = require('pino')
const { stdSerializers } = pino
const serializersSym = Symbol.for('pino.serializers')
const nullLogger = require('abstract-logging')

const levels = ['trace', 'debug', 'info', 'warn', 'error']
const levelTags = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error'
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
    options.stream = options.stream || process.stdout
    var stream = options.stream || process.stdout
    logger = pino(options, stream)
  }

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

  const mergeHapiLogData = options.mergeHapiLogData
  const getChildBindings = options.getChildBindings ? options.getChildBindings : (request) => ({ req: request })
  const logRequestStart = options.logRequestStart

  // expose logger as 'server.logger()'
  server.decorate('server', 'logger', () => logger)

  // set a logger for each request
  server.ext('onRequest', (request, h) => {
    if (options.ignorePaths && ignoreTable[request.url.pathname]) {
      request.logger = nullLogger
      return h.continue
    }

    const childBindings = getChildBindings(request)
    request.logger = logger.child(childBindings)

    if (logRequestStart) {
      request.logger.info({
        req: request
      }, 'request start')
    }

    return h.continue
  })

  server.events.on('log', function (event) {
    if (event.error) {
      logger.error({ err: event.error })
    } else {
      logEvent(logger, event)
    }
  })

  // log via `request.log()` and optionally when an internal `accept-encoding`
  // error occurs or request completes with an error
  server.events.on('request', function (request, event, tags) {
    if (event.channel === 'internal' && !tags['accept-encoding']) {
      return
    }

    const childBindings = getChildBindings(request)
    request.logger = request.logger || logger.child(childBindings)

    if (event.error && isEnabledLogEvent(options, 'request-error')) {
      request.logger.error(
        {
          err: event.error
        },
        'request error'
      )
    } else if (event.channel === 'app') {
      logEvent(request.logger, event)
    }
  })

  // log when a request completes
  tryAddEvent(server, options, 'on', 'response', function (request) {
    if (options.ignorePaths && ignoreTable[request.url.pathname]) {
      return
    }

    const info = request.info
    request.logger.info(
      {
        payload: options.logPayload ? request.payload : undefined,
        tags: options.logRouteTags ? request.route.settings.tags : undefined,
        // note: pino doesnt support unsetting a key, so this next line
        // has the effect of setting it or "leaving it as it was" if it was already added via child bindings
        req: logRequestStart ? undefined : request,
        res: request.raw.res,
        responseTime: (info.completed !== undefined ? info.completed : info.responded) - info.received
      },
      'request completed'
    )
  })

  tryAddEvent(server, options, 'ext', 'onPostStart', async function (s) {
    logger.info(server.info, 'server started')
  })

  tryAddEvent(server, options, 'ext', 'onPostStop', async function (s) {
    logger.info(server.info, 'server stopped')
  })

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
        data = { msg: data }
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
