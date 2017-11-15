'use strict'

const pino = require('pino')

const levels = ['trace', 'debug', 'info', 'warn', 'error']
const levelTags = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error'
}

async function register (server, options) {
  options.serializers = options.serializers || {}
  options.serializers.req = options.serializers.req || asReqValue
  options.serializers.res = options.serializers.res || pino.stdSerializers.res
  options.serializers.err = options.serializers.err || pino.stdSerializers.err

  if (options.logEvents === undefined) {
    options.logEvents = ['onPostStart', 'onPostStop', 'response', 'request-error']
  }

  var logger
  if (options.instance) {
    options.instance.serializers = Object.assign(options.serializers, options.instance.serializers)
    logger = options.instance
  } else {
    options.stream = options.stream || process.stdout
    var stream = options.stream || process.stdout

    if (options.prettyPrint) {
      // pino has a similar logic that works slightly different
      // we must disable that
      delete options.prettyPrint
      var pretty = pino.pretty()
      pretty.pipe(stream)
      stream = pretty
    }

    logger = pino(options, stream)
  }

  const tagToLevels = Object.assign({}, levelTags, options.tags)
  const allTags = options.allTags || 'info'

  const validTags = Object.keys(tagToLevels).filter((key) => levels.indexOf(tagToLevels[key]) < 0).length === 0
  if (!validTags || (allTags && levels.indexOf(allTags) < 0)) {
    throw new Error('invalid tag levels')
  }

  const mergeHapiLogData = options.mergeHapiLogData

  // expose logger as 'server.logger()'
  server.decorate('server', 'logger', () => logger)

  // set a logger for each request
  server.ext('onRequest', (request, h) => {
    request.logger = logger.child({ req: request })
    return h.continue
  })

  server.events.on('log', function (event) {
    logEvent(logger, event)
  })

  // log via `request.log()` and optionally when an internal `accept-encoding`
  // error occurs or request completes with an error
  server.events.on('request', function (request, event, tags) {
    if (event.channel === 'internal' && !tags['accept-encoding']) {
      return
    }

    request.logger = request.logger || logger.child({ req: request })

    if (event.error && isEnabledLogEvent(options, 'request-error')) {
      request.logger.warn({
        err: event.error
      }, 'request error')
    } else if (event.channel === 'app') {
      logEvent(request.logger, event)
    }
  })

  // log when a request completes
  tryAddEvent(server, options, 'on', 'response', function (request) {
    const info = request.info
    request.logger.info({
      payload: options.logPayload ? request.payload : undefined,
      res: request.raw.res,
      responseTime: info.responded - info.received
    }, 'request completed')
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
    var tags = event.tags
    var data = event.data
    var level
    var found = false

    var logObject
    if (mergeHapiLogData) {
      if (typeof data === 'string') {
        data = { msg: data }
      }

      logObject = Object.assign({ tags }, data)
    } else {
      logObject = { tags, data }
    }

    for (var i = 0; i < tags.length; i++) {
      level = tagToLevels[tags[i]]
      if (level) {
        current[level](logObject)
        found = true
        break
      }
    }

    if (!found && allTags) {
      current[allTags](logObject)
    }
  }
}

function asReqValue (req) {
  const raw = req.raw.req
  return {
    id: req.info.id,
    method: raw.method,
    url: raw.url,
    headers: raw.headers,
    remoteAddress: raw.connection.remoteAddress,
    remotePort: raw.connection.remotePort
  }
}

module.exports = {
  register,
  name: 'hapi-pino'
}
