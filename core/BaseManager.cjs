// core/BaseManager.cjs
class BaseManager {
  constructor() {
    // 기본 관리자 클래스
  }

  async init() {
    // 초기화 메서드 (하위 클래스에서 구현)
  }

  async close() {
    // 종료 메서드 (하위 클래스에서 구현)
  }
}

module.exports = { BaseManager }
