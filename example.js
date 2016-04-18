'use strict'

const Hapi = require('hapi')

// Create a server with a host and port
const server = new Hapi.Server()
server.connection({
  host: 'localhost',
  port: 3000
})

server.register(require('.'), (err) => {
  if (err) {
    throw err
  }
})

// Add the route
server.route({
  method: 'GET',
  path: '/',
  handler: function (request, reply) {
    return reply('hello world')
  }
})

// Start the server
server.start((err) => {
  if (err) {
    throw err
  }
  console.log('Server running at:', server.info.uri)
})
