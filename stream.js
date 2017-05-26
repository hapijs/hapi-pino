'use strict'
const pino = require('pino')
const stream = require('stream')

const levels = ['trace', 'debug', 'info', 'warn', 'error']
const levelTags = {
  trace: 'trace',
  debug: 'debug',
  info: 'info',
  warn: 'warn',
  error: 'error'
}

const deaultSerializers = {
  res (data) {
    return {
      event: data.event,
      timestamp: data.timestamp,
      id: data.id,
      instance: data.instance,
      labels: data.labels,
      method: data.method,
      path: data.path,
      query: data.query,
      responseTime: data.responseTime,
      statusCode: data.statusCode,
      pid: data.pid,
      httpVersion: data.httpVersion,
      source: data.source,
      route: data.route,
      log: data.log,
      config: data.config
    }
  },
  err: pino.stdSerializers.err
}

class GoodPino extends stream.Writable {
  constructor (logger, options) {
    super({objectMode: true})
    options = options || {}
    this.tagToLevels = Object.assign({}, levelTags, options.tags)
    this.allTags = options.allTags || 'info'

    this.validTags = Object.keys(this.tagToLevels).filter((key) => levels.indexOf(this.tagToLevels[key]) < 0).length === 0
    logger.serializers = Object.assign({}, deaultSerializers, logger.serializers)
    this.logger = logger
    if (!this.validTags || levels.indexOf(this.allTags) < 0) {
      throw new Error('invalid tag levels')
    }

    return this
  }

  _write (data, encoding, callback) {
    const tags = data.tags || []
    let level
    let i = 0

    for (i = 0; i < tags.length; i++) {
      level = this.tagToLevels[tags[i]]
      if (level) {
        break
      }
    }
    if (!level) {
      level = this.allTags
    }

    switch (data.event) {
      case 'response':
        this.logger[level]({res: data})
        break
      case 'request':
        this.logger[level](data)
        break
      case 'error':
        this.logger[level]({ tags, err: data.error })
        break
      case 'ops':
      case 'log':
      default:
        this.logger[level]({ tags, data: data.data })
    }
    setImmediate(callback)
  }
}

module.exports = GoodPino
