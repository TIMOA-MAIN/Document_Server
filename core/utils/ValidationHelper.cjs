// core/utils/ValidationHelper.cjs
class ValidationHelper {
  static validate_channel_id(channel_id) {
    return typeof channel_id === 'number' && channel_id > 0
  }

  static validate_server_id(server_id) {
    return typeof server_id === 'number' && server_id > 0
  }

  static validate_user_id(user_id) {
    return typeof user_id === 'string' && user_id.trim().length > 0
  }

  static validate_page_title(title) {
    return typeof title === 'string' && title.trim().length > 0 && title.length <= 255
  }

  static validate_websocket_id(websocket_id) {
    return typeof websocket_id === 'string' && websocket_id.trim().length > 0
  }

  static validate_channel_data(data) {
    const errors = []

    if (!this.validate_server_id(data.server_id)) {
      errors.push('유효하지 않은 server_id')
    }

    if (!this.validate_page_title(data.page_title)) {
      errors.push('유효하지 않은 page_title')
    }

    return {
      valid: errors.length === 0,
      errors
    }
  }

  static sanitize_string(str, max_length = 255) {
    if (typeof str !== 'string') return ''
    return str.trim().substring(0, max_length)
  }
}

module.exports = { ValidationHelper }
