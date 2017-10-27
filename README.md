# hapi-pino&nbsp;&nbsp;[![Build Status](https://travis-ci.org/pinojs/hapi-pino.svg)](https://travis-ci.org/pinojs/hapi-pino) [![Coverage Status](https://coveralls.io/repos/github/pinojs/hapi-pino/badge.svg?branch=master)](https://coveralls.io/github/pinojs/hapi-pino?branch=master)


[Hapi](http://hapijs.com) plugin for the [Pino](https://github.com/pinojs/pino) logger. It logs in JSON for easy
post-processing.

## Install

```
npm i hapi-pino --save
```

## Usage

```js
'use strict'

require('make-promises-safe')

const Hapi = require('hapi')

async function start () {
  // Create a server with a host and port
  const server = Hapi.server({
    host: 'localhost',
    port: 3000
  })

  // Add the route
  server.route({
    method: 'GET',
    path: '/',
    handler: async function (request, h) {
      // request.log is HAPI standard way of logging
      request.log(['a', 'b'], 'Request into hello world')

      // you can also use a pino instance, which will be faster
      request.logger.info('In handler %s', request.path)

      return 'hello world'
    }
  })

  await server.register({
    plugin: require('.'),
    options: {
      prettyPrint: process.env.NODE_ENV !== 'production'
    }
  })

  // the logger is available in server.app
  server.app.logger.warn('Pino is registered')

  // also as a decorated API
  server.logger().info('another way for accessing it')

  // and through Hapi standard logging system
  server.log(['subsystem'], 'third way for accessing it')

  await server.start()

  return server
}

start().catch((err) => {
  console.log(err)
  process.exit(1)
})
```

## API

- [Options](#options)
- [Server decorations](#serverdecorations)
- [Request decorations](#requestdecorations)
- [Hapi Events](#hapievents)

**hapi-pino** goal is to enable Hapi applications to log via [pino][pino]. To enable this, it decorates both the [server](#serverdecorations) and the [request](#requestadditions). Moreover, **hapi-pino**
 binds to the Hapi events system as described in the ["Hapi
events"](#hapievents) section.

### Options
- `[logPayload]` – when enabled, add the request payload as `payload` to the `response` event log. Defaults to `false`.
- `[stream]` - the binary stream to write stuff to, defaults to
  `process.stdout`.
- `[prettyPrint]` - pretty print the logs (same as `node server |
  pino`), disable in production. Default is `false`, enable in
  development by passing `true`.
- `[tags]` - a map to specify pairs of Hapi log tags and levels. By default,
  the tags *trace*, *debug*, *info*, *warn*, and *error* map to their
  corresponding level. Any mappings you supply take precedence over the default
  mappings. The default level tags are exposed via `hapi-pino.levelTags`.
- `[allTags]` - the logging level to apply to all tags not matched by
  `tags`, defaults to `'info'`.
- `[instance]` - uses a previously created Pino instance as the logger.
  The instance's `stream` and `serializers` take precedence.
- `[logEvents]` - Takes an array of strings with the events to log. Default is to
  log all events e.g. `['onPostStart', 'onPostStop', 'response', 'request-error']`.
  Set to `false/null` to disable all events.
- `[mergeHapiLogData]` - When enabled, Hapi-pino will merge the data received
  from Hapi's logging interface (`server.log(tags, data)` or `request.log(tags, data)`)
  into Pino's logged attributes at root level. If data is a string, it will be used as
  the value for the `msg` key. Default is `false`, in which case data will be logged under 
  a `data` key.

  E.g.
```js
server.log(['info'], {hello: 'world'})

// with mergeHapiLogData: true
{ level: 30, hello: 'world', ...}

// with mergeHapiLogData: false (Default)
{ level: 30, data: { hello: 'world' }}
```

<a name="serverdecorations"></a>
### Server Decorations

**hapi-pino** decorates the Hapi server with:

* `server.logger()`, which is a function that returns the current instance of
  [pino][pino], see its doc for the way to actual log.
* `server.app.logger`, same as before, but the logger it is also
  attached to the `server.app` object.

<a name="requestdecorations"></a>
### Request Decorations

**hapi-pino** decorates the Hapi request with:

* `request.logger`, which is an instance of [pino][pino] bound to the current request, so you can trace all the logs of a given request. See [pino][pino] doc for the way to actual log.

<a name="hapievents"></a>
### Hapi Events

**hapi-pino** listens to some Hapi events:

* `'onRequest'`, to create a request-specific child logger
* `'response'`, to log at `'info'` level when a request is completed
* `'request'`, to log at `'warn'` level when a request errors for
  `internal` and `accept-encoding` tags
* `'log'`, to support logging via the Hapi `server.log()` and
  `request.log()` methods, see `tags` and `allTags` options.
* `'onPostStart'`, to log when the server is started
* `'onPostStop'`, to log when the server is stopped

## Acknowledgements

This project was kindly sponsored by [nearForm](http://nearform.com).

## License

MIT

[pino]: https://github.com/pinojs/pino
