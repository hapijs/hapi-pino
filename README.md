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
    request.logger.info('In handler %s', request.path)
    return reply('hello world')
  }
})

server.register({
  register: require('.').register,
  options: {
    extreme: false
  }
}, (err) => {
  if (err) {
    console.error(err)
    process.exit(1)
  }

  server.app.logger.warn('Pino is registered')
  server.logger().info('another way for accessing it')

  // Start the server
  server.start((err) => {
    if (err) {
      console.error(err)
      process.exit(1)
    }
  })
})
```

## Acknowledgements

This project was kindly sponsored by [nearForm](http://nearform.com).

## License

MIT
