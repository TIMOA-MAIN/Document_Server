// realtime/crdt/ConnectionManager.cjs
const { BaseManager } = require('../../core/BaseManager.cjs')
const { LogHelper } = require('../../core/utils/LogHelper.cjs')

class ConnectionManager extends BaseManager {
  constructor(config) {
    super()
    this.config = config
    this.room_connections = new Map() // room_name -> Map(connection_id -> connection_info)
    this.server_connections = new Map() // server_id -> Map(connection_id -> connection_info)
  }

  // === 연결 정보 생성 ===
  create_connection_info(ydoc, room_name, ws) {
    const connection_id = LogHelper.generate_id()
    
    return {
      id: connection_id,
      room_name: room_name,
      ws: ws,
      connected_at: new Date(),
      last_activity: Date.now(),
      server_id: null, // 나중에 설정됨
      ydoc
    }
  }

  // 방별 연결 관리
  add_connection(room_name, connection_info) {
    if (!this.room_connections.has(room_name)) {
      this.room_connections.set(room_name, new Map())
    }
    
    this.room_connections.get(room_name).set(connection_info.id, connection_info)
    LogHelper.log('info', `연결 추가: ${connection_info.id} → 방 ${room_name}`)
  }

  remove_connection(room_name, connection_id) {
    const room_conns = this.room_connections.get(room_name)
    if (room_conns) {
      room_conns.delete(connection_id)
      
      // 빈 방 정리
      if (room_conns.size === 0) {
        this.room_connections.delete(room_name)
        LogHelper.log('info', `빈 방 정리: ${room_name}`)
      }
    }
    
    // 서버별 연결에서도 제거
    this.server_connections.forEach((server_conns, server_id) => {
      if (server_conns.has(connection_id)) {
        server_conns.delete(connection_id)
        
        if (server_conns.size === 0) {
          this.server_connections.delete(server_id)
        }
      }
    })
    
    LogHelper.log('info', `연결 제거: ${connection_id}`)
  }

  // 서버별 연결 관리
  add_server_connection(server_id, connection_id, ws, room_name) {
    if (!this.server_connections.has(server_id)) {
      this.server_connections.set(server_id, new Map())
    }
    
    const connection_info = {
      ws: ws,
      room_name: room_name,
      connected_at: new Date(),
      last_activity: Date.now()
    }
    
    this.server_connections.get(server_id).set(connection_id, connection_info)
    
    // 방별 연결 정보도 업데이트
    const room_conns = this.room_connections.get(room_name)
    if (room_conns && room_conns.has(connection_id)) {
      room_conns.get(connection_id).server_id = server_id
    }
    
    LogHelper.log('info', `서버별 연결 추가: ${connection_id} → 서버 ${server_id}`)
  }

  // 서버별 연결 제거
  remove_server_connection(server_id, connection_id) {
    if (!this.server_connections.has(server_id)) {
        return
    }
    
    const server_conns = this.server_connections.get(server_id)
    server_conns.delete(connection_id)
    
    // 빈 서버 정리
    if (server_conns.size === 0) {
        this.server_connections.delete(server_id)
        LogHelper.log('info', `빈 서버 연결 정리: 서버 ${server_id}`)
    }
    
    LogHelper.log('info', `서버별 연결 제거: ${connection_id} → 서버 ${server_id}`)
  }

  // 죽은 연결 정리
  async cleanup_dead_connections(room_name) {
    const room_conns = this.room_connections.get(room_name)
    if (!room_conns) return
    
    const dead_connections = []
    
    room_conns.forEach((connection_info, connection_id) => {
      const { ws } = connection_info
      if (ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) {
        dead_connections.push(connection_id)
      }
    })
    
    // 죽은 연결들 제거
    dead_connections.forEach(connection_id => {
      this.force_remove_connection(room_name, connection_id)
    })
    
    if (dead_connections.length > 0) {
      LogHelper.log('info', `죽은 연결 ${dead_connections.length}개 정리: ${room_name}`)
    }
  }

  // 강제 연결 제거
  force_remove_connection(room_name, connection_id) {
    const room_conns = this.room_connections.get(room_name)
    if (room_conns) {
      const connection_info = room_conns.get(connection_id)
      
      if (connection_info && connection_info.ws) {
        try {
          connection_info.ws.close(1000, 'Force cleanup')
        } catch (error) {
          // 이미 닫힌 연결 무시
        }
      }
      
      room_conns.delete(connection_id)
      
      // 빈 방 정리
      if (room_conns.size === 0) {
        this.room_connections.delete(room_name)
        LogHelper.log('info', `강제 정리 후 빈 방 제거: ${room_name}`)
      }
    }
    
    // 서버별 연결에서도 제거
    this.server_connections.forEach((server_conns, server_id) => {
      if (server_conns.has(connection_id)) {
        server_conns.delete(connection_id)
        
        if (server_conns.size === 0) {
          this.server_connections.delete(server_id)
        }
      }
    })
  }

