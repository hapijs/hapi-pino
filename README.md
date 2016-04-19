# hapi-pino

[Hapi](http://hapijs.com) plugin for the [Pino](https://github.com/mcollina/pino) logger. It logs in JSON for easy
post-processing.
It is faster than [good](http://npm.im/good) console logger by a 25%
factor, which increases to 40% when using [extreme
mode](https://github.com/mcollina/pino#extreme)). Using hapi-pino in
extreme mode allows the "hello world" example to handle 40% more
throughput than good.

## Install

```
npm i hapi-pino --save
```

## Usage

```js
'use strict'

const Hapi = require('hapi')

// Create a server with a host and port
const server = new Hapi.Server()
server.connection({
  host: 'localhost',
  port: 3000
})

// Add the route
server.route({
  method: 'GET',
  path: '/',
  handler: function (request, reply) {
    // request.log is HAPI standard way of logging
    request.log(['a', 'b'], 'Request into hello world')

    // you can also use a pino instance, which will be faster
    request.logger.info('In handler %s', request.path)

    return reply('hello world')
  }
})

server.register(require('hapi-pino'), (err) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }

  // the logger is available in server.app
  server.app.logger.warn('Pino is registered')

  // also as a decorated API
  server.logger().info('another way for accessing it')

  // and through Hapi standard logging system
  server.log(['subsystem'], 'third way for accessing it')

  // Start the server
  server.start((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }
  })
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

- `[stream]` - the binary stream to write stuff to, defaults to
  `process.stdout`.
- `[tags]` - a map to specify pairs of Hapi log tags and levels.
- `[allTags]` - the logging level to apply to all tags not matched by
  `tags`, defaults to `'info'`.


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
* `'response-error'`, to log at `'warn'` level when a request errors
* `'log'`, to support logging via the Hapi `server.log()` and
  `request.log()` methods, see `tags` and `allTags` options.
* `'onPostStart'`, to log when the server is started
* `'onPostStopt'`, to log when the server is stopped

## Acknowledgements

This project was kindly sponsored by [nearForm](http://nearform.com).

## License

MIT

[pino]: https://github.com/mcollina/pino
