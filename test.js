'use strict'

const Code = require('@hapi/code')
const Lab = require('@hapi/lab')
const Hoek = require('@hapi/hoek')
const split = require('split2')
const writeStream = require('flush-write-stream')
const promisify = require('util').promisify
const sleep = promisify(setTimeout)

const lab = (exports.lab = Lab.script())
const experiment = lab.experiment
const test = lab.test
const before = lab.before
const beforeEach = lab.beforeEach
const after = lab.after
const afterEach = lab.afterEach
const expect = Code.expect

const Hapi = require('@hapi/hapi')
const Pino = require('.')

function getServer () {
  const server = Hapi.server({ autoListen: false })
  server.route([
    {
      method: 'GET',
      path: '/something',
      options: {
        tags: ['foo']
      },
      handler: async (request, h) => 'ok'
    },
    {
      method: 'POST',
      path: '/',
      handler: async (request, h) => 'ok'
    },
    {
      method: 'GET',
      path: '/error',
      handler: async (request, h) => {
        throw new Error('foobar')
      }
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
  ;['trace', 'debug', 'info', 'warn', 'error'].forEach(level => {
    test(`at ${level}`, async () => {
      await func(level)
    })
  })
}

test('server.app.logger is undefined', async () => {
  const server = getServer()
  await registerWithSink(server, 'info', () => {
    throw new Error('fail')
  })
  expect(server.app.logger).to.be.undefined()
})

experiment('logs through the server.logger', () => {
  ltest(async level => {
    const server = getServer()
    await registerWithSink(server, level, onHelloWorld)
    server.logger[level]('hello world')
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
  test('at default level', async () => {
    const server = getServer()
    let done

    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    await registerWithSink(server, 'info', data => {
      expect(data.req.id).to.exists()
      expect(data.res.statusCode).to.equal(200)
      expect(data.msg).to.equal('request completed')
      expect(data.responseTime).to.be.at.least(0)
      done()
    })

    await server.inject('/something')

    await finish
  })

  test('track responseTime', async () => {
    const server = getServer()

    let done

    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    server.route({
      path: '/',
      method: 'GET',
      handler: async (req, h) => {
        await sleep(10)
        return 'hello world'
      }
    })

    await registerWithSink(server, 'info', data => {
      expect(data.res.statusCode).to.equal(200)
      expect(data.msg).to.equal('request completed')
      expect(data.responseTime).to.be.at.least(10)
      done()
    })

    await server.inject('/')
    await finish
  })

  test('track responseTime when server closes connection prematurely', async () => {
    const server = getServer()

    let done

    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    server.route({
      path: '/',
      method: 'GET',
      handler: async (req, h) => {
        await sleep(10)
        return 'hello world'
      }
    })

    await registerWithSink(server, 'info', data => {
      expect(data.res.statusCode).to.equal(200)
      expect(data.msg).to.equal('request completed')
      expect(data.responseTime)
        .to.be.a.number()
        .greaterThan(0)
      done()
    })

    server.inject({
      url: '/',
      method: 'GET',
      simulate: {
        close: true
      }
    })

    await finish
  })

  test('correctly set the status code', async () => {
    const server = getServer()

    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    server.route({
      path: '/',
      method: 'GET',
      handler: (req, h) => 'hello world'
    })
    await registerWithSink(server, 'info', (data, enc, cb) => {
      expect(data.res.statusCode).to.equal(200)
      expect(data.msg).to.equal('request completed')
      cb()
      done()
    })
    await server.inject('/')
    await finish
  })

  test('handles 500s', async () => {
    const server = getServer()
    let count = 0
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, reply) => {
        throw new Error('boom')
      }
    })
    await registerWithSink(server, 'info', (data, enc, cb) => {
      if (count === 0) {
        expect(data.err.message).to.equal('boom')
        expect(data.level).to.equal(50)
        expect(data.msg).to.equal('request error')
      } else {
        expect(data.res.statusCode).to.equal(500)
        expect(data.level).to.equal(30)
        expect(data.msg).to.equal('request completed')
        done()
      }
      count++
      cb()
    })
    await server.inject('/')
    await finish
  })

  test('handles bad encoding', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, h) => ''
    })
    await registerWithSink(server, 'info', (data, enc) => {
      expect(data.err.header).equal('a;b')
      done()
    })
    await server.inject({
      url: '/',
      headers: { 'accept-encoding': 'a;b' }
    })
    await finish
  })

  test('set the request logger', async () => {
    const server = getServer()
    let count = 0
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, h) => {
        req.logger.info('hello logger')
        return 'hello world'
      }
    })
    await registerWithSink(server, 'info', (data, enc, cb) => {
      if (count === 0) {
        expect(data.msg).to.equal('hello logger')
      } else {
        expect(data.res.statusCode).to.equal(200)
        expect(data.msg).to.equal('request completed')
        done()
      }
      count++
      cb()
    })
    await server.inject('/')
    await finish
  })

  test('does not mutate options object', async () => {
    const options = {
      prettyPrint: true,
      instance: require('pino')()
    }

    let plugin
    let optionsClone

    async function register (server) {
      plugin = {
        plugin: Pino,
        options
      }

      optionsClone = Hoek.clone(options)
      await server.register(plugin)
    }

    await register(getServer())

    delete options.instance
    delete optionsClone.instance

    expect(options).to.equal(optionsClone)
  })

  test('handles removed request.logger', async () => {
    const server = getServer()

    let done

    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    server.route({
      path: '/',
      method: 'GET',
      handler: async (req, h) => {
        req.logger = undefined
        return 'hello world'
      }
    })

    await registerWithSink(server, 'info', data => {
      expect(data.res.statusCode).to.equal(200)
      expect(data.msg).to.equal('request completed')
      done()
    })

    await server.inject('/')
    await finish
  })
})

