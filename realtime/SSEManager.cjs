// SSEManager.cjs - 사용자별 SSE 구독 방식
const { LogHelper } = require('../core/utils/LogHelper.cjs')
const { BaseManager } = require('../core/BaseManager.cjs')

class SSEManager extends BaseManager {
  constructor() {
    super()
    this.user_connections = new Map() // 사용자별 연결 관리
    this.heartbeat_interval = null
    this.cleanup_interval = null
  }

  async init() {
    LogHelper.log('info', 'SSE 매니저 초기화 중...')
    this._start_heartbeat()
    this._start_cleanup()
    LogHelper.log('success', 'SSE 매니저 초기화 완료 (사용자별 구독)')
  }

  // SSE 연결 관리 - 사용자별
  add_connection(res, user_id, server_id,connection_info = {}) {
    // user_id 필수로 변경
    if (!user_id) {
      throw new Error('사용자 ID가 필요합니다.')
    }

    if (!server_id){
      throw new Error('서버 ID가 필요합니다.')
    }

    const connection_id = LogHelper.generate_id()
    const connection = {
      id: connection_id,
      res: res,
      user_id: user_id,
      connected_at: new Date(),
      last_heartbeat: new Date(),
      client_info: connection_info
    }

    // 사용자별 연결에 추가
    if (!this.user_connections.has(user_id)) {
      this.user_connections.set(user_id, new Set())
    }
    this.user_connections.get(user_id).add(connection)
    
    LogHelper.log('info', `SSE 연결 추가: ${connection_id} → 사용자 ${user_id}`)

    // SSE 헤더 설정
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Cache-Control'
    })

    // 초기 연결 확인 메시지
    this._send_to_connection(connection, {
      type: 'connection-established',
      connection_id: connection_id,
      user_id: user_id,
      timestamp: new Date().toISOString()
    })

    // 연결 종료 처리
    res.on('close', () => {
      this._remove_connection(connection)
    })

    res.on('error', (error) => {
      LogHelper.log('error', `SSE 연결 오류: ${connection_id}`, error.message)
      this._remove_connection(connection)
    })

    return connection_id
  }

  _remove_connection(connection) {
    try {
      // 사용자별 연결에서 제거
      if (connection.user_id && this.user_connections.has(connection.user_id)) {
        const user_conns = this.user_connections.get(connection.user_id)
        user_conns.delete(connection)
        
        // 빈 사용자 정리
        if (user_conns.size === 0) {
          this.user_connections.delete(connection.user_id)
          LogHelper.log('info', `빈 사용자 SSE 연결 정리: 사용자 ${connection.user_id}`)
        }
      }

      LogHelper.log('info', `SSE 연결 제거: ${connection.id}`)
    } catch (error) {
      LogHelper.log('error', 'SSE 연결 제거 실패', error)
    }
  }

  // 메시지 전송
  _send_to_connection(connection, data, event_type = 'message') {
    try {
      if (!connection.res || connection.res.destroyed) {
        return false
      }

      if (connection.res.headersSent && connection.res.finished) {
        return false
      }

      const message = `event: ${event_type}\ndata: ${JSON.stringify(data)}\n\n`
      connection.res.write(message)
      connection.last_heartbeat = new Date()
      
      return true
    } catch (error) {
      LogHelper.log('error', `SSE 메시지 전송 실패: ${connection.id}`, error.message)
      this._remove_connection(connection)
      return false
    }
  }

  // 사용자별 브로드캐스팅
  broadcast_to_user(user_id, message, event_type = 'message') {
    const user_conns = this.user_connections.get(user_id)
    
    if (!user_conns) {
      LogHelper.log('warning', `브로드캐스트 대상 사용자 연결 없음: 사용자 ${user_id}`)
      return 0
    }
    
    if (user_conns.size === 0) {
      LogHelper.log('warning', `브로드캐스트 대상 사용자 연결 비어있음: 사용자 ${user_id}`)
      return 0
    }

    let sent_count = 0
    let failed_count = 0
    const connections_to_remove = []

    LogHelper.log('info', `사용자 ${user_id} 브로드캐스트 시작: ${user_conns.size}개 연결 대상`)

    user_conns.forEach(connection => {
      try {
        // 연결 상태 확인
        if (!connection.res || connection.res.destroyed) {
          connections_to_remove.push(connection)
          failed_count++
          return
        }
        
        if (connection.res.headersSent && connection.res.finished) {
          connections_to_remove.push(connection)
          failed_count++
          return
        }

        // 메시지 전송
        const success = this._send_to_connection(connection, message, event_type)
        if (success) {
          sent_count++
        } else {
          connections_to_remove.push(connection)
          failed_count++
        }
      } catch (error) {
        LogHelper.log('error', `브로드캐스트 오류: ${connection.id}`, error.message)
        connections_to_remove.push(connection)
        failed_count++
      }
    })

    // 실패한 연결들 정리
    connections_to_remove.forEach(connection => {
      this._remove_connection(connection)
    })

    LogHelper.log('success', `사용자 ${user_id} 브로드캐스트 완료: 성공 ${sent_count}개, 실패 ${failed_count}개`)
    return sent_count
  }

  // 다중 사용자 브로드캐스팅
  broadcast_to_users(user_ids, message, event_type = 'message') {
    if (!Array.isArray(user_ids)) {
      user_ids = [user_ids]
    }

    let total_sent = 0
    const results = {}

    user_ids.forEach(user_id => {
      const sent_count = this.broadcast_to_user(user_id, message, event_type)
      results[user_id] = sent_count
      total_sent += sent_count
    })

    LogHelper.log('info', `다중 사용자 브로드캐스트 완료: ${user_ids.length}명 대상, 총 ${total_sent}개 연결에 전송`)
    
    return {
      total_sent,
      results
    }
  }

  // 모든 사용자에게 브로드캐스팅
  broadcast_to_all_users(message, event_type = 'message') {
    const all_user_ids = Array.from(this.user_connections.keys())
    
    if (all_user_ids.length === 0) {
      LogHelper.log('warning', '브로드캐스트할 활성 사용자 없음')
      return 0
    }

    return this.broadcast_to_users(all_user_ids, message, event_type)
  }

  // 채널 이벤트 브로드캐스팅 - 특정 사용자들에게
  broadcast_channel_created(user_ids, channel_data) {
    const message = {
      type: 'channel_created',
      channelId: channel_data.channel_id,
      serverId: channel_data.server_id,
      pageTitle: channel_data.page_title,
      ydoc_base64: channel_data.ydoc_base64
    }

    return this.broadcast_to_users(user_ids, message, 'channel_event')
  }

  broadcast_channel_deleted(user_ids, channel_id) {
    const message = {
      type: 'channel_deleted',
      channelId: channel_id,
      message: `채널 '${channel_id}'이 삭제되었습니다.`
    }

    return this.broadcast_to_users(user_ids, message, 'channel_event')
  }

  broadcast_channel_page_title_update(user_ids, channel_data) {
    const message = {
      type: 'channel_updated',
      channelId: channel_data.channel_id,
      serverId: channel_data.server_id,
      pageTitle: channel_data.page_title,
      message: `채널 '${channel_data.page_title}'이 변경되었습니다.`
    }

    return this.broadcast_to_users(user_ids, message, 'channel_event')
  }

  // 사용자 연결 상태 확인
  is_user_connected(user_id) {
    const user_conns = this.user_connections.get(user_id)
    return !!(user_conns && user_conns.size > 0)
  }

  // 사용자 연결 개수 조회
  get_user_connection_count(user_id) {
    const user_conns = this.user_connections.get(user_id)
    return user_conns ? user_conns.size : 0
  }

  // 전체 연결 통계
  get_connection_stats() {
    const stats = {
      total_users: this.user_connections.size,
      total_connections: 0,
      users_with_multiple_connections: 0
    }

    this.user_connections.forEach((connections, user_id) => {
      stats.total_connections += connections.size
      if (connections.size > 1) {
        stats.users_with_multiple_connections++
      }
    })

    return stats
  }

  // 하트비트 및 정리 작업
  _start_heartbeat() {
    this.heartbeat_interval = setInterval(() => {
      this._send_heartbeat()
    }, 30000) // 30초마다 하트비트
  }

  _send_heartbeat() {
    const heartbeat_data = {
      type: 'heartbeat',
      timestamp: new Date().toISOString(),
      server_time: Date.now()
    }

    let total_active = 0
    const users_to_remove = []

    // 사용자별로 하트비트 전송
    this.user_connections.forEach((user_conns, user_id) => {
      let user_active = 0
      const connections_to_remove = []

      user_conns.forEach(connection => {
        const success = this._send_to_connection(connection, heartbeat_data, 'heartbeat')
        if (success) {
          user_active++
          total_active++
        } else {
          connections_to_remove.push(connection)
        }
      })

      // 실패한 연결들 정리
      connections_to_remove.forEach(connection => {
        this._remove_connection(connection)
      })

      // 빈 사용자 정리
      if (user_active === 0 && user_conns.size === 0) {
        users_to_remove.push(user_id)
      }
    })

    // 빈 사용자들 정리
    users_to_remove.forEach(user_id => {
      this.user_connections.delete(user_id)
    })

    if (total_active > 0) {
      LogHelper.log('info', `SSE 하트비트 전송: ${total_active}개 연결, ${this.user_connections.size}명 사용자`)
    }
  }

  _start_cleanup() {
    this.cleanup_interval = setInterval(() => {
      this._cleanup_stale_connections()
    }, 60000) // 1분마다 정리
  }

  _cleanup_stale_connections() {
    const now = new Date()
    const timeout_threshold = 5 * 60 * 1000 // 5분
    let total_removed = 0

    this.user_connections.forEach((user_conns, user_id) => {
      const connections_to_remove = []

      user_conns.forEach(connection => {
        const time_since_heartbeat = now - connection.last_heartbeat
        if (time_since_heartbeat > timeout_threshold) {
          connections_to_remove.push(connection)
        }
      })

      connections_to_remove.forEach(connection => {
        LogHelper.log('info', `비활성 SSE 연결 정리: ${connection.id} (사용자 ${user_id})`)
        this._remove_connection(connection)
        total_removed++
      })
    })

    if (total_removed > 0) {
      LogHelper.log('info', `SSE 연결 정리 완료: ${total_removed}개`)
    }
  }

  // 종료 처리
  async close() {
    LogHelper.log('info', 'SSE 매니저 종료 중...')

    try {
      // 인터벌 정리
      if (this.heartbeat_interval) {
        clearInterval(this.heartbeat_interval)
      }
      if (this.cleanup_interval) {
        clearInterval(this.cleanup_interval)
      }

      // 모든 연결에 서버 종료 알림
      const shutdown_message = {
        type: 'server-shutdown',
        message: '서버가 종료됩니다.',
        timestamp: new Date().toISOString()
      }

      // 사용자별 연결에 종료 알림
      this.user_connections.forEach((user_conns, user_id) => {
        user_conns.forEach(connection => {
          this._send_to_connection(connection, shutdown_message, 'server-shutdown')
          try {
            connection.res.end()
          } catch (error) {
            // 무시
          }
        })
      })

      // 연결 정리
      this.user_connections.clear()

      LogHelper.log('success', 'SSE 매니저 종료 완료')
    } catch (error) {
      LogHelper.log('error', 'SSE 매니저 종료 오류', error)
    }
  }
}

module.exports = { SSEManager }