  // 비활성 사용자 정리
  cleanup_inactive_users() {
    const now = Date.now()
    let removed_count = 0

    this.room_connections.forEach((room_conns, room_name) => {
      const connections_to_remove = []
      
      room_conns.forEach((connection_info, connection_id) => {
        const time_since_activity = now - connection_info.last_activity
        
        if (time_since_activity > this.config.inactive_threshold) {
          connections_to_remove.push(connection_id)
        }
      })

      connections_to_remove.forEach(connection_id => {
        this.force_remove_connection(room_name, connection_id)
        removed_count++
      })
    })

    if (removed_count > 0) {
      LogHelper.log('info', `비활성 사용자 ${removed_count}명 정리`)
    }
  }

  // 사용자 수 조회
  get_user_count(room_name) {
    const room_conns = this.room_connections.get(room_name)
    return room_conns ? room_conns.size : 0
  }

  // 방 통계 조회
  get_room_stats(room_name) {
    try {
      const room_conns = this.room_connections.get(room_name)
      
      if (!room_conns) {
        return {
          room_name: room_name,
          connected_users: 0,
          active_connections: 0,
          exists: false
        }
      }

      return {
        room_name: room_name,
        connected_users: room_conns.size,
        active_connections: room_conns.size,
        exists: true
      }
    } catch (error) {
      return {
        room_name: room_name,
        connected_users: 0,
        active_connections: 0,
        exists: false,
        error: error.message
      }
    }
  }

  // 전체 통계 조회
  get_all_stats() {
    try {
      const rooms = []
      let total_connections = 0
      
      this.room_connections.forEach((room_conns, room_name) => {
        const room_stats = this.get_room_stats(room_name)
        rooms.push(room_stats)
        total_connections += room_conns.size
      })

      return {
        total_rooms: this.room_connections.size,
        total_connections: total_connections,
        rooms: rooms
      }
    } catch (error) {
      return { 
        total_rooms: 0, 
        total_connections: 0, 
        rooms: [],
        error: error.message
      }
    }
  }

  // 전체 연결 수 조회
  get_total_connections() {
    let total = 0
    this.room_connections.forEach((room_conns) => {
      total += room_conns.size
    })
    return total
  }

  // 연결 활동 업데이트
  update_connection_activity(connection_id, room_name) {
    const room_conns = this.room_connections.get(room_name)
    if (room_conns && room_conns.has(connection_id)) {
      const connection_info = room_conns.get(connection_id)
      connection_info.last_activity = Date.now()
    }
  }

  // 연결 검증
  validate_connection(connection_id, room_name) {
    const room_conns = this.room_connections.get(room_name)
    if (!room_conns || !room_conns.has(connection_id)) {
      return false
    }
    
    const connection_info = room_conns.get(connection_id)
    const { ws } = connection_info
    
    return ws && ws.readyState === ws.OPEN
  }

  // 특정 사용자 연결 종료
  disconnect_user(connection_id, reason = 'Server request') {
    const connection_data = this.get_connection_by_id(connection_id)
    if (connection_data) {
      const { connection_info, room_name } = connection_data
      
      try {
        if (connection_info.ws && connection_info.ws.readyState === connection_info.ws.OPEN) {
          connection_info.ws.close(1000, reason)
        }
      } catch (error) {
        LogHelper.log('error', `사용자 연결 종료 실패: ${connection_id}`, error.message)
      }
      
      this.remove_connection(room_name, connection_id)
      LogHelper.log('info', `사용자 연결 강제 종료: ${connection_id} (이유: ${reason})`)
    }
  }

  get_connection_by_id(connection_id) {
    for (const [room_name, room_conns] of this.room_connections) {
      if (room_conns.has(connection_id)) {
        return {
          connection_info: room_conns.get(connection_id),
          room_name: room_name
        }
      }
    }
    return null
  }

  // 모든 연결 종료
  close_all_connections() {
    LogHelper.log('info', '모든 WebSocket 연결 종료 중...')
    
    let closed_count = 0
    
    this.room_connections.forEach((room_conns, room_name) => {
      room_conns.forEach((connection_info, connection_id) => {
        try {
          if (connection_info.ws && connection_info.ws.readyState === connection_info.ws.OPEN) {
            connection_info.ws.close(1000, 'Server shutdown')
            closed_count++
          }
        } catch (error) {
          // 무시
        }
      })
    })
    
    LogHelper.log('success', `${closed_count}개 연결 종료 완료`)
  }

  // 종료 처리
  close() {
    LogHelper.log('info', 'ConnectionManager 종료 중...')
    
    try {
      // 모든 연결 종료
      this.room_connections.forEach((room_conns, room_name) => {
        room_conns.forEach((connection_info, connection_id) => {
          try {
            if (connection_info.ws && connection_info.ws.readyState === connection_info.ws.OPEN) {
              connection_info.ws.close(1000, 'Server shutdown')
            }
          } catch (error) {
            // 무시
          }
        })
      })
      
      // 맵 정리
      this.room_connections.clear()
      this.server_connections.clear()
      
      LogHelper.log('success', 'ConnectionManager 종료 완료')
      
    } catch (error) {
      LogHelper.log('error', 'ConnectionManager 종료 오류:', error.message)
    }
  }
}

module.exports = { ConnectionManager }
