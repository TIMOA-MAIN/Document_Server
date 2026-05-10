// services/SessionManager.cjs
const { BaseManager } = require('../core/BaseManager.cjs')
const { LogHelper } = require('../core/utils/LogHelper.cjs')

class SessionManager extends BaseManager {
  constructor(database_service) {
    super()
    this.db = database_service
    this.cleanup_interval = null
    this.cleanup_timeout = 30 * 60 * 1000 // 30분
  }

  async init() {
    LogHelper.log('info', 'SessionManager 초기화 중...')
    
    // 주기적 세션 정리 작업 시작
    this.start_cleanup_scheduler()
    
    LogHelper.log('success', 'SessionManager 초기화 완료')
  }

  // SessionManager 종료
  async close() {
    LogHelper.log('info', 'SessionManager 종료 중...')
    
    // 스케줄러 중지
    this.stop_cleanup_scheduler()
    
    LogHelper.log('success', 'SessionManager 종료 완료')
  }

  // 세션 생성
  async create_session(channel_id, user_id, websocket_id) {
    try {
      LogHelper.log('info', `세션 생성 요청: ${user_id} (채널: ${channel_id})`)
      
      const session = await this.db.create_session(channel_id, user_id, websocket_id)
      
      if (session) {
        LogHelper.log('success', `세션 생성 완료: ${websocket_id}`)
        
        return {
          success: true,
          message: `사용자 '${user_id}'의 세션이 생성되었습니다.`,
          session: {
            channel_id: session.channel_id,
            user_id: user_id,
            websocket_id: websocket_id,
            created_at: new Date().toISOString()
          }
        }
      } else {
        return {
          success: false,
          error: '세션 생성에 실패했습니다.',
          user_id
        }
      }
      
    } catch (error) {
      LogHelper.log('error', '세션 생성 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 세션 활동 업데이트 (하트비트)
  async update_activity(websocket_id) {
    try {
      const success = await this.db.update_heartbeat(websocket_id)
      return success
    } catch (error) {
      LogHelper.log('error', '세션 활동 업데이트 실패:', error.message)
      return false
    }
  }

  // 세션 제거
  async remove_session(websocket_id, user_id = null) {
    try {
      LogHelper.log('info', `세션 제거 요청: ${websocket_id}`)
      
      const success = await this.db.delete_session(websocket_id)
      
      if (success) {
        LogHelper.log('success', `세션 제거 완료: ${websocket_id}`)
        
        return {
          success: true,
          message: '세션이 제거되었습니다.',
          websocket_id: websocket_id
        }
      } else {
        return {
          success: false,
          error: '세션 제거에 실패했습니다.',
          websocket_id
        }
      }
      
    } catch (error) {
      LogHelper.log('error', '세션 제거 실패:', error.message)
      return {
        success: false,
        error: error.message,
        websocket_id
      }
    }
  }

  // 채널별 활성 세션 조회
  async get_active_sessions(channel_id) {
    try {
      LogHelper.log('info', `활성 세션 조회: 채널 ${channel_id}`)
      
      const sessions = await this.db.get_sessions_by_channel(channel_id)
      
      LogHelper.log('success', `활성 세션 조회 완료: ${sessions.length}개`)
      
      return {
        success: true,
        message: `${sessions.length}개의 활성 세션을 찾았습니다.`,
        channel_id: channel_id,
        active_sessions: sessions.map(session => ({
          channel_id: session.channel_id,
          user_id: session.user_id,
          websocket_id: session.websocket_id,
          connected_at: session.connected_at,
          last_heartbeat: session.last_heartbeat
        }))
      }
      
    } catch (error) {
      LogHelper.log('error', '활성 세션 조회 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 세션 존재 확인
  async session_exists(websocket_id) {
    try {
      const session = await this.db.get_session_by_websocket_id(websocket_id)
      
      return {
        success: true,
        exists: session !== null,
        websocket_id: websocket_id
      }
      
    } catch (error) {
      LogHelper.log('error', '세션 존재 확인 실패:', error.message)
      return {
        success: false,
        error: error.message,
        exists: false
      }
    }
  }

  // 만료 예정 세션 조회
  async get_expiring_sessions(minutes_until_expiry = 5) {
    try {
      LogHelper.log('info', `만료 예정 세션 조회: ${minutes_until_expiry}분 내`)
      
      const expiring_sessions = await this.db.get_expiring_sessions(minutes_until_expiry)
      
      LogHelper.log('success', `만료 예정 세션 조회 완료: ${expiring_sessions.length}개`)
      
      return {
        success: true,
        message: `${minutes_until_expiry}분 내 만료 예정 세션 ${expiring_sessions.length}개를 찾았습니다.`,
        expiring_sessions: expiring_sessions,
        criteria: {
          minutes_until_expiry: minutes_until_expiry
        }
      }
      
    } catch (error) {
      LogHelper.log('error', '만료 예정 세션 조회 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 주기적 세션 정리 스케줄러 시작
  start_cleanup_scheduler() {
    if (this.cleanup_interval) {
      clearInterval(this.cleanup_interval)
    }
    
    this.cleanup_interval = setInterval(async () => {
      try {
        LogHelper.log('info', '주기적 세션 정리 시작')
        
        const cleaned_count = await this.db.cleanup_old_sessions()
        
        if (cleaned_count > 0) {
          LogHelper.log('success', `주기적 세션 정리 완료: ${cleaned_count}개 제거`)
        }
        
      } catch (error) {
        LogHelper.log('error', '주기적 세션 정리 실패:', error.message)
      }
    }, this.cleanup_timeout)
    
    LogHelper.log('info', `세션 정리 스케줄러 시작: ${this.cleanup_timeout / 1000 / 60}분 간격`)
  }

  // 세션 정리 스케줄러 중지
  stop_cleanup_scheduler() {
    if (this.cleanup_interval) {
      clearInterval(this.cleanup_interval)
      this.cleanup_interval = null
      LogHelper.log('info', '세션 정리 스케줄러 중지')
    }
  }

  // 수동 세션 정리
  async manual_cleanup_old_sessions(timeout_minutes = 30) {
    try {
      LogHelper.log('info', `수동 세션 정리 시작: ${timeout_minutes}분 이상`)
      
      const cleaned_count = await this.db.delete_stale_sessions(timeout_minutes)
      
      LogHelper.log('success', `수동 세션 정리 완료: ${cleaned_count}개 제거`)
      
      return {
        success: true,
        message: `${timeout_minutes}분 이상 된 세션 ${cleaned_count}개가 정리되었습니다.`,
        cleaned_count: cleaned_count,
        criteria: `${timeout_minutes}분 이상`
      }
      
    } catch (error) {
      LogHelper.log('error', '수동 세션 정리 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 세션 하트비트 (활동 업데이트)
  async heartbeat(websocket_id) {
    try {
      const success = await this.update_activity(websocket_id)
      
      return {
        success: success,
        websocket_id: websocket_id,
        heartbeat_at: new Date().toISOString()
      }
      
    } catch (error) {
      return {
        success: false,
        error: error.message,
        websocket_id: websocket_id
      }
    }
  }

  // 세션 정보 조회 (웹소켓 ID로)
  async get_session_info(websocket_id) {
    try {
      const session = await this.db.get_session_by_websocket_id(websocket_id)
      
      if (session) {
        return {
          success: true,
          session: {
            channel_id: session.channel_id,
            user_id: session.user_id,
            websocket_id: session.websocket_id,
            connected_at: session.connected_at,
            last_heartbeat: session.last_heartbeat
          }
        }
      } else {
        return {
          success: false,
          error: '세션을 찾을 수 없습니다.',
          websocket_id: websocket_id
        }
      }
      
    } catch (error) {
      LogHelper.log('error', '세션 정보 조회 실패:', error.message)
      return {
        success: false,
        error: error.message,
        websocket_id: websocket_id
      }
    }
  }

  // 정리 주기 설정
  set_cleanup_timeout(minutes) {
    this.cleanup_timeout = minutes * 60 * 1000
    LogHelper.log('info', `세션 정리 주기 변경: ${minutes}분`)
    
    // 스케줄러 재시작
    if (this.cleanup_interval) {
      this.start_cleanup_scheduler()
    }
  }
}

module.exports = { SessionManager }
