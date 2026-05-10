const { App } = require('./core/App.cjs')
const { ControlManager } = require('./core/Control.cjs')
const { Config } = require('./config/Config.cjs')

class ServerStarter {
  constructor() {
    this.config = Config.SERVER_CONFIG
    this.app = null
    this.controller = null
    this.cleanup_interval = null
    
    this._setup_process_handlers()
  }

  _setup_process_handlers() {
    ['SIGTERM', 'SIGINT'].forEach(signal => {
      process.on(signal, () => {
        console.log(`\n${signal} 신호 수신 - 서버 종료 중...`)
        this.stop()
      })
    })

    process.on('uncaughtException', (error) => {
      console.error('처리되지 않은 예외:', error)
      console.error('스택 트레이스:', error.stack)
      this.stop()
    })

    process.on('unhandledRejection', (reason, promise) => {
      console.error('처리되지 않은 Promise 거부:', reason)
      console.error('Promise:', promise)
      this.stop()
    })
  }

  async init() {
    try {
      console.log('DocumentServer 초기화 시작...')
      console.log(`환경: ${this.config.env}`)
      console.log(`바인딩: ${this.config.host}:${this.config.port}`)
      
      //  1. 컨트롤러 초기화 (모든 것 포함)
      await this._init_controller()
      
      //  2. App 초기화 (HTTP + WebSocket 라우팅)
      await this._init_app()
      
      //  3. 유지보수 작업
      this._start_maintenance_tasks()
      
      console.log('서버 초기화 완료!')
      return true
      
    } catch (error) {
      console.error('서버 초기화 실패:', error)
      throw error
    }
  }

  async _init_controller() {
    console.log('컨트롤러 초기화 중...')
    this.controller = new ControlManager()
    await this.controller.init()
    console.log('컨트롤러 초기화 완료 (DatabaseService + SSE + SessionManager + CRDT + ChannelManager)')
  }

  async _init_app() {
    console.log('App 초기화 중...')
    this.app = new App(this.config, this.controller)
    await this.app.init()
    console.log('App 초기화 완료 (HTTP 서버 + WebSocket 라우팅)')
  }

  _start_maintenance_tasks() {
    console.log('유지보수 작업 스케줄링...')
    
    this.cleanup_interval = setInterval(async () => {
      try {
        await this.controller.cleanup_inactive_resources()
      } catch (error) {
        console.error('정기 정리 작업 실패:', error)
      }
    }, 30 * 60 * 1000)
    
    console.log('유지보수 작업 스케줄링 완료')
  }

  async start() {
    try {
      await this.init()
      await this.app.start()
      
      console.log('\n DocumentServer 실행 완료!')
      console.log('='.repeat(80))
      console.log(`서버 주소: http://${this.config.host}:${this.config.port}`)
      console.log(`Health Check: http://${this.config.host}:${this.config.port}/health`)
      console.log('')
      console.log(' WebSocket (Y.js 실시간 협업):')
      console.log(`   • ws://${this.config.host}:${this.config.port}/document/:channelId/:serverId/userId`)
      console.log('')
      console.log(' SSE (이벤트 알림):')
      console.log(`   • GET /sse/user/:userId`)
      console.log('')
      console.log(' 채널 관리 API:')
      console.log(`   • GET    /api/document/server/:serverId/channels`)
      console.log(`   • POST   /api/document/channel`)
      console.log(`   • GET    /api/document/channel/:channelId`)
      console.log(`   • PUT    /api/document/channel/:channelId`)
      console.log(`   • DELETE /api/document/channel/:channelId`)
      console.log(`   • GET    /api/document/page/:channelId`)
      console.log('')
      console.log(' 협업 기능:')
      console.log(`   • Y.js CRDT 기반 실시간 동기화`)
      console.log(`   • BlockNote 에디터 지원`)
      console.log(`   • 자동 충돌 해결`)
      console.log(`   • 3초 디바운스 DB 자동 저장`)
      console.log(`   • 다중 사용자 커서 표시`)
      console.log(`   • 사용자 활동 추적`)
      console.log('='.repeat(80))
      
    } catch (error) {
      console.error('서버 시작 실패:', error)
      process.exit(1)
    }
  }

  async stop() {
    console.log('서버 종료 중...')
    
    try {
      if (this.cleanup_interval) {
        clearInterval(this.cleanup_interval)
        console.log('유지보수 작업 중단')
      }
      
      const shutdown_tasks = []
      
      if (this.app) {
        shutdown_tasks.push(this.app.close())
      }
      
      if (this.controller) {
        shutdown_tasks.push(this.controller.close())
      }
      
      await Promise.race([
        Promise.all(shutdown_tasks),
        new Promise(resolve => setTimeout(resolve, 10000))
      ])
      
      console.log('서버 정상 종료 완료')
      
      process.exit(0)
      
    } catch (error) {
      console.error('서버 종료 중 오류:', error)
      process.exit(1)
    }
  }
}

if (require.main === module) {
  const server = new ServerStarter()
  server.start()
}

module.exports = { ServerStarter }