experiment('logs through server.log', () => {
  ltest(async level => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })

    await tagsWithSink(
      server,
      {
        aaa: 'info'
      },
      data => {
        expect(data.data).to.equal('hello world')
        resolver()
      }
    )
    server.log(['aaa'], 'hello world')

    await done
  })

  test('with logged error object', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })

    await tagsWithSink(server, {}, data => {
      expect(data.err.type).to.equal('Error')
      expect(data.err.message).to.equal('foobar')
      expect(data.err.stack).to.exist()
      // highest level tag
      expect(data.level).to.equal(50)
      resolver()
    })

    server.log(['error'], new Error('foobar'))
    await done
  })

  test('one log for multiple tags', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })

    await tagsWithSink(
      server,
      {
        aaa: 'info',
        bbb: 'warn'
      },
      data => {
        expect(data.data).to.equal('hello world')
        // highest level tag
        expect(data.level).to.equal(40)
        resolver()
      }
    )

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

  test('with tag catchall', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
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

    await server.register(plugin)
    server.log(['something'], 'hello world')
    await finish
  })

  test('default tag catchall', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
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

    await server.register(plugin)
    server.log(['something'], 'hello world')
    await finish
  })

  test('allow tags to point to a custom level defined in pino\'s customLevels', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.level).to.equal(123)
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        customLevels: {
          bar: 123
        },
        tags: {
          foo: 'bar'
        }
      }
    }
    await server.register(plugin)

    server.log(['foo'], 'hello world')
    await finish
  })
})

