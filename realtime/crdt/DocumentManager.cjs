// realtime/crdt/DocumentManager.cjs
const Y = require('yjs')
const { BaseManager } = require('../../core/BaseManager.cjs')
const { LogHelper } = require('../../core/utils/LogHelper.cjs')
const { Utils } = require('../../core/utils/Utils.cjs')

class DocumentManager extends BaseManager {
  constructor(database_service) {
    super()
    this.database_service = database_service
    
    // 방별 Y.js 문서 저장
    this.room_docs = new Map()
    
    // 자동 저장 관련
    this.save_timers = new Map()           // 저장 타이머
    this.pending_saves = new Map()         // 대기 중인 저장
    this.last_save_times = new Map()       // 마지막 저장 시간
    this.save_debounce_delay = 500         // 0.5초 디바운스
    
    // ✅ 자동 저장 리스너 활성화 여부 (Set)
    this.save_listeners_active = new Set()
    
    // ✅ 리스너 참조 저장 (cleanup용)
    this.save_listeners = new Map()
    
    // 복원 중인 방 추적 (Set)
    this.is_restoring = new Set()
  }

  // 문서 생성 (BlockNote를 위한 fragment 생성)
  async create_document(ydoc, room_name) {
    // BlockNote에서 사용할 fragment 생성
    const fragment = ydoc.getXmlFragment('document-store')
    
    // 추가 공유 타입들
    ydoc.getMap('users')
    ydoc.getMap('activities')
    
    this.room_docs.set(room_name, ydoc)
    
    LogHelper.log('success', `문서 생성 완료: ${room_name}`)
  }

  // DB에서 ydoc 복원
  async restore_from_database(server_id, channel_id, ydoc, room_name) {
    try {
        const channel = await this.database_service.get_channel_by_id(channel_id, server_id)
        
        if (!channel || !channel.ydoc_base64) {
        LogHelper.log('info', `DB에 저장된 데이터 없음: ${room_name}`)
        return false
        }

        // ✅ fragment 선언 추가!
        const fragment = ydoc.getXmlFragment('document-store')

        const base64Size = channel.ydoc_base64.length
        LogHelper.log('info', `현재 fragment.length: ${fragment.length}, DB 크기: ${base64Size} bytes`)
        
        // Base64 데이터 샘플 확인
        const sample = channel.ydoc_base64.substring(0, 100)
        LogHelper.log('info', `DB Base64 샘플: ${sample}...`)
        
        if (base64Size < 100) {
        LogHelper.log('warning', `DB 데이터가 너무 작음: ${base64Size} bytes`)
        return false
        }

        this.is_restoring.add(room_name)
        LogHelper.log('info', `DB 복원 시작: ${room_name} (자동 저장 일시 중지)`)

        const state_vector = Utils.decode_base64(channel.ydoc_base64)
        LogHelper.log('info', `디코딩 완료: ${state_vector.length} bytes`)
        
        // 복원 전 상태 확인
        const fragmentBefore = ydoc.getXmlFragment('document-store')
        //LogHelper.log('info', `복원 전 fragment.toJSON(): ${JSON.stringify(fragmentBefore.toJSON())}`)
        
        // 복원
        Y.applyUpdate(ydoc, state_vector)
        
        // 복원 후 상태 확인
        const fragmentAfter = ydoc.getXmlFragment('document-store')
        //LogHelper.log('info', `복원 후 fragment.length: ${fragmentAfter.length}`)
        //LogHelper.log('info', `복원 후 fragment.toJSON(): ${JSON.stringify(fragmentAfter.toJSON())}`)
        
        // Y.Doc 내부 상태 확인
        const allShares = Array.from(ydoc.share.keys())
        LogHelper.log('info', `Y.Doc shares: ${allShares.join(', ')}`)
        
        if (fragmentAfter.length === 0) {
        LogHelper.log('warning', `복원했지만 fragment가 비어있음 - DB 데이터 문제 가능성`)
        }

        setTimeout(() => {
        this.is_restoring.delete(room_name)
        this._setup_auto_save_listeners(ydoc, room_name, server_id, channel_id)
        }, 5000)

        LogHelper.log('success', `DB 복원 완료: ${room_name}, fragment.length=${fragmentAfter.length}`)
        return true
    } catch (error) {
        LogHelper.log('error', `DB 복원 실패: ${error.message}`)
        this.is_restoring.delete(room_name)
        return false
    }
  }

