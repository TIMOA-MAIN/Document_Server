// realtime/CRDTManager.cjs
const Y = require('yjs')
const { setupWSConnection, getYDoc } = require('y-websocket/bin/utils')

const { BaseManager } = require('../core/BaseManager.cjs')
const { ConnectionManager } = require('./crdt/ConnectionManager.cjs')
const { DocumentManager } = require('./crdt/DocumentManager.cjs')

const { Config } = require('../config/Config.cjs')
const { LogHelper } = require('../core/utils/LogHelper.cjs')
const { Utils } = require('../core/utils/Utils.cjs')

class CRDTManager extends BaseManager {
  constructor(database_service, session_manager) {
    super()
    this.database_service = database_service
    this.session_manager = session_manager
    this.config = Config.CRDT_CONFIG

    // 핵심 매니저 클래스
    this.connection_manager = null
    this.document_manager = null

    // 정리 작업 인터벌
    this.cleanup_intervals = []
  }

  async init() {
    LogHelper.log('info', 'Y.js CRDT 매니저 초기화')
    try {
      // 1. 핵심 관리자들 초기화
      this._init_managers()

      // 2. 정리 작업 시작
      this._start_cleanup_tasks()

      LogHelper.log('success', 'Y.js CRDT 매니저 초기화 완료')
    } catch (error) {
      LogHelper.log('error', 'CRDT 매니저 초기화 실패:', error.message)
      throw error
    }
  }

  _init_managers() {
    // 연결 관리자
    this.connection_manager = new ConnectionManager(this.config)

    // 문서 관리자
    this.document_manager = new DocumentManager(
      this.database_service, 
      this.connection_manager, 
      this.config
    )
    
    LogHelper.log('success', 'CRDT 관리자들 초기화 완료')
  }

  _start_cleanup_tasks() {
    LogHelper.log('info', 'CRDT 정리 작업 스케줄링')
    
    // 비활성 연결 정리 (30초마다)
    const inactive_cleanup = setInterval(() => {
      try {
        this.connection_manager.cleanup_inactive_users()
      } catch (error) {
        LogHelper.log('error', '비활성 연결 정리 실패:', error.message)
      }
    }, this.config.connection_cleanup_interval)
    
    // DB 세션 정리 (1분마다)
    const session_cleanup = setInterval(async () => {
      if (this.session_manager) {
        try {
          await this.session_manager.manual_cleanup_old_sessions()
        } catch (error) {
          LogHelper.log('error', 'DB 세션 정리 실패:', error.message)
        }
      }
    }, this.config.session_cleanup_interval)
    
    this.cleanup_intervals = [
      inactive_cleanup,
      session_cleanup
    ]
    
    LogHelper.log('success', 'CRDT 정리 작업 스케줄링 완료')
  }

  // WebSocket 연결 처리 (Controller에서 호출)
  async handle_connection(ws, request, channel_id, user_id, server_id) {
    try {
        // request.parsed_params에서 room_name 가져오기
        const room_name = request.parsed_params?.room_name || `channel_${channel_id}`
    
        LogHelper.log('info', `WebSocket 연결 처리 시작 - channel=${channel_id}, user=${user_id}, room=${room_name}`)
        
        // 1. 연결 전 정리
        await this.connection_manager.cleanup_dead_connections(room_name)

        // 2. ✅ y-websocket 설정 전에 Y.js 문서만 먼저 가져오기
        const ydoc = getYDoc(room_name)
        
        // 3. ✅ DB 복원 먼저 실행
        LogHelper.log('info', `DB 복원 시도: ${room_name}`)
        const fragment_before = ydoc.getXmlFragment('document-store')
        LogHelper.log('info', `복원 전 fragment.length: ${fragment_before.length}`)

        await this.document_manager.restore_from_database(server_id, channel_id, ydoc, room_name)

        const fragment_after = ydoc.getXmlFragment('document-store')
        LogHelper.log('info', `복원 후 fragment.length: ${fragment_after.length}`)
        
        // 4. ✅ 복원 완료 후 WebSocket 연결 설정
        setupWSConnection(ws, request, {
        docName: room_name,
        gc: true
        })
        
        // 5. 문서 초기화
        await this.document_manager.create_document(ydoc, room_name)
        
        // 6. 연결 정보 생성
        const connection_info = this.connection_manager.create_connection_info(ydoc, room_name, ws)
        
        // 7. 연결 등록
        this.connection_manager.add_connection(room_name, connection_info)
        
        // 8. 서버별 연결 등록
        this.connection_manager.add_server_connection(server_id, connection_info.id, ws, room_name)
        
        // 9. 사용자 등록
        this.document_manager.register_user_in_document(ydoc, connection_info.id, room_name)
        
        // 10. WebSocket 이벤트 설정
        this._setup_websocket_events(ws, connection_info, room_name, ydoc, server_id, channel_id, user_id)
        
        // 11. DB 세션 생성
        await this._create_database_session(channel_id, user_id, connection_info.id) 
        
        // 12. 연결 성공
        const user_count = this.connection_manager.get_user_count(room_name)
        
        // ✅ 복원 상태 로그 추가
        const fragment = ydoc.getXmlFragment('document-store')
        LogHelper.log('success', `WebSocket 연결 완료: ${connection_info.id} (방 ${room_name}: ${user_count}명, fragment.length=${fragment.length})`)
        
    } catch (error) {
        LogHelper.log('error', 'WebSocket 연결 처리 실패:', error.message)
        LogHelper.log('error', 'Stack trace:', error.stack)
        ws.close()
    }
  }

