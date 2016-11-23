'use strict'

const Hapi = require('hapi')
const pino = require('pino')
const PinoStream = require('./stream.js')

// Create a server with a host and port
const server = new Hapi.Server()
server.connection({
  host: 'localhost',
  port: process.env.PORT || 3000
})

// Add the route
server.route({
  method: 'GET',
  path: '/',
  handler: function (request, reply) {
    // request.log is HAPI standard way of logging
    request.log(['a', 'b'], 'Request into hello world')

    return reply('hello world')
  }
})

var pretty = pino.pretty()

pretty.pipe(process.stdout)

server.register({
  register: require('good'),
  options: {
    reporters: {
      pinoReporter: [new PinoStream(pino({}, process.stdout))]
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