  // 자동 저장 리스너 설정
  _setup_auto_save_listeners(ydoc, room_name, server_id, channel_id) {
    if (this.save_listeners_active.has(room_name)) {
        LogHelper.log('info', `자동 저장 리스너 이미 활성화됨: ${room_name}`)
        return
    }

    // Y.js 문서 자체의 update 이벤트 감지
    const doc_update_handler = (update, origin, doc, transaction) => {
        if (this.is_restoring.has(room_name)) {
        LogHelper.log('info', `복원 중 - 자동 저장 스킵: ${room_name}`)
        return
        }
        
        const fragment = ydoc.getXmlFragment('document-store')
        const currentLength = fragment.length
        
        //LogHelper.log('info', `[Y.Doc 업데이트] 문서 변경 감지: ${room_name}, fragment.length=${currentLength}, origin=${origin}`)
        
        this._trigger_debounced_save(room_name, server_id, channel_id)
    }
    
    ydoc.on('update', doc_update_handler)
    
    // fragment의 deep observe
    const fragment = ydoc.getXmlFragment('document-store')
    const fragment_update_handler = (events, transaction) => {
        if (this.is_restoring.has(room_name)) {
        return
        }
        
        const currentLength = fragment.length
        //LogHelper.log('info', `[Fragment 업데이트] 문서 변경 감지: ${room_name}, fragment.length=${currentLength}`)
        
        this._trigger_debounced_save(room_name, server_id, channel_id)
    }
    
    fragment.observeDeep(fragment_update_handler)
    
    // 리스너 참조 저장
    this.save_listeners.set(room_name, {
        doc: doc_update_handler,
        fragment: fragment_update_handler
    })
    
    this.save_listeners_active.add(room_name)
    LogHelper.log('success', `자동 저장 리스너 설정 완료: ${room_name}`)
  }

  // 디바운스 저장 트리거
  _trigger_debounced_save(room_name, server_id, channel_id) {
    if (this.is_restoring.has(room_name)) {
        LogHelper.log('info', `복원 중 - 자동 저장 스킵: ${room_name}`)
        return
    }
    
    const ydoc = this.room_docs.get(room_name)
    if (!ydoc) return
    
    const fragment = ydoc.getXmlFragment('document-store')
    
    // ✅ fragment.length === 0일 때만 저장 스킵
    if (fragment.length === 0) {
        LogHelper.log('info', `빈 문서 저장 스킵: ${room_name}`)
        return
    }
    
    // ✅ fragment.length >= 1이면 무조건 저장 (빈 paragraph 체크 제거)
    //LogHelper.log('info', `저장 트리거: ${room_name}, fragment.length=${fragment.length}`)
    
    // 디바운스 타이머 설정
    if (this.save_timers.has(room_name)) {
        clearTimeout(this.save_timers.get(room_name))
    }
    
    const timer = setTimeout(async () => {
        await this.save_to_database(server_id, channel_id, ydoc, room_name)
        this.save_timers.delete(room_name)
    }, this.save_debounce_delay)
    
    this.save_timers.set(room_name, timer)
  }

  // 실제 자동 저장 실행
  async _execute_auto_save(room_name, server_id, channel_id) {
    try {
      if (!this.database_service) {
        this._cleanup_save_state(room_name)
        return
      }

      const ydoc = this.room_docs.get(room_name)
      if (!ydoc) {
        this._cleanup_save_state(room_name)
        return
      }

      // Y.js 상태를 DB에 저장
      const save_result = await this.save_to_database(server_id, channel_id, ydoc, room_name)
      
      if (save_result.success) {
        this.last_save_times.set(room_name, Date.now())
        LogHelper.log('success', `자동 저장 완료: ${room_name}`)
      } else {
        LogHelper.log('error', `자동 저장 실패: ${room_name}`, save_result.error)
      }

    } catch (error) {
      LogHelper.log('error', `자동 저장 오류: ${room_name}`, error.message)
    } finally {
      this._cleanup_save_state(room_name)
    }
  }

