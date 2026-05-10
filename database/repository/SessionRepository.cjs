// database/repository/SessionRepository.cjs
const sql = require('mssql')
const { LogHelper } = require('../../core/utils/LogHelper.cjs')

class SessionRepository {
  constructor(pool) {
    this.pool = pool
  }

  async create_session(channel_id, user_id, websocket_id) {
    try {
      const result = await this.pool.request()
        .input('channel_id', sql.BigInt, channel_id)
        .input('user_id', sql.NVarChar(50), user_id)
        .input('websocket_id', sql.NVarChar(255), websocket_id)
        .query(`
          INSERT INTO document_active_sessions (channel_id, user_id, websocket_id, connected_at, last_heartbeat)
          VALUES (@channel_id, @user_id, @websocket_id, GETDATE(), GETDATE());
          SELECT * FROM document_active_sessions WHERE websocket_id = @websocket_id;
        `)
      
      if (result.recordset.length > 0) {
        LogHelper.log('info', `Session created: ${websocket_id}`)
        return this._map_session(result.recordset[0])
      }
      return null
    } catch (error) {
      LogHelper.log('error', `Failed to create session ${websocket_id}:`, error.message)
      throw error
    }
  }

  async get_session_by_websocket_id(websocket_id) {
    try {
      const result = await this.pool.request()
        .input('websocket_id', sql.NVarChar(255), websocket_id)
        .query(`
          SELECT * FROM document_active_sessions 
          WHERE websocket_id = @websocket_id
        `)
      
      if (result.recordset.length > 0) {
        return this._map_session(result.recordset[0])
      }
      return null
    } catch (error) {
      LogHelper.log('error', `Failed to get session ${websocket_id}:`, error.message)
      throw error
    }
  }

  async get_sessions_by_channel(channel_id) {
    try {
      const result = await this.pool.request()
        .input('channel_id', sql.BigInt, channel_id)
        .query(`
          SELECT * FROM document_active_sessions 
          WHERE channel_id = @channel_id
        `)
      
      return result.recordset.map(row => this._map_session(row))
    } catch (error) {
      LogHelper.log('error', `Failed to get sessions for channel ${channel_id}:`, error.message)
      throw error
    }
  }

  async update_heartbeat(websocket_id) {
    try {
      await this.pool.request()
        .input('websocket_id', sql.NVarChar(255), websocket_id)
        .query(`
          UPDATE document_active_sessions 
          SET last_heartbeat = GETDATE()
          WHERE websocket_id = @websocket_id
        `)
      
      return true
    } catch (error) {
      LogHelper.log('error', `Failed to update heartbeat for ${websocket_id}:`, error.message)
      throw error
    }
  }

  async delete_session(websocket_id) {
    try {
      await this.pool.request()
        .input('websocket_id', sql.NVarChar(255), websocket_id)
        .query(`
          DELETE FROM document_active_sessions 
          WHERE websocket_id = @websocket_id
        `)
      
      LogHelper.log('info', `Session deleted: ${websocket_id}`)
      return true
    } catch (error) {
      LogHelper.log('error', `Failed to delete session ${websocket_id}:`, error.message)
      throw error
    }
  }
  
  async delete_stale_sessions(timeout_minutes = 30) {
    try {
      const result = await this.pool.request()
        .input('timeout_minutes', sql.Int, timeout_minutes)
        .query(`
          DELETE FROM document_active_sessions 
          WHERE DATEADD(MINUTE, @timeout_minutes, last_heartbeat) < GETDATE();
          SELECT @@ROWCOUNT as deleted_count;
        `)
      
      const deleted_count = result.recordset[0].deleted_count
      if (deleted_count > 0) {
        LogHelper.log('info', `Deleted ${deleted_count} stale sessions`)
      }
      return deleted_count
    } catch (error) {
      LogHelper.log('error', 'Failed to delete stale sessions:', error.message)
      throw error
    }
  }

  async get_expiring_sessions(minutes_until_expiry = 5) {
    try {
      const result = await this.pool.request()
        .input('minutes', sql.Int, minutes_until_expiry)
        .query(`
          SELECT * FROM document_active_sessions
          WHERE DATEADD(MINUTE, @minutes, last_heartbeat) < GETDATE()
        `)
      
      return result.recordset.map(row => this._map_session(row))
    } catch (error) {
      LogHelper.log('error', 'Failed to get expiring sessions:', error.message)
      throw error
    }
  }

  async cleanup_old(timeout_minutes = 30) {
    return await this.delete_stale_sessions(timeout_minutes)
  }

  _map_session(row) {
    return {
      channel_id: row.channel_id,
      user_id: row.user_id,
      websocket_id: row.websocket_id,
      connected_at: row.connected_at,
      last_heartbeat: row.last_heartbeat
    }
  }
}

module.exports = { SessionRepository }