experiment('logs through request.log', () => {
  ltest(async level => {
    const server = getServer()
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, h) => {
        req.log(['aaa'], 'hello logger')
        return 'hello world'
      }
    })

    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })

    await tagsWithSink(
      server,
      {
        aaa: level
      },
      (data, enc, cb) => {
        if (data.tags) {
          expect(data.data).to.equal('hello logger')
          resolver()
        }
        cb()
      }
    )

    await server.inject('/')
    await done
  })

  test('with logged error object', async () => {
    const server = getServer()
    server.route({
      path: '/',
      method: 'GET',
      handler: (req, h) => {
        req.log(['error', 'tag'], new Error('foobar'))
        return 'hello world'
      }
    })

    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })

    await tagsWithSink(server, {}, (data) => {
      expect(data.tags).to.equal(['error', 'tag'])
      expect(data.err.type).to.equal('Error')
      expect(data.err.message).to.equal('foobar')
      expect(data.err.stack).to.exist()
      // highest level tag
      expect(data.level).to.equal(50)

      resolver()
    })

    await server.inject('/')
    await done
  })

  test('uses default tag mapping', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
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

    await server.register(plugin)
    server.log(['debug'], 'hello world')
    await finish
  })
})

experiment('disables log events', () => {
  let server

  beforeEach(() => {
    server = Hapi.server({ port: 0 })
  })

  afterEach(async () => {
    if (server) {
      await server.stop()
    }
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

  test('request-error', async () => {
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
    server.route({
      method: 'GET',
      path: '/',
      handler: (request, h) => {
        return new Error('boom')
      }
    })

    await server.inject('/')
    expect(called).to.be.false()
  })
})

experiment('logging with `request` event listener', () => {
  test('with enabled `request-error`', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.err.stack).to.not.be.undefined()
      expect(data.err.isBoom).to.be.true()
      expect(data.err.output.statusCode).to.be.equal(500)
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logEvents: ['request-error']
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/error'
    })

    await finish
  })

  test('with disabled `request-error`', async () => {
    const server = getServer()
    let called = false
    const stream = sink(() => {
      called = true
    })

    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        logEvents: false
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/error'
    })

    expect(called).to.be.false()
  })
})

experiment('uses a prior pino instance', () => {
  test('without pre-defined serializers', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
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

    await server.register(plugin)
    server.log(['something'], 'hello world')
    await finish
  })

  test('with pre-defined serializers', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.msg).to.equal('hello world')
      expect(data.foo).to.exist()
      expect(data.foo.serializedFoo).to.exist()
      expect(data.foo.serializedFoo).to.equal('foo is bar')
      expect(data.level).to.equal(30)
      done()
    })
    const logger = require('pino')(
      {
        serializers: {
          foo: input => {
            return { serializedFoo: `foo is ${input}` }
          }
        }
      },
      stream
    )
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger
      }
    }

    await server.register(plugin)
    server.logger.info({ foo: 'bar' }, 'hello world')
    await finish
  })
})

experiment('request.logger.child() bindings', () => {
  test('request.logger.child() bindings are { req: request } by default', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    const stream = sink(data => {
      expect(data.req).to.not.be.undefined()
      expect(data.req.id).to.not.be.undefined()
      expect(data.custom).to.be.undefined()
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info'
      }
    }

    await server.register(plugin)
    await server.inject('/something')
    await finish
  })

  test('request.logger.child() bindings can be provided via getChildBindings(request)', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.req).to.not.be.undefined()
      expect(data.custom).to.not.be.undefined()
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        getChildBindings: (req) => ({ custom: true })
      }
    }

    await server.register(plugin)
    await server.inject('/something')
    await finish
  })
})

