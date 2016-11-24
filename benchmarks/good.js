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
    return reply('hello world')
  }
})

server.register({
  register: require('good'),
  options: {
    reporters: {
      myConsoleReporter: [{
        module: 'good-console'
      }, 'stdout']
    }
  }
}, (err) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }

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
