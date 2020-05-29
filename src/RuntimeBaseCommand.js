/*
Copyright 2019 Adobe Inc. All rights reserved.
This file is licensed to you under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License. You may obtain a copy
of the License at http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software distributed under
the License is distributed on an "AS IS" BASIS, WITHOUT WARRANTIES OR REPRESENTATIONS
OF ANY KIND, either express or implied. See the License for the specific language
governing permissions and limitations under the License.
*/

const { Command, flags } = require('@oclif/command')

const { propertiesFile, PropertyEnv, PropertyDefault } = require('./properties')
const createDebug = require('debug')
const debug = createDebug('aio-cli-plugin-runtime')
const http = require('http')
const OpenWhisk = require('openwhisk')
const OpenWhiskRoutes = require('openwhisk/lib/routes')

let cli

class RuntimeBaseCommand extends Command {
  async getOptions () {
    const { flags } = this.parse(this.constructor)
    let properties = { get: () => null }
    try {
      // propertiesFile() will fail in a browser; that's ok
      properties = propertiesFile()
    } catch (e) {}

    const getEnv = (key) => process.env['AIO_RUNTIME_' + key]

    const options = {
      cert: flags.cert || getEnv('CERT') || properties.get('CERT'),
      key: flags.key || getEnv('KEY') || properties.get('KEY'),
      apiversion: flags.apiversion || getEnv('APIVERSION') || properties.get('APIVERSION') || PropertyDefault.APIVERSION,
      apihost: flags.apihost || getEnv('APIHOST') || properties.get('APIHOST') || PropertyDefault.APIHOST,
      namespace: getEnv('NAMESPACE') || properties.get('NAMESPACE'),
      api_key: flags.auth || getEnv('AUTH') || properties.get('AUTH'),
      ignore_certs: flags.insecure || getEnv('INSECURE')
    }

    // remove any null or undefined keys
    Object
      .keys(options)
      .forEach((key) => {
        if (options[key] === null || options[key] === undefined) {
          delete options[key]
        }
      })

    debug(options)

    if (!(options.apihost).toString().trim()) {
      throw new Error('An API host must be specified')
    }

    if (!(options.api_key || '').toString().trim()) {
      throw new Error('An AUTH key must be specified')
    }

    // .env var is given priority, then the flag, which has a default value
    // of aio-cli-plugin-runtime@VERSION
    if (!process.env['__OW_USER_AGENT']) {
      process.env['__OW_USER_AGENT'] = flags.useragent
    }

    return options
  }

  async wsk (options) {
    if (!options) {
      options = await this.getOptions()
    }

    const ow = OpenWhisk(options)
    // override api endpoint for apigateway
    ow.routes = new OpenWhiskRoutes(ow.routes.client, (path) => {
      return `web/whisk-system/apimgmt/${path}`
    })
    return ow
  }

  async init () {
    const { flags } = this.parse(this.constructor)

    // See https://www.npmjs.com/package/debug for usage in commands
    if (flags.verbose) {
      // verbose just sets the debug filter to everything (*)
      createDebug.enable('*')
    } else if (flags.debug) {
      createDebug.enable(flags.debug)
    }
  }

  handleError (msg, err) {
    this.parse(this.constructor)

    msg = msg || 'unknown error'

    const getStatusCode = (code) => `${code} ${http.STATUS_CODES[code] || ''}`.trim()

    if (err) {
      let pretty = err.message || ''
      if (err.name === 'OpenWhiskError') {
        if (err.error && err.error.error) {
          pretty = err.error.error.toLowerCase()
          if (err.statusCode) pretty = `${pretty} (${getStatusCode(err.statusCode)})`
          if (err.error.code) pretty = `${pretty} (request-id ${err.error.code})`
        } else if (err.statusCode) {
          pretty = getStatusCode(err.statusCode)
        }
      }

      if ((pretty || '').toString().trim()) {
        msg = `${msg}: ${pretty}`
      }

      debug(err)
      msg = msg + '\n specify --verbose flag for more information'
    }
    return this.error(msg)
  }

  table (data, columns, options = {}) {
    if (!cli) {
      cli = require('cli-ux').cli
    }
    cli.table(data, columns, options)
  }

  logJSON (msg, obj) {
    if (msg) {
      this.log(msg, JSON.stringify(obj, null, 2))
    } else {
      this.log(JSON.stringify(obj, null, 2))
    }
  }
}

RuntimeBaseCommand.propertyFlags = ({ asBoolean = false } = {}) => {
  const propData = {
    cert: { description: 'client cert' },
    key: { description: 'client key' },
    apiversion: { description: 'whisk API version', env: PropertyEnv.APIVERSION },
    apihost: { description: 'whisk API host', env: PropertyEnv.APIHOST },
    auth: { char: 'u', description: 'whisk auth', env: PropertyEnv.AUTH }
  }
  const newData = {}

  Object
    .keys(propData)
    .forEach((key) => {
      newData[key] = (asBoolean ? flags.boolean(propData[key]) : flags.string(propData[key]))
    })
  return newData
}

RuntimeBaseCommand.flags = {
  ...RuntimeBaseCommand.propertyFlags(),
  insecure: flags.boolean({ char: 'i', description: 'bypass certificate check' }),
  debug: flags.string({ description: 'Debug level output' }),
  verbose: flags.boolean({ char: 'v', description: 'Verbose output' }),
  version: flags.boolean({ description: 'Show version' }),
  help: flags.boolean({ description: 'Show help' }),
  useragent: flags.string({
    hidden: true,
    description: 'Use custom user-agent string',
    default: 'aio-cli-plugin-runtime@' + require('../package.json').version
  })
}

module.exports = RuntimeBaseCommand