experiment('options.logRequestStart', () => {
  test('when options.logRequestStart is is default/omitted; only response events are logged, containing both the req and res', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    const stream = sink(data => {
      expect(data.msg).to.equal('request completed')
      expect(data.req).to.be.an.object()
      expect(data.req.id).to.exists()
      expect(data.res).to.be.an.object()
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info'
      }
    }

    await server.register(plugin)
    await server.inject('/something')
    await finish
  })

  test('when options.logRequestStart is false, only response events are logged, containing both the req and res', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    const stream = sink(data => {
      expect(data.msg).to.equal('request completed')
      expect(data.req).to.be.an.object()
      expect(data.req.id).to.exists()
      expect(data.res).to.be.an.object()
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info'
      }
    }

    await server.register(plugin)
    await server.inject('/something')
    await finish
  })

  test('when options.logRequestStart is true, log an event at the beginning of each request', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.msg).to.equal('request start')
      expect(data.req).to.be.an.object()
      expect(data.req.id).to.be.a.string()
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        logRequestStart: true
      }
    }

    await server.register(plugin)
    await server.inject('/something')
    await finish
  })

  test('when options.logRequestStart is a function, log an event at the beginning of each request if the function resolves to true for that request', async () => {
    const server = getServer()
    server.route({
      path: '/ignored',
      method: 'GET',
      handler: (req, h) => {
        return 'ignored'
      }
    })

    server.route({
      path: '/foo',
      method: 'GET',
      handler: (req, h) => {
        return 'foo'
      }
    })

    let done
    const finish = new Promise((resolve, reject) => {
      done = resolve
    })
    let count = 0
    const stream = sink((data, enc, cb) => {
      if (count === 0) {
        expect(data.req.url).to.endWith('/ignored')
        expect(data.msg).to.equal('request completed')
      } else if (count === 1) {
        expect(data.req.url).to.endWith('/foo')
        expect(data.msg).to.equal('request start')
      } else {
        expect(data.req.url).to.endWith('/foo')
        expect(data.msg).to.equal('request completed')
        done()
      }
      count++
      cb()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logRequestStart: (request) => {
          return request.url.pathname !== '/ignored'
        }
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/ignored'
    })

    await server.inject({
      method: 'GET',
      url: '/foo'
    })
    await finish
  })

  test('when options.logRequestStart is true and options.getChildBindings does not omit req field, the onRequestComplete log event includes the req field', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    let count = 0
    const stream = sink((data, enc, cb) => {
      if (count === 0) {
        expect(data.msg).to.equal('request start')
        expect(data.req).to.be.an.object()
        expect(data.res).to.be.undefined()
      } else {
        expect(data.msg).to.equal('request completed')
        expect(data.req).to.be.an.object()
        expect(data.res).to.be.an.object()
        done()
      }
      count++
      cb()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        logRequestStart: true
      }
    }

    await server.register(plugin)
    await server.inject('/something')
    await finish
  })

  test('when options.logRequestStart is true and options.getChildBindings omits the req field, the onRequestComplete log event omits the req field', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    let count = 0
    const stream = sink((data, enc, cb) => {
      if (count === 0) {
        expect(data.msg).to.equal('request start')
        expect(data.req).to.be.an.object()
        expect(data.res).to.be.undefined()
        expect(data.requestId).to.equal('request1234')
      } else {
        expect(data.msg).to.equal('request completed')
        expect(data.req).to.be.undefined()
        expect(data.res).to.be.an.object()
        expect(data.requestId).to.equal('request1234')
        done()
      }
      count++
      cb()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        getChildBindings: (req) => ({ requestId: 'request1234' }),
        logRequestStart: true
      }
    }

    await server.register(plugin)
    await server.inject('/something')
    await finish
  })
})

