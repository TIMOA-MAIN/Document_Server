// core/utils/LogHelper.cjs
const crypto = require('crypto')

class LogHelper {
  static log(level, message, ...args) {
    const timestamp = new Date().toISOString()
    const levels = {
      'info': '\x1b[36m[INFO]\x1b[0m',
      'success': '\x1b[32m[SUCCESS]\x1b[0m',
      'warning': '\x1b[33m[WARNING]\x1b[0m',
      'warn': '\x1b[33m[WARNING]\x1b[0m',
      'error': '\x1b[31m[ERROR]\x1b[0m'
    }
    
    const levelTag = levels[level] || '[LOG]'
    console.log(`${timestamp} ${levelTag} ${message}`, ...args)
  }

  static generate_id() {
    return crypto.randomBytes(16).toString('hex')
  }

}

module.exports = { LogHelper }
