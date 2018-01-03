# hapi-pino&nbsp;&nbsp;[![Build Status](https://travis-ci.org/pinojs/hapi-pino.svg)](https://travis-ci.org/pinojs/hapi-pino) [![Coverage Status](https://coveralls.io/repos/github/pinojs/hapi-pino/badge.svg?branch=master)](https://coveralls.io/github/pinojs/hapi-pino?branch=master)


[Hapi](http://hapijs.com) plugin for the [Pino](https://github.com/pinojs/pino) logger. It logs in JSON for easy
post-processing.

[__hapi-pino v2.0.0__](https://github.com/pinojs/hapi-pino/tree/v2.x.x) is the LTS line for Hapi v16. __hapi-pino v3+__
support Hapi v17 only.

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
- `[logRouteTags]` – when enabled, add the request route tags (as configured in hapi `route.options.tags`) `tags` to the `response` event log. Defaults to `false`.
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
- `[serializers]` - an object to overwrite the default serializers. You can but don't have to overwrite all of them. E.g. to redact the authorization header in the logs:
  ```
  {
    req: require('pino-noir')(['req.headers.authorization']).req
    res: ...
    err: ...
  }
  ```
- `[instance]` - uses a previously created Pino instance as the logger.
  The instance's `stream` and `serializers` take precedence.
- `[logEvents]` - Takes an array of strings with the events to log. Default is to
  log all events e.g. `['onPostStart', 'onPostStop', 'response', 'request-error']`.
  Set to `false/null` to disable all events. Even though there is no `request-error` [Hapi Event](#hapievents), the options enables the logging of failed requests.
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

**hapi-pino** decorates the Hapi server with `server.logger()`, which is a function that returns the current instance of
  [pino][pino]. See its doc for the way to actual log.

<a name="requestdecorations"></a>
### Request Decorations

**hapi-pino** decorates the Hapi request with:

* `request.logger`, which is an instance of [pino][pino] bound to the current request, so you can trace all the logs of a given request. See [pino][pino] doc for the way to actual log.

<a name="hapievents"></a>
### Hapi Events

**hapi-pino** listens to some Hapi events:

* `'onRequest'`, to create a request-specific child logger
* `'response'`, to log at `'info'` level when a request is completed
* `'request'`, to support logging via the Hapi `request.log()` method and to log at `'warn'` level when a request errors or when request received contains an invalid `accept-encoding` header, see `tags` and `allTags` options.
* `'log'`, to support logging via the Hapi `server.log()` method and to log in case of an internal server event, see `tags` and `allTags` options.
* `'onPostStart'`, to log when the server is started
* `'onPostStop'`, to log when the server is stopped

## Acknowledgements

This project was kindly sponsored by [nearForm](http://nearform.com).

## License

MIT

[pino]: https://github.com/pinojs/pino