experiment('options.logRequestComplete', () => {
  test('when options.logRequestComplete is default/omitted; response events are logged, containing both the req and res', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    const stream = sink(data => {
      expect(data.msg).to.equal('request completed')
      expect(data.req).to.be.an.object()
      expect(data.req.id).to.exists()
      expect(data.res).to.be.an.object()
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info'
      }
    }

    await server.register(plugin)
    await server.inject('/something')
    await finish
  })

  test('when options.logRequestComplete is true; response events are logged, containing both the req and res', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    const stream = sink(data => {
      expect(data.msg).to.equal('request completed')
      expect(data.req).to.be.an.object()
      expect(data.req.id).to.exists()
      expect(data.res).to.be.an.object()
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        logRequestComplete: true
      }
    }

    await server.register(plugin)
    await server.inject('/something')
    await finish
  })

  test('when options.logRequestComplete is false; response events are not logged', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    let count = 0
    const stream = sink((data, enc, cb) => {
      if (count === 0) {
        expect(data.msg).to.equal('request start')
      } else {
        expect(data.msg).to.equal('request start')
        done()
      }
      count++
      cb()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        logRequestStart: true,
        logRequestComplete: false
      }
    }

    await server.register(plugin)
    await server.inject('/something')
    await server.inject('/something')
    await finish
  })

  test('when options.logRequestComplete is a function, log an event at the completion of each request if the function resolves to true for that request', async () => {
    const server = getServer()
    server.route({
      path: '/ignored',
      method: 'GET',
      handler: (req, h) => {
        return 'ignored'
      }
    })

    server.route({
      path: '/foo',
      method: 'GET',
      handler: (req, h) => {
        return 'foo'
      }
    })

    let done
    const finish = new Promise((resolve, reject) => {
      done = resolve
    })
    const stream = sink((data, enc, cb) => {
      expect(data.req.url).to.endWith('/foo')
      expect(data.msg).to.equal('request completed')
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logRequestComplete: (request) => {
          return request.url.pathname !== '/ignored'
        }
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/ignored'
    })

    await server.inject({
      method: 'GET',
      url: '/foo'
    })
    await finish
  })
})

experiment('logging with mergeHapiLogData option enabled', () => {
  test("log event data is merged into pino's log object", async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
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

    await server.register(plugin)
    server.log(['info'], { hello: 'world' })
    await finish
  })

  test('when data is string, merge it as msg property', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
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

    await server.register(plugin)
    server.log(['info'], 'hello world')
    await finish
  })

  test('respects `messageKey` option', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data).to.include({ message: 'hello world' })
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream: stream,
        level: 'info',
        mergeHapiLogData: true,
        messageKey: 'message'
      }
    }

    await server.register(plugin)
    server.log(['info'], 'hello world')
    await finish
  })
})

experiment('custom serializers', () => {
  test('logging with configured req serializer', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.req.uri).to.equal('/')
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        serializers: {
          req: req => ({ uri: req.raw.req.url })
        }
      }
    }

    await server.register(plugin)
    await server.inject({
      method: 'GET',
      url: '/'
    })
    await finish
  })

  test('logging with configured res serializer', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.res.code).to.equal(404)
      expect(data.res.raw).to.be.an.object()
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        serializers: {
          res: res => ({ code: res.statusCode, raw: res.raw })
        }
      }
    }

    await server.register(plugin)
    await server.inject({
      method: 'GET',
      url: '/'
    })
    await finish
  })

  test('logging with pre-defined err serializer', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.err.errStack).to.not.be.undefined()
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        serializers: {
          err: err => ({ errStack: err.stack })
        }
      }
    }

    await server.register(plugin)
    await server.inject({
      method: 'GET',
      url: '/error'
    })
    await finish
  })

  test('req.raw is not enumerable', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.req).to.be.an.object()
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        serializers: {
          req: req => {
            expect(req.raw).to.be.an.object()
            expect(Object.prototype.propertyIsEnumerable.call(req, 'raw')).to.be.false()
            return req
          }
        }
      }
    }

    await server.register(plugin)
    await server.inject({
      method: 'GET',
      url: '/'
    })
    await finish
  })

  test('res.raw is not enumerable', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.res).to.be.an.object()
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        serializers: {
          res: res => {
            expect(res.raw).to.be.an.object()
            expect(Object.prototype.propertyIsEnumerable.call(res, 'raw')).to.be.false()
            return res
          }
        }
      }
    }

    await server.register(plugin)
    await server.inject({
      method: 'GET',
      url: '/'
    })
    await finish
  })
})

