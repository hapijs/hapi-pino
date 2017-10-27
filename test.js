'use strict'

const Code = require('code')
const Lab = require('lab')
const split = require('split2')
const writeStream = require('flush-write-stream')
const promisify = require('util').promisify
const sleep = promisify(setTimeout)

const lab = exports.lab = Lab.script()
const experiment = lab.experiment
const test = lab.test
const before = lab.before
const beforeEach = lab.beforeEach
const after = lab.after
const afterEach = lab.afterEach
const expect = Code.expect

const Hapi = require('hapi')
const Pino = require('.')

function getServer () {
  const server = Hapi.server({ autoListen: false })
  server.route([
    {
      method: 'POST',
      path: '/',
      handler: async (request, h) => 'ok'
    },
    {
      method: 'GET',
      path: '/error',
      handler: async (request, h) => { throw new Error('foobar') }
    }
  ])

  return server
}

function sink (func) {
  var result = split(JSON.parse)
  result.pipe(writeStream.obj(func))
  return result
}

async function registerWithSink (server, level, func) {
  const stream = sink(func)
  const plugin = {
    plugin: Pino,
    options: {
      stream: stream,
      level: level
    }
  }

  await server.register(plugin)
}

async function tagsWithSink (server, tags, func) {
  const stream = sink(func)
  const plugin = {
    plugin: Pino,
    options: {
      stream: stream,
      level: 'trace',
      tags: tags
    }
  }

  await server.register(plugin)
}

function onHelloWorld (data) {
  expect(data.msg).to.equal('hello world')
}

function ltest (func) {
  ;['trace', 'debug', 'info', 'warn', 'error'].forEach((level) => {
    test(`at ${level}`, async () => {
      await func(level)
    })
  })
}

experiment('logs through the server.app.logger', () => {
  ltest(async (level) => {
    const server = getServer()
    await registerWithSink(server, level, onHelloWorld)
    server.app.logger[level]('hello world')
  })
})

experiment('logs through the server.logger()', () => {
  ltest(async (level) => {
    const server = getServer()
    await registerWithSink(server, level, onHelloWorld)
    server.logger()[level]('hello world')
  })
})

experiment('log on server start', () => {
  let server

  before(async () => {
    server = Hapi.server({ port: 0 })
  })

  after(async () => {
    await server.stop()
  })

  test('log on server start', async () => {
    let executed = false
    let finish

    const done = new Promise(function (resolve, reject) {
      finish = resolve
    })

    await registerWithSink(server, 'info', (data, enc, cb) => {
      if (!executed) {
        executed = true
        expect(data).to.include(server.info)
        expect(data.msg).to.equal('server started')
        cb()
        finish()
      }
    })

    await server.start()

    await done
  })
})

experiment('logs each request', () => {
  test('at default level', (done) => {
    const server = getServer()
    registerWithSink(server, 'info', (data) => {
      expect(data.req.id).to.exists()
      expect(data.res.statusCode).to.equal(404)
      expect(data.msg).to.equal('request completed')
      expect(data.responseTime).to.be.at.least(0)
      done()
    }).then(() => {
      return server.inject('/')
    }).catch(done)
  })

  test('track responseTime', (done) => {
    const server = getServer()

    server.route({
      path: '/',
      method: 'GET',
      handler: async (req, h) => {
        await sleep(10)
        return 'hello world'
      }
    })

    registerWithSink(server, 'info', (data) => {
      expect(data.res.statusCode).to.equal(200)
      expect(data.msg).to.equal('request completed')
      expect(data.responseTime).to.be.at.least(10)
      done()
    }).then(() => {
      server.inject('/')
    }).catch(done)
  })

  test('correctly set the status code', (done) => {
    const server = getServer()
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, h) => 'hello world'
    })
    registerWithSink(server, 'info', (data, enc, cb) => {
      expect(data.res.statusCode).to.equal(200)
      expect(data.msg).to.equal('request completed')
      cb()
      done()
    }).then(() => {
      server.inject('/')
    }).catch(done)
  })

  test('handles 500s', (done) => {
    const server = getServer()
    let count = 0
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => { throw new Error('boom') }
    })
    registerWithSink(server, 'info', (data, enc, cb) => {
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
    }).then(() => {
      server.inject('/')
    }).catch(done)
  })

  test('handles bad encoding', (done) => {
    const server = getServer()
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, h) => ''
    })
    registerWithSink(server, 'info', (data, enc) => {
      expect(data.err.header).equal('a;b')
      done()
    }).then(() => {
      server.inject({
        url: '/',
        headers: { 'accept-encoding': 'a;b' }
      })
    }).catch(done)
  })

  test('set the request logger', (done) => {
    const server = getServer()
    let count = 0
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, h) => {
        req.logger.info('hello logger')
        return 'hello world'
      }
    })
    registerWithSink(server, 'info', (data, enc, cb) => {
      if (count === 0) {
        expect(data.msg).to.equal('hello logger')
      } else {
        expect(data.res.statusCode).to.equal(200)
        expect(data.msg).to.equal('request completed')
        done()
      }
      count++
      cb()
    }).then(() => {
      server.inject('/')
    }).catch(done)
  })
})

