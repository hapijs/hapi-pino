'use strict'

const pino = require('pino')

const levels = ['trace', 'debug', 'info', 'warn', 'error']

function register (server, options, next) {
  options.stream = options.stream || process.stdout
  options.serializers = options.serializers || {}
  options.serializers.req = asReqValue
  options.serializers.res = pino.stdSerializers.res
  options.serializers.err = pino.stdSerializers.err

  const logger = pino(options, options.stream)

  // expose logger as 'server.loginfo()' etc methods
  levels.forEach((level) => {
    server.decorate('server', 'log' + level, logger[level].bind(logger))
  })

  // expose logger as 'server.app.logger'
  server.app.logger = logger

  // expose logger as 'server.logger()'
  server.decorate('server', 'logger', () => logger)

  // set a logger for each request
  server.ext('onRequest', (request, reply) => {
    request.logger = logger.child({ req: request })
    reply.continue()
  })

  server.on('log', (event, tags) => {
    Object.keys(tags).forEach((tag) => {
      if (levels.indexOf(tag) !== -1) {
        server['log' + tag](event)
      }
    })
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
