'use strict'

const Code = require('code')
const Lab = require('lab')
const split = require('split2')
const writeStream = require('flush-write-stream')

const lab = exports.lab = Lab.script()
const experiment = lab.experiment
const test = lab.test
const expect = Code.expect

const Hapi = require('hapi')
const Pino = require('.')

function getServer () {
  const server = new Hapi.Server()
  server.connection({ port: 3000 })
  return server
}

function sink (func) {
  var result = split(JSON.parse)
  result.pipe(writeStream.obj(func))
  return result
}

function registerWithSink (server, level, func, registered) {
  const stream = sink(func)
  const plugin = {
    register: Pino.register,
    options: {
      stream: stream,
      level: level
    }
  }

  server.register(plugin, registered)
}

function onHelloWorld (data) {
  expect(data.msg).to.equal('hello world')
}

function ltest (func) {
  ;['trace', 'debug', 'info', 'warn', 'error'].forEach((level) => {
    test(`at ${level}`, (done) => {
      func(level, done)
    })
  })
}

experiment('logs through the server', () => {
  ltest((level, done) => {
    const server = getServer()
    registerWithSink(server, level, onHelloWorld, (err) => {
      expect(err).to.be.undefined()
      server['log' + level]('hello world')
      done()
    })
  })
})

experiment('logs through the server.app.logger', () => {
  ltest((level, done) => {
    const server = getServer()
    registerWithSink(server, level, onHelloWorld, (err) => {
      expect(err).to.be.undefined()
      server.app.logger[level]('hello world')
      done()
    })
  })
})

experiment('logs through the server.logger()', () => {
  ltest((level, done) => {
    const server = getServer()
    registerWithSink(server, level, onHelloWorld, (err) => {
      expect(err).to.be.undefined()
      server.logger()[level]('hello world')
      done()
    })
  })
})

test('log on server start', (done) => {
  const server = getServer()
  registerWithSink(server, 'info', (data, enc, cb) => {
    expect(data).to.include(server.info)
    expect(data.msg).to.equal('server started')
    cb()
    done()
  }, (err) => {
    expect(err).to.be.undefined()
    server.start((err) => {
      console.log('server started')
      expect(err).to.be.null()
    })
  })
})

experiment('logs each request', () => {
  test('at default level', (done) => {
    const server = getServer()
    registerWithSink(server, 'info', (data) => {
      expect(data.res.statusCode).to.equal(404)
      expect(data.req.id).to.exist()
      expect(data.msg).to.equal('request completed')
      done()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })

  test('correctly set the status code', (done) => {
    const server = getServer()
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => reply('hello world')
    })
    registerWithSink(server, 'info', (data, enc, cb) => {
      expect(data.req.id).to.exist()
      expect(data.res.statusCode).to.equal(200)
      expect(data.msg).to.equal('request completed')
      cb()
      done()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })

  test('handles 500s', (done) => {
    const server = getServer()
    let count = 0
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => reply(new Error('boom'))
    })
    registerWithSink(server, 'info', (data, enc, cb) => {
      expect(data.req.id).to.exist()
      if (count === 0) {
        expect(data.err.message).to.equal('boom')
        expect(data.level).to.equal(40)
        expect(data.msg).to.equal('request error')
      } else {
        expect(data.res.statusCode).to.equal(500)
        expect(data.level).to.equal(30)
        expect(data.msg).to.equal('request completed')
        done()
      }
      count++
      cb()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })

  test('set the request logger', (done) => {
    const server = getServer()
    let count = 0
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => {
        req.logger.info('hello logger')
        reply('hello world')
      }
    })
    registerWithSink(server, 'info', (data, enc, cb) => {
      expect(data.req.id).to.exist()
      if (count === 0) {
        expect(data.msg).to.equal('hello logger')
      } else {
        expect(data.res.statusCode).to.equal(200)
        expect(data.msg).to.equal('request completed')
        done()
      }
      count++
      cb()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })
})