experiment('logging with request payload', () => {
  test('with pre-defined req serializer', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
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

experiment('logging with invalid request', () => {
  test('registered with ignored path and invalid URL injected', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      // invalid URL should be a bad request
      // because the URL is invalid
      expect(data.res.statusCode).to.be.equal(400)
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        ignorePaths: ['/ignored']
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/ignored'
    })

    await server.inject('invalid')
    await done
  })
  test('registered with ignored path and a valid URL injected', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      // valid URL should be not found
      // because the URL does not exist
      expect(data.res.statusCode).to.be.equal(404)
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        ignorePaths: ['/ignored']
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/ignored'
    })

    await server.inject({
      method: 'GET',
      url: '/valid'
    })
    await done
  })
})

experiment('ignore request logs for paths in ignorePaths', () => {
  test('when path matches entry in ignorePaths, nothing should be logged', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.req.url).to.endWith('/foo')
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        ignorePaths: ['/ignored']
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'PUT',
      url: '/ignored'
    })

    await server.inject({
      method: 'PUT',
      url: '/foo'
    })
    await done
  })
})

experiment('ignore request logs for tags in ignoreTags', () => {
  test('when tag matches entry in ignoreTags, nothing should be logged', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.req.url).to.endWith('/foo')
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        ignoreTags: ['foo']
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/something'
    })

    await server.inject({
      method: 'PUT',
      url: '/foo'
    })
    await done
  })
})

experiment('ignore request logs with ignoreFunc', () => {
  test('when ignoreFunc returns true, nothing should be logged', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.req.url).to.endWith('/foo')
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        ignoreFunc: (options, request) => {
          if (request.path === '/something') {
            return true
          }

          return false
        }
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/something'
    })

    await server.inject({
      method: 'PUT',
      url: '/foo'
    })
    await done
  })
})

experiment('ignore response logs for paths in ignorePaths', () => {
  test('when path matches entry in ignorePaths, nothing should be logged', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.req.url).to.endWith('/foo')
      expect(data.msg).to.equal('request completed')
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logEvents: ['response'],
        ignorePaths: ['/ignored']
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'PUT',
      url: '/ignored'
    })

    await server.inject({
      method: 'PUT',
      url: '/foo'
    })
    await done
  })
})

experiment('ignore response logs for tags in ignoreTags', () => {
  test('when tag matches entry in ignoreTags, nothing should be logged', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.req.url).to.endWith('/foo')
      expect(data.msg).to.equal('request completed')
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logEvents: ['response'],
        ignoreTags: ['foo']
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/something'
    })

    await server.inject({
      method: 'PUT',
      url: '/foo'
    })
    await done
  })
})

experiment('ignore response logs with ignoreFunc', () => {
  test('when ignoreFunc returns true, nothing should be logged', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.req.url).to.endWith('/foo')
      expect(data.msg).to.equal('request completed')
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logEvents: ['response'],
        ignoreFunc: (options, request) => {
          if (request.path === '/something') {
            return true
          }

          return false
        }
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/something'
    })

    await server.inject({
      method: 'PUT',
      url: '/foo'
    })
    await done
  })
})

experiment('ignore request.log logs for paths in ignorePaths', () => {
  test('when path matches entry in ignorePaths, nothing should be logged', async () => {
    const level = 'info'
    const server = getServer()
    server.route({
      path: '/ignored',
      method: 'GET',
      handler: (req, h) => {
        req.log([level], 'hello logger')
        return 'hello world'
      }
    })

    server.route({
      path: '/foo',
      method: 'GET',
      handler: (req, h) => {
        req.log([level], 'foo')
        return 'foo'
      }
    })

    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.req.url).to.endWith('/foo')
      expect(data.tags).to.equal([level])
      expect(data.data).to.equal('foo')
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logEvents: ['request-error'],
        ignorePaths: ['/ignored']
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/ignored'
    })

    await server.inject({
      method: 'GET',
      url: '/foo'
    })
    await done
  })
})

