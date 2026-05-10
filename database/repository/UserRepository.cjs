const sql = require('mssql');
const { LogHelper } = require('../../core/utils/LogHelper.cjs')

class UserRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async is_user_server_member(server_id, user_id) {
    try {
      const result = await this.pool.request()
        .input('server_id', sql.BigInt, server_id)
        .input('user_id', sql.NVarChar(50), user_id)
        .query(`
          SELECT TOP 1 1 as found
          FROM server_members 
          WHERE server_id = @server_id AND user_id = @user_id;
        `);
      
      return result.recordset.length > 0;
    } catch (error) {
      LogHelper.log('error', `Failed to check membership for user ${user_id} in server ${server_id}:`, error);
      throw error;
    }
  }

  async get_user_by_id(user_id) {
    try {
      const result = await this.pool.request()
        .input('user_id', sql.NVarChar(50), user_id)
        .query(`
          SELECT user_id, user_name, profile_image_url
          FROM users 
          WHERE user_id = @user_id;
        `);
      
      if (result.recordset.length > 0) {
        return this._map_user(result.recordset[0]);
      }
      return null;
    } catch (error) {
      LogHelper.log('error', `Failed to get user ${user_id}:`, error);
      throw error;
    }
  }

  async get_server_members(server_id, include_inactive = true) {
    try {
      let query = `
        SELECT 
          member_id,
          server_id,
          user_id,
          role,
          joined_at,
          is_active
        FROM server_members 
        WHERE server_id = @server_id
      `

      if (!include_inactive) {
        query += ` AND is_active = 1`
      }

      query += ` ORDER BY joined_at DESC`

      const result = await this.pool.request()
        .input('server_id', sql.BigInt, server_id)
        .query(query)

      return result.recordset
    } catch (error) {
      LogHelper.log('error', '서버 멤버 조회 실패:', error.message)
      return []
    }
  }

  _map_user(row) {
    return {
      user_id: row.user_id,
      user_name: row.user_name,
      profile_image_url: row.profile_image_url
    };
  }
}

module.exports = { UserRepository };