// database/DatabaseService.cjs
const sql = require('mssql')
const { ChannelRepository } = require('./repository/ChannelRepository.cjs')
const { SessionRepository } = require('./repository/SessionRepository.cjs')
const { UserRepository } = require('./repository/UserRepository.cjs')
const { LogHelper } = require('../core/utils/LogHelper.cjs')
const { Config } = require('../config/Config.cjs')

class DatabaseService {
  constructor() {
    this.pool = null
    this.channel_repo = null
    this.session_repo = null
    this.user_repo = null
  }

  async init() {
    try {
      LogHelper.log('info', 'DatabaseService 초기화 중...')
      
      const config = Config.DB_CONFIG
      this.pool = await sql.connect(config)

      this.channel_repo = new ChannelRepository(this.pool)
      this.session_repo = new SessionRepository(this.pool)
      this.user_repo = new UserRepository(this.pool)

      LogHelper.log('success', 'DatabaseService 초기화 완료')
      return true
    } catch (error) {
      LogHelper.log('error', 'DatabaseService 초기화 실패:', error.message)
      throw error
    }
  }

  async close() {
    if (this.pool) {
      await this.pool.close()
      LogHelper.log('info', 'Database connection pool closed')
    }
  }

  // ========== 채널 관련 메서드 ==========
  
  async check_channel_id_by_server_id(server_id, channel_id) {
    try {
      const result = await this.pool.request()
        .input('channel_id', sql.BigInt, channel_id)
        .input('server_id', sql.BigInt, server_id)
        .query(`
          SELECT TOP 1 1 as found
          FROM notion_channel 
          WHERE channel_id = @channel_id AND server_id = @server_id
        `)
      
      return result.recordset.length > 0
    } catch (error) {
      LogHelper.log('error', `Failed to check channel ${channel_id} in server ${server_id}:`, error.message)
      throw error
    }
  }

  async create_channel(server_id, page_title) {
    return await this.channel_repo.create_channel(server_id, page_title)
  }

  async get_channel_by_id(channel_id, server_id) {
    return await this.channel_repo.get_channel_by_id(channel_id, server_id)
  }

  async update_ydoc(channel_id, server_id, ydoc_base64) {
    return await this.channel_repo.update_ydoc(channel_id, server_id, ydoc_base64)
  }

  async update_page_title(channel_id, server_id, page_title) {
    return await this.channel_repo.update_page_title(channel_id, server_id, page_title)
  }

  async delete_channel(channel_id, server_id) {
    return await this.channel_repo.delete_channel(channel_id, server_id)
  }

  async get_channels_by_server(server_id) {
    return await this.channel_repo.get_channels_by_server(server_id)
  }

  // ========== 세션 관련 메서드 ==========
  
  async create_session(channel_id, user_id, websocket_id) {
    return await this.session_repo.create_session(channel_id, user_id, websocket_id)
  }

  async get_session_by_websocket_id(websocket_id) {
    return await this.session_repo.get_session_by_websocket_id(websocket_id)
  }

  async get_sessions_by_channel(channel_id) {
    return await this.session_repo.get_sessions_by_channel(channel_id)
  }

  async update_heartbeat(websocket_id) {
    return await this.session_repo.update_heartbeat(websocket_id)
  }

  async delete_session(websocket_id) {
    return await this.session_repo.delete_session(websocket_id)
  }

  async delete_stale_sessions(timeout_minutes = 30) {
    return await this.session_repo.delete_stale_sessions(timeout_minutes)
  }

  async cleanup_old_sessions(timeout_minutes = 30) {
    return await this.delete_stale_sessions(timeout_minutes)
  }

  async get_expiring_sessions(minutes_until_expiry = 5) {
    return await this.session_repo.get_expiring_sessions(minutes_until_expiry)
  }

  // ========== 사용자 관련 메서드 ==========
  
  async is_user_server_member(server_id, user_id) {
    return await this.user_repo.is_user_server_member(server_id, user_id)
  }

  async get_user_by_id(user_id) {
    return await this.user_repo.get_user_by_id(user_id)
  }

  async get_server_member_user_ids(server_id, include_inactive = true) {
    try {
      const members = await this.user_repo.get_server_members(server_id, include_inactive)
      return members.map(member => member.user_id)
    } catch (error) {
      LogHelper.log('error', '서버 멤버 user_id 목록 조회 실패:', error.message)
      return []
    }
  }

  // ========== Repository 접근자 ==========
  
  get_channel_repository() {
    return this.channel_repo
  }

  get_session_repository() {
    return this.session_repo
  }

  get_user_repository() {
    return this.user_repo
  }
}

module.exports = { DatabaseService }
