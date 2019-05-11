'use strict'

require('make-promises-safe')

const Hapi = require('@hapi/hapi')

async function start () {
  const server = Hapi.server({ port: 3000 })

  server.route({
    method: 'GET',
    path: '/',
    handler: async function (request, h) {
      return 'hello world'
    }
  })

  await server.register({
    plugin: require('..'),
    options: {
      extreme: true
    }
  })
  await server.start()
}

start()
