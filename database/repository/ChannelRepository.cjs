const sql = require('mssql');
const { LogHelper } = require('../../core/utils/LogHelper.cjs')

class ChannelRepository {
  constructor(pool) {
    this.pool = pool;
  }

  async create_channel(server_id, page_title) {
    try {
      const result = await this.pool.request()
        .input('server_id', sql.BigInt, server_id)
        .input('page_title', sql.NVarChar(255), page_title)
        .query(`
          INSERT INTO notion_channel (server_id, page_title, ydoc_base64, created_at, updated_at)
          OUTPUT INSERTED.*
          VALUES (@server_id, @page_title, NULL, GETDATE(), GETDATE());
        `);

      // INSERT 후 반환된 레코드를 가져옴
      if (result.recordset.length > 0) {
        const newChannel = result.recordset[0];
        LogHelper.log(`Channel created: ${newChannel.channel_id}`);
        return this._map_channel(newChannel);
      }

      return null;
    } catch (error) {
      LogHelper.log('error', `Failed to create channel:`, error);
      throw error;
    }
  }

  async get_channel_by_id(channel_id, server_id) {
    try {
      const result = await this.pool.request()
        .input('channel_id', sql.BigInt, channel_id)
        .input('server_id', sql.BigInt, server_id)
        .query(`
          SELECT * FROM notion_channel 
          WHERE channel_id = @channel_id AND server_id = @server_id;
        `);
      
      if (result.recordset.length > 0) {
        return this._map_channel(result.recordset[0]);
      }
      return null;
    } catch (error) {
      LogHelper.log('error', `Failed to get channel ${channel_id}:`, error);
      throw error;
    }
  }

  async update_ydoc(channel_id, server_id, ydoc_base64) {
    try {
      const result = await this.pool.request()
        .input('channel_id', sql.BigInt, channel_id)
        .input('server_id', sql.BigInt, server_id)
        .input('ydoc_base64', sql.Text, ydoc_base64)
        .query(`
          UPDATE notion_channel 
          SET ydoc_base64 = @ydoc_base64, updated_at = GETDATE()
          WHERE channel_id = @channel_id AND server_id = @server_id;
          SELECT * FROM notion_channel WHERE channel_id = @channel_id AND server_id = @server_id;
        `);
      
      if (result.recordset.length > 0) {
        LogHelper.log(`Y.doc updated for channel: ${channel_id}`);
        return this._map_channel(result.recordset[0]);
      }
      return null;
    } catch (error) {
      LogHelper.log('error', `Failed to update ydoc for channel ${channel_id}:`, error);
      throw error;
    }
  }

  async update_page_title(channel_id, server_id, page_title) {
    try {
      const result = await this.pool.request()
        .input('channel_id', sql.BigInt, channel_id)
        .input('server_id', sql.BigInt, server_id)
        .input('page_title', sql.NVarChar(255), page_title)
        .query(`
          UPDATE notion_channel 
          SET page_title = @page_title, updated_at = GETDATE()
          WHERE channel_id = @channel_id AND server_id = @server_id;
          SELECT * FROM notion_channel WHERE channel_id = @channel_id AND server_id = @server_id;
        `);
      
      if (result.recordset.length > 0) {
        LogHelper.log(`Page title updated for channel: ${channel_id}`);
        return this._map_channel(result.recordset[0]);
      }
      return null;
    } catch (error) {
      LogHelper.log('error', `Failed to update page title for channel ${channel_id}:`, error);
      throw error;
    }
  }

  async delete_channel(channel_id, server_id) {
    try {
      await this.pool.request()
        .input('channel_id', sql.BigInt, channel_id)
        .input('server_id', sql.BigInt, server_id)
        .query(`
          DELETE FROM notion_channel 
          WHERE channel_id = @channel_id AND server_id = @server_id;
        `);
      
      LogHelper.log(`Channel deleted: ${channel_id}`);
      return true;
    } catch (error) {
      LogHelper.log('error', `Failed to delete channel ${channel_id}:`, error);
      throw error;
    }
  }

  async get_channels_by_server(server_id) {
    try {
      const result = await this.pool.request()
        .input('server_id', sql.BigInt, server_id)
        .query(`
          SELECT * FROM notion_channel 
          WHERE server_id = @server_id
          ORDER BY updated_at DESC;
        `);
      
      return result.recordset.map(row => this._map_channel(row));
    } catch (error) {
      LogHelper.log('error', `Failed to get channels for server ${server_id}:`, error);
      throw error;
    }
  }

  _map_channel(row) {
    return {
      channel_id: row.channel_id,
      server_id: row.server_id,
      page_title: row.page_title,
      ydoc_base64: row.ydoc_base64,
      created_at: row.created_at,
      updated_at: row.updated_at
    };
  }
}

module.exports = { ChannelRepository };