  _setup_websocket_events(ws, connection_info, room_name, ydoc, server_id, channel_id, user_id) {
    // 연결 종료 시 정리
    ws.on('close', async () => {
        try {
        LogHelper.log('info', `WebSocket 종료: ${connection_info.id}`)
        
        // 연결 제거
        this.connection_manager.remove_connection(room_name, connection_info.id)
        
        // 사용자 제거
        this.document_manager.remove_user_from_document(ydoc, connection_info.id)
        
        // DB 세션 종료
        await this._end_database_session(channel_id, user_id, connection_info.id)
        
        // 연결이 0개면 문서 저장 후 30초 대기
        const remaining_users = this.connection_manager.get_user_count(room_name)
        if (remaining_users === 0) {
            LogHelper.log('info', `마지막 사용자 퇴장, 문서 저장: ${room_name}`)
            await this.document_manager.save_to_database(server_id, channel_id, ydoc, room_name)
            
            // ✅ 즉시 정리하지 말고 30초 대기 (재입장 대비)
            LogHelper.log('info', `30초 후 방 정리 예정: ${room_name}`)
            setTimeout(async () => {
            const current_users = this.connection_manager.get_user_count(room_name)
            if (current_users === 0) {
                LogHelper.log('info', `방 정리 실행: ${room_name}`)
                await this.document_manager.cleanup_room(room_name)
            } else {
                LogHelper.log('info', `사용자 재입장 감지, 방 정리 취소: ${room_name}`)
            }
            }, 30000) // 30초
        }
        
        } catch (error) {
        LogHelper.log('error', 'WebSocket 종료 처리 실패:', error.message)
        }
    })

    // 에러 처리
    ws.on('error', (error) => {
        LogHelper.log('error', `WebSocket 에러 (${connection_info.id}):`, error.message)
    })
  }

  async _create_database_session(channel_id, user_id, connection_id) {
    if (!this.session_manager) return
    
    try {
      await this.session_manager.create_session(channel_id, user_id, connection_id)
      LogHelper.log('success', `DB 세션 생성: ${connection_id}`)
    } catch (error) {
      LogHelper.log('error', 'DB 세션 생성 실패:', error.message)
    }
  }

  async _end_database_session(channel_id, user_id, connection_id) {
    if (!this.session_manager) return
    
    try {
      await this.session_manager.remove_session(connection_id, user_id)
      LogHelper.log('success', `DB 세션 종료: ${connection_id}`)
    } catch (error) {
      LogHelper.log('error', 'DB 세션 종료 실패:', error.message)
    }
  }

  // 종료 처리
  async close() {
    LogHelper.log('info', 'CRDT 매니저 종료 중...')
    
    try {
      // 정리 작업 중지
      this.cleanup_intervals.forEach(interval => clearInterval(interval))
      this.cleanup_intervals = []
      
      // 모든 문서 저장
      if (this.document_manager) {
        await this.document_manager.close()
      }
      
      // 연결 정리
      if (this.connection_manager) {
        this.connection_manager.close_all_connections()
      }
      
      LogHelper.log('success', 'CRDT 매니저 종료 완료')
      
    } catch (error) {
      LogHelper.log('error', 'CRDT 매니저 종료 오류:', error.message)
    }
  }
}

module.exports = { CRDTManager }
