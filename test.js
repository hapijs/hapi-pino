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
      method: 'GET',
      path: '/something',
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

test('server.app.logger is undefined', async () => {
  const server = getServer()
  await registerWithSink(server, 'info', () => { throw new Error('fail') })
  expect(server.app.logger).to.be.undefined()
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
  test('at default level', async () => {
    const server = getServer()
    let done

    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })

    await registerWithSink(server, 'info', (data) => {
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

    await registerWithSink(server, 'info', (data) => {
      expect(data.res.statusCode).to.equal(200)
      expect(data.msg).to.equal('request completed')
      expect(data.responseTime).to.be.at.least(10)
      done()
    })

    await server.inject('/')
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
      handler: (req, reply) => { throw new Error('boom') }
    })
    await registerWithSink(server, 'info', (data, enc, cb) => {
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

  test('with tag catchall', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
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

    await server.register(plugin)
    server.log(['something'], 'hello world')
    await finish
  })
})

experiment('logs through request.log', () => {
  ltest(async (level) => {
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

    await tagsWithSink(server, {
      aaa: level
    }, (data, enc, cb) => {
      if (data.tags) {
        expect(data.data).to.equal('hello logger')
        resolver()
      }
      cb()
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
    const stream = sink((data) => {
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

    await server.register(plugin)
    server.logger().info({ foo: 'bar' }, 'hello world')
    await finish
  })
})

experiment('logging with mergeHapiLogData option enabled', () => {
  test('log event data is merged into pino\'s log object', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
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

    await server.register(plugin)
    server.log(['info'], 'hello world')
    await finish
  })
})

experiment('logging with overridden serializer', () => {
  test('with pre-defined req serializer', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
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
          req: (req) => ({ uri: req.url })
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

  test('with req serializer set to null', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
    const stream = sink((data) => {
      expect(data.req.uri).to.not.equal('/')
      expect(data.req.raw).to.be.an.object()
      done()
    })
    const logger = require('pino')(stream)
    const plugin = {
      plugin: Pino,
      options: {
        instance: logger,
        serializers: {
          req: null
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

  test('with pre-defined res serializer', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
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

    await server.register(plugin)
    await server.inject({
      method: 'GET',
      url: '/'
    })
    await finish
  })

  test('with pre-defined err serializer', async () => {
    const server = getServer()
    let done
    const finish = new Promise(function (resolve, reject) {
      done = resolve
    })
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

    await server.register(plugin)
    await server.inject({
      method: 'GET',
      url: '/error'
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

experiment('ignore request logs for paths in ignorePaths', () => {
  test('when path matches entry in ignorePaths, nothing should be logged', async () => {
    const server = getServer()
    let resolver
    const done = new Promise((resolve, reject) => {
      resolver = resolve
    })
    const stream = sink((data) => {
      expect(data.req.url).to.not.equal('/ignored')
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
      url: '/'

    })
    await done
  })
})
