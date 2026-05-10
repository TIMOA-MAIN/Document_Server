// services/ChannelManager.cjs
const { BaseManager } = require('../core/BaseManager.cjs')
const { LogHelper } = require('../core/utils/LogHelper.cjs')
const { ValidationHelper } = require('../core/utils/ValidationHelper.cjs')

class ChannelManager extends BaseManager {
  constructor(database_service, sse_manager = null, crdt_manager = null) {
    super()
    this.database_service = database_service 
    this.sse_manager = sse_manager
    this.crdt_manager = crdt_manager
  }

  async init() {
    LogHelper.log('success', 'ChannelManager 초기화 완료')
  }

  async close() {
    LogHelper.log('info', 'ChannelManager 종료')
  }

  // 서버 멤버 목록 조회 (내부 메서드)
  async _get_server_member_user_ids(server_id) {
    try {
      const member_user_ids = await this.database_service.get_server_member_user_ids(server_id, true) // 비활성 포함
      LogHelper.log('INFO', `서버 ${server_id} 멤버 조회: ${member_user_ids.length}명`)
      return member_user_ids
    } catch (error) {
      LogHelper.error('ERROR','서버 멤버 조회 실패:', error)
      return []
    }
  }

  // 채널 생성
  async create_channel(channel_data) {
    try {
      // 검증
      const validation = ValidationHelper.validate_channel_data(channel_data)
      if (!validation.valid) {
        LogHelper.log('error', '채널 생성 검증 실패:', validation.errors.join(', '))
        return {
          success: false,
          errors: validation.errors
        }
      }
      
      // DB에 채널 생성
      const channel = await this.database_service.create_channel(
        channel_data.server_id,
        channel_data.page_title
      )

      if (!channel) {
        return {
          success: false,
          error: '채널 생성 실패'
        }
      }

      // SSE 알림 (선택적)
      if (this.sse_manager) {
        const server_member_user_ids = await this._get_server_member_user_ids(channel_data.server_id)
        const broadcast_result = this.sse_manager.broadcast_channel_created(server_member_user_ids, channel)
        LogHelper.log('INFO', `서버 멤버 자동 브로드캐스팅 완료: ${server_member_user_ids.length}명 대상, ${broadcast_result.total_sent}개 연결에 전송`)
        }

      return {
        success: true,
        channel: channel
      }

    } catch (error) {
      LogHelper.log('error', '채널 생성 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 채널 조회
  async load_channel(server_id, channel_id) {
    try {
      if (!ValidationHelper.validate_server_id(server_id)) {
        return {
          success: false,
          error: '유효하지 않은 server_id'
        }
      }

      if (!ValidationHelper.validate_channel_id(channel_id)) {
        return {
          success: false,
          error: '유효하지 않은 channel_id'
        }
      }

      const channel = await this.database_service.get_channel_by_id(channel_id, server_id)

      if (!channel) {
        return {
          success: false,
          error: '채널을 찾을 수 없습니다'
        }
      }

      return {
        success: true,
        channel: channel
      }

    } catch (error) {
      LogHelper.log('error', '채널 조회 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 채널 삭제
  async delete_channel(server_id, channel_id) {
    try {
      if (!ValidationHelper.validate_server_id(server_id)) {
        return {
          success: false,
          error: '유효하지 않은 server_id'
        }
      }

      if (!ValidationHelper.validate_channel_id(channel_id)) {
        return {
          success: false,
          error: '유효하지 않은 channel_id'
        }
      }

      // 채널 존재 확인
      const channel = await this.database_service.get_channel_by_id(channel_id, server_id)
      if (!channel) {
        return {
          success: false,
          error: '채널을 찾을 수 없습니다'
        }
      }

      // DB에서 삭제
      await this.database_service.delete_channel(channel_id, server_id)

      LogHelper.log('success', `채널 삭제 완료: ${channel_id}`)

      // SSE 알림 (선택적)
      if (this.sse_manager) {
        const server_member_user_ids = await this._get_server_member_user_ids(server_id)
        this.sse_manager.broadcast_channel_deleted(server_member_user_ids, channel_id)
        LogHelper.log('INFO', `삭제 알림 브로드캐스팅: ${server_member_user_ids.length}명`)
      }

      return {
        success: true,
        message: '채널이 삭제되었습니다'
      }

    } catch (error) {
      LogHelper.log('error', '채널 삭제 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 채널 수정 (페이지 제목)
  async update_channel(channel_id, updates) {
    try {

      if (!ValidationHelper.validate_server_id(updates.server_id)) {
        return {
          success: false,
          error: '유효하지 않은 server_id'
        }
      }

      if (!ValidationHelper.validate_channel_id(channel_id)) {
        return {
          success: false,
          error: '유효하지 않은 channel_id'
        }
      }

      if (!ValidationHelper.validate_page_title(updates.page_title)) {
        return {
          success: false,
          error: '유효하지 않은 page_title'
        }
      }

      // 채널 존재 확인
      const channel = await this.database_service.get_channel_by_id(channel_id, updates.server_id)
      if (!channel) {
        return {
          success: false,
          error: '채널을 찾을 수 없습니다'
        }
      }

      // 페이지 제목 업데이트
      const updated_channel = await this.database_service.update_page_title(
        channel_id,
        updates.server_id,
        updates.page_title
      )

      LogHelper.log('success', `채널 수정 완료: ${channel_id}`)

      // SSE 알림 (선택적)
      if (this.sse_manager) {
        const server_member_user_ids = await this._get_server_member_user_ids(updates.server_id)
        this.sse_manager.broadcast_channel_page_title_update(server_member_user_ids, updated_channel)
      }

      return {
        success: true,
        channel: updated_channel
      }

    } catch (error) {
      LogHelper.log('error', '채널 수정 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 서버별 채널 목록 조회
  async get_channels_by_server(server_id, options = {}) {
    try {
      if (!ValidationHelper.validate_server_id(server_id)) {
        return {
          success: false,
          error: '유효하지 않은 server_id'
        }
      }

      const channels = await this.database_service.get_channels_by_server(server_id)

      return {
        success: true,
        channels: channels,
        count: channels.length
      }

    } catch (error) {
      LogHelper.log('error', '채널 목록 조회 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 전체 채널 조회 (관리자용)
  async channel_all_load() {
    try {
      // 모든 채널을 조회하는 로직 (필요시 구현)
      LogHelper.log('info', '전체 채널 조회')
      return {
        success: true,
        message: '전체 채널 조회 기능은 구현 예정입니다'
      }
    } catch (error) {
      LogHelper.log('error', '전체 채널 조회 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }

  // 페이지 데이터 조회 (ydoc 포함)
  async get_page_data(server_id, channel_id) {
    try {
      if (!ValidationHelper.validate_server_id(server_id)) {
        return {
          success: false,
          error: '유효하지 않은 server_id'
        }
      }

      if (!ValidationHelper.validate_channel_id(channel_id)) {
        return {
          success: false,
          error: '유효하지 않은 channel_id'
        }
      }

      const channel = await this.database_service.get_channel_by_id(channel_id, server_id)

      if (!channel) {
        return {
          success: false,
          error: '채널을 찾을 수 없습니다'
        }
      }

      // ydoc_base64를 포함한 전체 데이터 반환
      return {
        success: true,
        page_data: {
          channel_id: channel.channel_id,
          server_id: channel.server_id,
          page_title: channel.page_title,
          ydoc_base64: channel.ydoc_base64,
          created_at: channel.created_at,
          updated_at: channel.updated_at
        }
      }

    } catch (error) {
      LogHelper.log('error', '페이지 데이터 조회 실패:', error.message)
      return {
        success: false,
        error: error.message
      }
    }
  }
}

module.exports = { ChannelManager }
