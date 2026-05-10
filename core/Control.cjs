// core/Control.cjs

const { BaseManager } = require('./BaseManager.cjs')
const { DatabaseService } = require('../database/DatabaseService.cjs')
const { CRDTManager } = require('../realtime/CRDTManager.cjs')
const { SSEManager } = require('../realtime/SSEManager.cjs')
const { ChannelManager } = require('../services/ChannelManager.cjs')
const { SessionManager } = require('../services/SessionManager.cjs')
const { Config } = require('../config/Config.cjs')
const { LogHelper } = require('./utils/LogHelper.cjs')

class ControlManager extends BaseManager {
  constructor() {
    super()
    // 인프라 계층
    this.database_service = null
    this.crdt_manager = null
    this.sse_manager = null
    
    // 서비스 계층
    this.channel_manager = null
    this.session_manager = null
    
    this.is_active_flag = false
    this.startup_time = new Date()
    
    this.config = Config.CONTROL_CONFIG
  }

  async init() {
    LogHelper.log('info', '컨트롤 매니저 초기화')
    
    // 1. 인프라 계층 초기화
    await this._init_infra()
    
    // 2. 서비스 계층 초기화
    await this._init_services()
    
    this.is_active_flag = true
    LogHelper.log('success', '컨트롤 매니저 준비 완료')
  }

  async _init_infra() {
    LogHelper.log('info', '인프라 계층 초기화 중...')
    
    // 데이터베이스 초기화
    this.database_service = new DatabaseService()
    await this.database_service.init()

    // SSE 매니저 초기화
    this.sse_manager = new SSEManager(this.database_service)
    await this.sse_manager.init()
    
    //  SessionManager 먼저 초기화 (CRDT가 필요로 함)
    this.session_manager = new SessionManager(this.database_service)
    await this.session_manager.init()
    
    //  CRDT 매니저 초기화 (SessionManager 전달)
    this.crdt_manager = new CRDTManager(this.database_service, this.session_manager)
    await this.crdt_manager.init()
    
    LogHelper.log('success', '인프라 계층 초기화 완료 (DatabaseService + SSE + SessionManager + CRDT)')
  }

  async _init_services() {
    LogHelper.log('info', '서비스 계층 초기화 중...')
    
    //  ChannelManager 초기화 (CRDT 포함)
    this.channel_manager = new ChannelManager(
      this.database_service, 
      this.sse_manager, 
      this.crdt_manager
    )
    
    LogHelper.log('success', '서비스 계층 초기화 완료 (ChannelManager)')
  }

  /**
   *  WebSocket 연결 처리 (App으로부터 받음)
   */
  handle_websocket_connection(ws, request) {
    if (!this.crdt_manager) {
      LogHelper.log('error', 'CRDT Manager가 초기화되지 않았습니다')
      ws.close(1011, 'Server not ready')
      return
    }
    
    try {
      // request.parsed_params에서 정보 추출
      const { channel_id, user_id, server_id } = request.parsed_params || {}
      
      if(!server_id || !user_id || !channel_id){
        LogHelper.log('error', `server_id : ${server_id}, user_id : ${user_id}, channel_id : ${channel_id} 가 없습니다`)
        ws.close(1008, 'Invalid parameters')
        return
      }

      const is_channel_id = this.database_service.check_channel_id_by_server_id(server_id, channel_id)

      if(!is_channel_id){
        LogHelper.log('error', `server_id : ${server_id}에 맞는 channel_id : ${channel_id} 가 존재하지 않습니다`)
        ws.close(1008, 'Invalid parameters')
        return
      }

      
      LogHelper.log('info', `Controller: WebSocket 연결 처리 - channel=${channel_id}, user=${user_id}`)
      
      //  CRDT Manager에게 실제 처리 위임
      this.crdt_manager.handle_connection(ws, request, channel_id, user_id, server_id)
      
    } catch (error) {
      LogHelper.log('error', 'WebSocket 연결 처리 실패:', error.message)
      ws.close(1011, 'Server Error')
    }
  }

  // 채널 관리 위임
  async create_channel(channel_data) {
    return this.channel_manager.create_channel(channel_data)
  }

  async load_channel(server_id, channel_id) {
    return this.channel_manager.load_channel(server_id, channel_id)
  }

  // ✅ 추가: 서버별 채널 목록 조회
  async get_channels_by_server(server_id, options = {}) {
    return this.channel_manager.get_channels_by_server(server_id, options)
  }

  async delete_channel(server_id, channel_id) {
    return this.channel_manager.delete_channel(server_id, channel_id)
  }

  async update_channel(channel_id, updates) {
    return this.channel_manager.update_channel(channel_id, updates)
  }

  async get_page_data(server_id, channel_id) {
    return this.channel_manager.get_page_data(server_id, channel_id)
  }

  // SSE 관련 메서드
  get_sse_manager() {
    return this.sse_manager
  }

  get_database_service() {
    return this.database_service
  }

  // 리소스 정리
  async cleanup_inactive_resources() {
    try {
      LogHelper.log('info', '비활성 리소스 정리 시작...')
      
      const cleanup_results = {}
      
      // DB 세션 정리
      if (this.database_service) {
        const db_cleanup = await this.database_service.get_expiring_sessions()
        cleanup_results.database_sessions = db_cleanup
      }
      
      // 세션 매니저 정리
      if (this.session_manager) {
        const session_cleanup = await this.session_manager.manual_cleanup_old_sessions()
        cleanup_results.session_manager = session_cleanup
      }
      
      LogHelper.log('success', '리소스 정리 완료')
      return { 
        success: true, 
        cleanup_results: cleanup_results,
        cleaned_resources: Object.keys(cleanup_results).length
      }
      
    } catch (error) {
      LogHelper.log('error', '리소스 정리 실패:', error.message)
      return { success: false, error: error.message }
    }
  }

  // 종료 처리
  async close() {
    LogHelper.log('info', '컨트롤 매니저 종료 중...')
    
    try {
      this.is_active_flag = false
      
      // 마지막 리소스 정리
      await this.cleanup_inactive_resources()
      
      // 의존성들 순서대로 종료
      const shutdown_tasks = []
      
      if (this.channel_manager) {
        // ChannelManager는 close 메서드 없음
      }
      
      if (this.session_manager) {
        shutdown_tasks.push(this.session_manager.close())
      }
      
      if (this.crdt_manager) {
        shutdown_tasks.push(this.crdt_manager.close())
      }
      
      if (this.sse_manager) {
        shutdown_tasks.push(this.sse_manager.close())
      }
      
      if (this.database_service) {
        shutdown_tasks.push(this.database_service.close())
      }
      
      await Promise.all(shutdown_tasks)
      
      LogHelper.log('success', '컨트롤 매니저 종료 완료')
      
    } catch (error) {
      LogHelper.log('error', '컨트롤 매니저 종료 오류:', error.message)
    }
  }

  is_active() {
    return this.is_active_flag
  }
}

module.exports = { ControlManager }
