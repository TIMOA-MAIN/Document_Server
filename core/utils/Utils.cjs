// core/utils/Utils.cjs
class Utils {
  // URL에서 channel_id 추출
  static extract_channel_id(url) {
    const match = url.match(/\/document\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)/)
    return match ? parseInt(match[1]) : null
  }

  // URL에서 server_id 추출
  static extract_server_id(url) {
    const match = url.match(/\/document\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)/)
    return match ? parseInt(match[2]) : null
  }

  // URL에서 user_id 추출
  static extract_user_id(url) {
    const match = url.match(/\/document\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)/)
    return decodeURIComponent(match[3])
  }

  // URL에서 room_name 추출
  static extract_room_name(url) {
    const match = url.match(/\/document\/([^\/]+)\/([^\/]+)\/([^\/]+)\/([^\/]+)/)
    return decodeURIComponent(match[4])
  }

  // room_name 생성 (channel_id 기반)
  static generate_room_name(channel_id) {
    return `channel_${channel_id}`
  }

  // Base64 인코딩
  static encode_base64(buffer) {
    return Buffer.from(buffer).toString('base64')
  }

  // Base64 디코딩
  static decode_base64(base64_string) {
    return Buffer.from(base64_string, 'base64')
  }

  // 타임스탬프 생성
  static get_timestamp() {
    return new Date().toISOString()
  }

  // 지연 함수
  static delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  }

  // 안전한 JSON 파싱
  static safe_json_parse(json_string, default_value = null) {
    try {
      return JSON.parse(json_string)
    } catch (error) {
      return default_value
    }
  }

  // 안전한 JSON 문자열화
  static safe_json_stringify(obj, default_value = '{}') {
    try {
      return JSON.stringify(obj)
    } catch (error) {
      return default_value
    }
  }
}

module.exports = { Utils }
