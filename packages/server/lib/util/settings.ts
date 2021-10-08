import _ from 'lodash'
import Promise from 'bluebird'
import path from 'path'

import errors from '../errors'
import { fs } from '../util/fs'
import { requireAsync } from './require_async'
import Debug from 'debug'

const debug = Debug('cypress:server:settings')

export interface SettingsOptions {
  testingType?: 'component' |'e2e'
  configFile?: string | false
  args?: {
    runProject?: string
  }
}

// TODO:
// think about adding another PSemaphore
// here since we can read + write the
// settings at the same time something else
// is potentially reading it

const flattenCypress = (obj) => {
  return obj.cypress ? obj.cypress : undefined
}

const renameVisitToPageLoad = (obj) => {
  const v = obj.visitTimeout

  if (v) {
    obj = _.omit(obj, 'visitTimeout')
    obj.pageLoadTimeout = v

    return obj
  }
}

const renameCommandTimeout = (obj) => {
  const c = obj.commandTimeout

  if (c) {
    obj = _.omit(obj, 'commandTimeout')
    obj.defaultCommandTimeout = c

    return obj
  }
}

const renameSupportFolder = (obj) => {
  const sf = obj.supportFolder

  if (sf) {
    obj = _.omit(obj, 'supportFolder')
    obj.supportFile = sf

    return obj
  }
}

function _pathToFile (projectRoot, file) {
  return path.isAbsolute(file) ? file : path.join(projectRoot, file)
}

function _logReadErr (file, err) {
  errors.throw('ERROR_READING_FILE', file, err)
}

function _applyRewriteRules (obj = {}) {
  return _.reduce([flattenCypress, renameVisitToPageLoad, renameCommandTimeout, renameSupportFolder], (memo, fn) => {
    const ret = fn(memo)

    return ret ? ret : memo
  }, _.cloneDeep(obj))
}

export function isComponentTesting (options: SettingsOptions = {}) {
  return options.testingType === 'component'
}

export function configFile (options: SettingsOptions = {}) {
  // default is only used in tests.
  // This prevents a the change from becoming bigger than it should
  // FIXME: remove the default
  return options.configFile === false ? false : (options.configFile || 'cypress.json')
}

export function id (projectRoot, options = {}) {
  return read(projectRoot, options)
  .then((config) => config.projectId)
  .catch(() => {
    return null
  })
}

export function read (projectRoot, options: SettingsOptions = {}) {
  if (options.configFile === false) {
    return Promise.resolve({})
  }

  const file = pathToConfigFile(projectRoot, options)

  const readPromise = /\.json$/.test(file) ? fs.readJSON(path.resolve(projectRoot, file)) : requireAsync(file, {
    projectRoot,
    loadErrorCode: 'CONFIG_FILE_ERROR',
  })

  return readPromise
  .catch((err) => {
    if (err.type === 'MODULE_NOT_FOUND' || err.code === 'ENOENT' && isJSONFile(file)) {
      if (options.args?.runProject) {
        return Promise.reject(errors.get('CONFIG_FILE_NOT_FOUND', options.configFile, projectRoot))
      }

      return fs.outputJson(file, {}, { spaces: 2 })
    }

    return Promise.reject(err)
  })
  .then((configObject = {}) => {
    if (isComponentTesting(options) && 'component' in configObject) {
      configObject = { ...configObject, ...configObject.component }
    }

    if (!isComponentTesting(options) && 'e2e' in configObject) {
      configObject = { ...configObject, ...configObject.e2e }
    }

    debug('resolved configObject', configObject)

    // only proceed to updating obsolete file when they are json
    if (!isJSONFile(file)) {
      return configObject
    }

    const changed = _applyRewriteRules(configObject)

    // if our object is unchanged
    // then just return it
    if (_.isEqual(configObject, changed)) {
      return configObject
    }

    // else write the new reduced obj
    return fs.outputJson(file, changed, { spaces: 2 })
    .then(() => {
      return changed
    })
  }).catch((err) => {
    debug('an error occured when reading config', err)
    if (errors.isCypressErr(err)) {
      throw err
    }

    return _logReadErr(file, err)
  })
}

function isJSONFile (filePath: string) {
  return /\.json/.test(filePath)
}

export function readEnv (projectRoot) {
  const file = pathToCypressEnvJson(projectRoot)

  return fs.readJson(file)
  .catch((err) => {
    if (err.code === 'ENOENT') {
      return {}
    }

    if (errors.isCypressErr(err)) {
      throw err
    }

    return _logReadErr(file, err)
  })
}

export function pathToConfigFile (projectRoot, options: SettingsOptions = {}) {
  const file = configFile(options)

  return file && _pathToFile(projectRoot, file)
}

export function pathToCypressEnvJson (projectRoot) {
  return _pathToFile(projectRoot, 'cypress.env.json')
}
