'use strict'

const pino = require('pino')

function register (server, options, next) {
  const logger = pino(options, options.stream)

  // expose logger as 'server.loginfo()' etc methods
  ;['trace', 'debug', 'info', 'warn', 'error'].forEach((level) => {
    server.decorate('server', 'log' + level, logger[level].bind(logger))
  })

  // expose logger as 'server.app.logger'
  server.app.logger = logger

  // expose logger as 'server.logger()'
  server.decorate('server', 'logger', () => logger)

  next()
}

module.exports.register = register
module.exports.register.attributes = {
  pkg: require('./package'),
  connections: false
}