experiment('logs through server.log', () => {
  ltest(async (level) => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })

    await tagsWithSink(server, {
      aaa: 'info'
    }, (data) => {
      expect(data.data).to.equal('hello world')
      resolver()
    })
    server.log(['aaa'], 'hello world')

    await done
  })

  test('one log for multiple tags', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })

    await tagsWithSink(server, {
      aaa: 'info',
      bbb: 'warn'
    }, (data) => {
      expect(data.data).to.equal('hello world')
      // first matching tag
      expect(data.level).to.equal(30)
      resolver()
    })

    server.log(['aaa', 'bbb'], 'hello world')
    await done
  })

  test('explode with a wrong level', async () => {
    const server = getServer()
    try {
      await server.register({
        plugin: Pino,
        options: {
          tags: {
            bbb: 'not a level'
          }
        }
      })
    } catch (err) {
      return
    }

    throw new Error('expected error')
  })

  test('with tag catchall', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.data).to.equal('hello world')
      expect(data.level).to.equal(20)
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'debug',
        allTags: 'debug'
      }
    }

    server.register(plugin).then(() => {
      server.log(['something'], 'hello world')
    })
  })

  test('default tag catchall', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.data).to.equal('hello world')
      expect(data.level).to.equal(30)
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream
      }
    }

    server.register(plugin).then(() => {
      server.log(['something'], 'hello world')
    })
  })
})

experiment('logs through request.log', () => {
  ltest((level, done) => {
    const server = getServer()
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => {
        req.log(['aaa'], 'hello logger')
        reply('hello world')
      }
    })
    tagsWithSink(server, {
      aaa: level
    }, (data, enc, cb) => {
      if (data.tags) {
        expect(data.data).to.equal('hello logger')
        done()
      }
      cb()
    }, (err) => {
      expect(err).to.be.undefined()
      server.inject('/')
    })
  })

  test('uses default tag mapping', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.data).to.equal('hello world')
      expect(data.level).to.equal(20)
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'debug'
      }
    }

    server.register(plugin).then(() => {
      server.log(['debug'], 'hello world')
    })
  })
})

experiment('disables log events', () => {
  let server

  beforeEach((cb) => {
    server = Hapi.server({ port: 0 })
    cb()
  })

  afterEach((cb) => {
    if (server) {
      server.stop()
    }
    cb()
  })

  test('server-start', async () => {
    let called = false
    const stream = sink(() => {
      called = true
    })

    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        logEvents: false
      }
    }

    await server.register(plugin)
    await server.start()
    expect(called).to.be.false()
  })

  test('server-stop', async () => {
    let called = false
    const stream = sink(() => {
      called = true
    })

    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        logEvents: false
      }
    }

    await server.register(plugin)
    await server.start()
    await server.stop()
    expect(called).to.be.false()
  })

  test('response', async () => {
    let called = false
    const stream = sink(() => {
      called = true
    })

    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        logEvents: false
      }
    }

    await server.register(plugin)
    await server.inject('/')
    expect(called).to.be.false()
  })

  test('request-error', (done) => {
    let called = false
    const stream = sink(() => {
      called = true
    })

    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        logEvents: false
      }
    }

    server.register(plugin).then(() => {
      server.route({
        method: 'GET',
        path: '/',
        handler: (request, h) => {
          return new Error('boom')
        }
      })

      return server.inject('/').then(() => {
        expect(called).to.be.false()
      })
    }).then(done).catch(done)
  })
})

experiment('uses a prior pino instance', () => {
  test('without pre-defined serializers', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.data).to.equal('hello world')
      expect(data.level).to.equal(30)
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger
      }
    }

    server.register(plugin).then(() => {
      server.log(['something'], 'hello world')
    }).catch(done)
  })

  test('with pre-defined serializers', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.msg).to.equal('hello world')
      expect(data.foo).to.exist()
      expect(data.foo.serializedFoo).to.exist()
      expect(data.foo.serializedFoo).to.equal('foo is bar')
      expect(data.level).to.equal(30)
      done()
    })
    const logger = require('pino')({
      serializers: {
        foo: (input) => {
          return { serializedFoo: `foo is ${input}` }
        }
      }
    }, stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger
      }
    }

    server.register(plugin).then(() => {
      server.app.logger.info({foo: 'bar'}, 'hello world')
    }).catch(done)
  })
})

experiment('logging with mergeHapiLogData option enabled', () => {
  test('log event data is merged into pino\'s log object', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data).to.include({ hello: 'world' })
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        mergeHapiLogData: true
      }
    }

    server.register(plugin).then(() => {
      server.log(['info'], { hello: 'world' })
    }).catch(done)
  })

  test('when data is string, merge it as msg property', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data).to.include({ msg: 'hello world' })
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        mergeHapiLogData: true
      }
    }

    server.register(plugin).then(() => {
      server.log(['info'], 'hello world')
    }).catch(done)
  })
})

experiment('logging with overridden serializer', () => {
  test('with pre-defined req serializer', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.req.uri).to.equal('/')
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        serializers: {
          req: (req) => ({ uri: req.raw.req.url })
        }
      }
    }

    server.register(plugin).then(() => {
      server.inject({
        method: 'GET',
        url: '/'
      })
    }).catch(done)
  })

  test('with pre-defined res serializer', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.res.code).to.equal(404)
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        serializers: {
          res: (res) => ({ code: res.statusCode })
        }
      }
    }

    server.register(plugin).then(() => {
      server.inject({
        method: 'GET',
        url: '/'
      })
    }).catch(done)
  })

  test('with pre-defined err serializer', (done) => {
    const server = getServer()
    const stream = sink((data) => {
      expect(data.err.errStack).to.not.be.undefined()
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        serializers: {
          err: (err) => ({ errStack: err.stack })
        }
      }
    }

    server.register(plugin).then(() => {
      server.inject({
        method: 'GET',
        url: '/error'
      })
    }).catch(done)
  })
})

experiment('logging with request payload', () => {
  test('with pre-defined req serializer', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink((data) => {
      expect(data.payload).to.equal({ foo: 42 })
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logPayload: true
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'POST',
      url: '/',
      payload: {
        foo: 42
      }
    })

    await done
  })
})
