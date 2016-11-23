'use strict'

const Hapi = require('hapi')

// Create a server with a host and port
const server = new Hapi.Server()
server.connection({
  host: 'localhost',
  port: 3000
})

// Add the route
server.route({
  method: 'GET',
  path: '/',
  handler: function (request, reply) {
    // request.log is HAPI standard way of logging
    request.log(['a', 'b'], 'Request into hello world')

    // you can also use a pino instance, which will be faster
    // request.logger.info('In handler %s', request.path)

    return reply('hello world')
  }
})

server.register({
  register: require('.').register,
  options: {
    // prettyPrint: process.env.NODE_ENV !== 'production'
  }
}, (err) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }

  // the logger is available in server.app
  server.app.logger.warn('Pino is registered')

  // also as a decorated API
  server.logger().info('another way for accessing it')

  // and through Hapi standard logging system
  server.log(['subsystem'], 'third way for accessing it')

  // Start the server
  server.start((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }
  })
})
