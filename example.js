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
    request.log(['a', 'b'], 'Request into hello world')
    request.logger.info('In handler %s', request.path)
    return reply('hello world')
  }
})

server.register({
  register: require('.').register,
  options: {
    extreme: false,
    allTags: 'info'
  }
}, (err) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }

  server.app.logger.warn('Pino is registered')
  server.logger().info('another way for accessing it')
  server.log(['subsystem'], 'third way for accessing it')

  // Start the server
  server.start((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }
  })
})