experiment('ignore request.log logs for tags in ignoreTags', () => {
  test('when tag matches entry in ignoreTags, nothing should be logged', async () => {
    const level = 'info'
    const server = getServer()
    server.route({
      method: 'GET',
      path: '/ignored',
      options: {
        tags: ['foo']
      },
      handler: (req, h) => {
        req.log([level], 'hello logger')
        return 'hello world'
      }
    })

    server.route({
      path: '/foo',
      method: 'GET',
      handler: (req, h) => {
        req.log([level], 'foo')
        return 'foo'
      }
    })

    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.req.url).to.endWith('/foo')
      expect(data.tags).to.equal([level])
      expect(data.data).to.equal('foo')
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logEvents: ['request-error'],
        ignoreTags: ['foo']
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/ignored'
    })

    await server.inject({
      method: 'GET',
      url: '/foo'
    })
    await done
  })
})

experiment('ignore request.log logs with ignoreFunc', () => {
  test('when ignoreFunc returns true, nothing should be logged', async () => {
    const level = 'info'
    const server = getServer()
    server.route({
      method: 'GET',
      path: '/ignored',
      handler: (req, h) => {
        req.log([level], 'hello logger')
        return 'hello world'
      }
    })

    server.route({
      path: '/foo',
      method: 'GET',
      handler: (req, h) => {
        req.log([level], 'foo')
        return 'foo'
      }
    })

    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.req.url).to.endWith('/foo')
      expect(data.tags).to.equal([level])
      expect(data.data).to.equal('foo')
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logEvents: ['request-error'],
        ignoreFunc: (options, request) => {
          if (request.path === '/ignored') {
            return true
          }

          return false
        }
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/ignored'
    })

    await server.inject({
      method: 'GET',
      url: '/foo'
    })
    await done
  })
})

experiment('logging with logRouteTags option enabled', () => {
  test('when logRouteTags is true, tags are part of the logged object', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.tags[0]).to.be.equal('foo')
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logRouteTags: true
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/something'
    })

    await done
  })

  test('when logRouteTags is not true, tags are not part of the logged object', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.tags).to.be.undefined()
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'GET',
      url: '/something'
    })

    await done
  })
})

experiment('log redact', () => {
  test('authorization headers', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink(data => {
      expect(data.req.headers.authorization).to.equal('[Redacted]')
      done()
    })
    const plugin = {
      plugin: Pino,
      options: {
        stream,
        redact: ['req.headers.authorization']
      }
    }

    await server.register(plugin)
    await server.inject({
      method: 'GET',
      url: '/something',
      headers: {
        authorization: 'Bearer 123'
      }
    })
    await finish
  })
})

experiment('ignore the log event triggered by request.log and server.log', () => {
  test('do not log events to console if the event tags are included in ignoredEventTags', async () => {
    const server = Hapi.server({ port: 0 })
    let called = false
    const stream = sink(() => {
      called = true
    })

    server.route({
      path: '/foo',
      method: 'GET',
      handler: (req, h) => {
        req.log(['TEST'], 'even im not getting logged')
        return 'foo'
      }
    })
    const logger = require('pino')(stream)

    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logRequestComplete: false,
        ignoredEventTags: {
          log: ['test'],
          request: ['TEST']
        }
      }
    }

    await server.register(plugin)
    server.log(['test'], 'im not getting logged')

    await server.inject({
      method: 'GET',
      url: '/foo'
    })
    expect(called).to.be.false()
  })
})

experiment('logging with request queryParams', () => {
  test('with pre-defined req serializer', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink(data => {
      expect(data.queryParams).to.equal({ foo: '42', bar: '43' })
      resolver()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        logQueryParams: true
      }
    }

    await server.register(plugin)

    await server.inject({
      method: 'POST',
      url: '/?foo=42&bar=43'
    })

    await done
  })
})
