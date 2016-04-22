'use strict'

const pino = require('pino')

const levels = ['trace', 'debug', 'info', 'warn', 'error']

function register (server, options, next) {
  options.stream = options.stream || process.stdout
  options.serializers = options.serializers || {}
  options.serializers.req = asReqValue
  options.serializers.res = pino.stdSerializers.res
  options.serializers.err = pino.stdSerializers.err

  const tagToLevels = options.tags || {}
  const allTags = options.allTags || 'info'

  const validTags = Object.keys(tagToLevels).filter((key) => levels.indexOf(tagToLevels[key]) < 0).length === 0
  if (!validTags || allTags && levels.indexOf(allTags) < 0) {
    return next(new Error('invalid tag levels'))
  }

  let stream = options.stream || process.stdout

  if (options.prettyPrint) {
    let pretty = pino.pretty()
    pretty.pipe(stream)
    stream = pretty
  }

  const logger = pino(options, stream)

  // expose logger as 'server.app.logger'
  server.app.logger = logger

  // expose logger as 'server.logger()'
  server.decorate('server', 'logger', () => logger)

  // set a logger for each request
  server.ext('onRequest', (request, reply) => {
    request.logger = logger.child({ req: request })
    reply.continue()
  })

  server.on('log', (event) => {
    logEvent(logger, event)
  })

  server.on('request', (request, event) => {
    logEvent(request.logger, event)
  })

  // log when a request completes with an error
  server.on('request-error', (request, err) => {
    request.logger.warn({
      res: request.raw.res,
      err: err
    }, 'request error')
  })

  // log when a request completes
  server.on('response', (request) => {
    const info = request.info
    request.logger.info({
      res: request.raw.res,
      responseTime: info.responded - info.received
    }, 'request completed')
  })

  server.ext('onPostStart', () => {
    logger.info(server.info, 'server started')
  })

  server.ext('onPostStop', () => {
    logger.info(server.info, 'server stopped')
  })

  next()

  function logEvent (current, event) {
    const tags = event.tags
    const data = event.data
    for (var i = 0; i < tags.length; i++) {
      let level = tagToLevels[tags[i]]
      if (level) {
        current[level]({ tags, data })
        return
      }
    }
    if (allTags) {
      current[allTags]({ tags, data })
    }
  }
}

function asReqValue (req) {
  const raw = req.raw.req
  return {
    id: req.id,
    method: raw.method,
    url: raw.url,
    headers: raw.headers,
    remoteAddress: raw.connection.remoteAddress,
    remotePort: raw.connection.remotePort
  }
}

module.exports.register = register
module.exports.register.attributes = {
  pkg: require('./package')
}