  // DB에 저장 (Y.js 인코딩)
  async save_to_database(server_id, channel_id, ydoc, room_name) {
    try {
      // Y.js 문서를 바이너리로 인코딩
      const state_vector = Y.encodeStateAsUpdate(ydoc)
      
      // Base64로 인코딩
      const ydoc_base64 = Utils.encode_base64(state_vector)
      
      // DB에 저장
      await this.database_service.update_ydoc(channel_id, server_id, ydoc_base64)
      
      LogHelper.log('info', `DB 저장 성공: ${room_name} (크기: ${ydoc_base64.length} bytes)`)
      
      return {
        success: true,
        room_name: room_name,
        size: ydoc_base64.length
      }

    } catch (error) {
      LogHelper.log('error', `DB 저장 실패: ${room_name}`, error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 강제 저장
  async force_save(room_name, server_id, channel_id) {
    const ydoc = this.room_docs.get(room_name)
    if (!ydoc) {
      LogHelper.log('error', `강제 저장 실패 - 문서 없음: ${room_name}`)
      return false
    }
    
    // 대기 중인 디바운스 저장이 있으면 클리어하고 즉시 실행
    if (this.save_timers.has(room_name)) {
      clearTimeout(this.save_timers.get(room_name))
    }
    
    await this._execute_auto_save(room_name, server_id, channel_id)
    return true
  }

  // 방 정리
  async cleanup_room(room_name) {
    try {
        LogHelper.log('info', `방 정리 시작: ${room_name}`)
        
        // ✅ 리스너 제거
        if (this.save_listeners.has(room_name)) {
        const listeners = this.save_listeners.get(room_name)
        const ydoc = this.room_docs.get(room_name)
        
        if (ydoc && listeners) {
            if (listeners.doc) {
            ydoc.off('update', listeners.doc)
            }
            if (listeners.fragment) {
            const fragment = ydoc.getXmlFragment('document-store')
            fragment.unobserveDeep(listeners.fragment)
            }
        }
        
        this.save_listeners.delete(room_name)
        }
        
        this.save_listeners_active.delete(room_name)
        
        // 타이머 정리
        if (this.save_timers.has(room_name)) {
        clearTimeout(this.save_timers.get(room_name))
        this.save_timers.delete(room_name)
        }
        
        // 문서 제거
        this.room_docs.delete(room_name)
        this.pending_saves.delete(room_name)
        this.last_save_times.delete(room_name)
        this.is_restoring.delete(room_name)
        
        LogHelper.log('success', `방 정리 완료: ${room_name}`)
        
    } catch (error) {
        LogHelper.log('error', `방 정리 실패: ${room_name}`, error.message)
    }
  }

  // 저장 상태 정리
  _cleanup_save_state(room_name) {
    this.save_timers.delete(room_name)
    this.pending_saves.delete(room_name)
  }

  // 저장 통계
  get_save_stats() {
    return {
      active_documents: this.room_docs.size,
      pending_saves: this.pending_saves.size,
      active_timers: this.save_timers.size,
      active_listeners: this.save_listeners_active.size,
      last_saves: Object.fromEntries(this.last_save_times),
      debounce_delay: this.save_debounce_delay
    }
  }

  // 사용자 등록
  register_user_in_document(ydoc, connection_id, room_name) {
    try {
      const room_users = ydoc.getMap('users')
      const user_activities = ydoc.getMap('activities')
      
      const user_info = new Y.Map()
      user_info.set('id', connection_id)
      user_info.set('connected_at', new Date().toISOString())
      user_info.set('last_activity', Date.now())
      
      room_users.set(connection_id, user_info)
      user_activities.set(connection_id, Date.now())
      
      LogHelper.log('info', `사용자 등록: ${connection_id}`)
    } catch (error) {
      LogHelper.log('error', `사용자 등록 실패: ${connection_id}`, error.message)
    }
  }

  // 사용자 제거
  remove_user_from_document(ydoc, connection_id) {
    try {
      const room_users = ydoc.getMap('users')
      const user_activities = ydoc.getMap('activities')
      
      room_users.delete(connection_id)
      user_activities.delete(connection_id)
      
      LogHelper.log('info', `사용자 제거: ${connection_id}`)
    } catch (error) {
      LogHelper.log('error', `사용자 제거 실패: ${connection_id}`, error.message)
    }
  }

  // 사용자 활동 업데이트
  update_user_activity(ydoc, connection_id) {
    try {
      const user_activities = ydoc.getMap('activities')
      user_activities.set(connection_id, Date.now())
    } catch (error) {
      LogHelper.log('error', `사용자 활동 업데이트 실패: ${connection_id}`, error.message)
    }
  }

  // 종료 시 정리
  async close() {
    try {
      LogHelper.log('info', 'DocumentManager 종료 중...')
      
      // 모든 대기 중인 저장 즉시 실행
      const save_promises = []
      
      for (const [room_name] of this.pending_saves) {
        if (this.save_timers.has(room_name)) {
          clearTimeout(this.save_timers.get(room_name))
          
          const ydoc = this.room_docs.get(room_name)
          if (ydoc) {
            // room_name에서 server_id와 channel_id 추출 필요
            // 간단한 방법: 모든 문서를 강제 저장
            save_promises.push(
              this.save_to_database(null, null, ydoc, room_name)
                .catch(err => LogHelper.log('error', '종료 시 저장 실패:', err.message))
            )
          }
        }
      }
      
      if (save_promises.length > 0) {
        await Promise.allSettled(save_promises)
        LogHelper.log('success', `${save_promises.length}개 문서 저장 완료`)
      }
      
      // 정리
      this.room_docs.clear()
      this.save_timers.clear()
      this.pending_saves.clear()
      this.last_save_times.clear()
      this.save_listeners_active.clear()
      this.is_restoring.clear()
      
      LogHelper.log('success', 'DocumentManager 종료 완료')
    } catch (error) {
      LogHelper.log('error', 'DocumentManager 종료 오류', error.message)
    }
  }
}

module.exports = { DocumentManager }
