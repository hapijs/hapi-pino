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

server.register({ register: require('..'), options: { mergeHapiLogData: true } }, (err) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }

  server.on('response', () => {
    server.log(['info'], { hello: 'world' })
  })

  server.start((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }
  })
})
