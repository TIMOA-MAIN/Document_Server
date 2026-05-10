// config/Config.cjs
require('dotenv').config()

class Config {

  static get SERVER_CONFIG(){
    return {
      port: process.env.PORT || 8002,
      host: process.env.HOST || '0.0.0.0',
      env: process.env.NODE_ENV || 'development'
    }
  }

  static get CRDT_CONFIG() {
    return {
      max_file_size: 10 * 1024 * 1024,
      max_connections_per_room: 50,
      connection_timeout: 30000,
      inactive_threshold: 30 * 60 * 1000, // 30분
      cleanup_interval: 5 * 60 * 1000, // 5분
      session_cleanup_interval: 10 * 60 * 1000, // 10분
      save_debounce_delay: 3000, // 3초
      auto_save_interval: 30000, // 30초
      connection_cleanup_interval: 30000 // 30초
    }
  }

  static get CONTROL_CONFIG() {
    return {
      max_file_size: 10 * 1024 * 1024,
      max_connections_per_room: 50,
      connection_timeout: 30000,
    }
  }

  static get DB_CONFIG() {
    return {
      server: process.env.DB_SERVER || '203.234.12.219',
      database: process.env.DB_NAME || 'bit41',
      user: process.env.DB_USER || 'bit',
      password: process.env.DB_PASSWORD || 'bit41',
      port: parseInt(process.env.DB_PORT) || 1433,
      options: {
        encrypt: false,
        trustServerCertificate: true,
        enableArithAbort: true,
        requestTimeout: 60000,
        connectionTimeout: 30000
      },
      pool: { 
        max: 10, 
        min: 0, 
        idleTimeoutMillis: 30000 
      }
    }
  }
  
}

module.exports = { Config }
