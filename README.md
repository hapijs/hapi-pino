# hapi-pino&nbsp;&nbsp;![Tests Status](https://github.com/pinojs/hapi-pino/actions/workflows/test.yml/badge.svg) [![Coverage Status](https://coveralls.io/repos/github/pinojs/hapi-pino/badge.svg?branch=master)](https://coveralls.io/github/pinojs/hapi-pino?branch=master)


[Hapi](http://hapijs.com) plugin for the [Pino](https://github.com/pinojs/pino) logger. It logs in JSON for easy
post-processing.

## Supported Hapi versions

- hapi-pino v9.x supports Hapi v20.
- hapi-pino v8.x supports Hapi v18, v19 and v20.
- hapi-pino v7.x supports Hapi v18 and v19.
- hapi-pino v6.x supports Hapi v17, v18 and v19
- hapi-pino v5.x supports Hapi v17 and v18
- hapi-pino v3.x
supports Hapi v17 only. The maximum version that can be used with Hapi v16 is Pino v4.
- [hapi-pino v2.x](https://github.com/pinojs/hapi-pino/tree/v2.x.x) is the LTS line for Hapi v16.

## Install

```
npm install hapi-pino
```

## Usage

```js
'use strict'

const Hapi = require('@hapi/hapi')

async function start () {
  // Create a server with a host and port
  const server = Hapi.server({
    host: 'localhost',
    port: 3000,
    debug: false, // disable Hapi debug console logging
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
    plugin: require('hapi-pino'),
    options: {
      prettyPrint: process.env.NODE_ENV !== 'production',
      // Redact Authorization headers, see https://getpino.io/#/docs/redaction
      redact: ['req.headers.authorization']
    }
  })

  // also as a decorated API
  server.logger.info('another way for accessing it')

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
### `options.logPayload: boolean`

  **Default**: `false`

  When enabled, add the request payload as `payload` to the `response` event log.

### `options.logQueryParams: boolean`

  **Default**: `false`

  When enabled, add the request query as `queryParams` to the `response` event log.

### `options.logRouteTags: boolean`

  **Default**: `false`

  When enabled, add the request route tags (as configured in hapi `route.options.tags`) `tags` to the `response` event log.

### `options.logRequestStart: boolean | (Request) => boolean`

  **Default**: false

  Whether hapi-pino should add a `log.info()` at the beginning of Hapi requests for the given Request.

  For convenience, you can pass in `true` to always log `request start` events, or `false` to disable logging `request start` events

  Note: when `logRequestStart` is enabled and `getChildBindings` is configured to omit the `req` field, then the `req` field will be
  omitted from the `request completed` log event. This behavior is useful if you want to separate requests from responses and link the
  two via requestId (frequently done via `headers['x-request-id']`) , where "request start" only logs the request and a requestId,
  and `request completed` only logs the response and the requestId.

### `options.logRequestComplete: boolean | (Request) => Boolean`

  **Default**: true

  Whether hapi-pino should add a `log.info()` at the completion of Hapi requests for the given Request.

  For convenience, you can pass in `true` to always log `request complete` events, or `false` to disable logging `request complete` events

### `options.stream` Pino.DestinationStream

  **Default**: `process.stdout`

  the binary stream to write stuff to

### `options.prettyPrint: boolean`

  **Default**: `false`

  Pretty print the logs (same as `node server | pino`), disabled in production.  Enable in development by passing `true`

### `options.tags: ({ [key in pino.Level]?: string })`

  **Default**: exposed via `hapi-pino.levelTags`

  A map to specify pairs of Hapi log tags and levels.  The tags `trace`, `debug`, `info`, `warn`, and `error` map to their corresponding level.
  Any mappings you supply take precedence over the default mappings.

### `options.allTags: pino.Level`

  **Default**: `'info'`

 The logging level to apply to all tags not matched by `tags`

### `options.serializers: { [key: string]: pino.SerializerFn }`

 An object to overwrite the default serializers. You can but don't have to overwrite all of them.

 **Example**:  
 To redact the authorization header in the logs:
  ```
  {
    req: require('pino-noir')(['req.headers.authorization']).req
    res: ...
    err: ...
  }
  ```

### `options.instance: Pino`

  Uses a previously created Pino instance as the logger.
  The instance's `stream` and `serializers` take precedence.

### `options.logEvents: string[] | false | null`

  **Default**: `['onPostStart', 'onPostStop', 'response', 'request-error']` (all events)

  Takes an array of strings with the events to log.

  Set to `false/null` to disable all events. Even though there is no `request-error` [Hapi Event](#hapievents), the options enables the logging of failed requests.

### `options.mergeHapiLogData: boolean`

  **Default**: `false`

  When enabled, Hapi-pino will merge the data received
  from Hapi's logging interface (`server.log(tags, data)` or `request.log(tags, data)`)
  into Pino's logged attributes at root level. If data is a string, it will be used as the value for the `msg` key.
  When disabled, Hapi-pino will keep data under a `data` key.

  **Example**:  
  ```js
  server.log(['info'], {hello: 'world'})

  // with mergeHapiLogData: true
  { level: 30, hello: 'world', ...}

  // with mergeHapiLogData: false (Default)
  { level: 30, data: { hello: 'world' }}
  ```

### `options.getChildBindings: (request) => { [key]: any }`

  **Default**: `() => { req: Request }`, which automatically adds the request to every pino log call

  Takes a function with the request as an input, and returns the object that will be passed into pinoLogger.child().

### `options.ignorePaths: string[]`
  Takes an array of string routes and disables logging for each.  Useful for health checks or any route that does not need logging.

  **Example**:  
  Do not log for /health route
  ```js
  ignorePaths: ['/health']
  ```

### `options.ignoreTags: string[]`
  Takes an array of string tags and disables logging for each.  Useful for health checks or any route that does not need logging.

  **Example**:  
  Do not log for route with `healthcheck` tag
  ```js
  ignoreTags: ['healthcheck']
  ```

### `options.ignoreFunc: (options, request) => boolean`
  Takes a function that receives the plugin options and the request as parameters, and returns a boolean. Logging will be disabled if the return value is `true`. Useful for scenarios where the `ignorePaths` or `ignoreTags` options can't achieve what is intended.

  **Example**:
  Do not log routes relative to static content
  ```js
  ignoreFunc: (options, request) => request.path.startsWith('/static')
  ```

  **Note**: if `ignoreFunc` is used, the other two options that can be used to ignore / disable logging (`ignorePaths` and `ignoreTags`) are effectively discarded. So `ignoreFunc` can be seen a more advanced option. For instance, you can easily re-implement the `ignorePaths` functionality as follows:

  ```js
  ignoreFunc: (options, request) => myIgnorePaths.include(request.path)
  ```

  (where `myIgnorePaths` would be an array with paths to be ignored).


### `options.ignoredEventTags: object[]`
  Takes an array of object tags and disables logging for each.  Useful for debug logs or any other tags that does not need logging.

  **Default**: `{ log: '*', request: '*' }`, Logs all the events emitted by server.log and request.log without filtering event tags

  **Example**: 
  Do not log the events for DEBUG and TEST tag
  ```js
  ignoredEventTags: { log: ['DEBUG', 'TEST'], request: ['DEBUG', 'TEST'] }
  server.log(['DEBUG'], 'DEBUG')
  ```


### `options.level: Pino.Level`
  **Default**: `'info'`

  Set the minumum level that Pino should log out. See [Level](https://github.com/pinojs/pino/blob/master/docs/api.md#level).

  **Example**:  
  Configure Pino to output all `debug` or higher events:
  ```js
  level: 'debug'
  ```

### `options.redact: string[] | pino.redactOptions`

  Path to be redacted in the log lines. See the [log redaction](https://getpino.io/#/docs/redaction) docs for more details.

<a name="serverdecorations"></a>
### Server Decorations

**hapi-pino** decorates the Hapi server with `server.logger`, which is an instance of
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
