'use strict'

const Hapi = require('hapi')

const server = new Hapi.Server()
server.connection({
  host: 'localhost',
  port: 3000
})

server.route({
  method: 'GET',
  path: '/',
  handler: function (request, reply) {
    return reply('hello world')
  }
})

server.register(require('..'), (err) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }

  server.start((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }
  })
})
