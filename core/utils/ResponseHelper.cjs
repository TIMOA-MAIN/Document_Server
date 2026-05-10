// core/utils/ResponseHelper.cjs
class ResponseHelper {
  static success(data = {}, message = 'Success') {
    return {
      status: 200,
      body: {
        success: true,
        message,
        data,
        timestamp: new Date().toISOString()
      }
    }
  }

  static created(data = {}, message = 'Created') {
    return {
      status: 201,
      body: {
        success: true,
        message,
        data,
        timestamp: new Date().toISOString()
      }
    }
  }

  static badRequest(message = 'Bad Request', errors = []) {
    return {
      status: 400,
      body: {
        success: false,
        message,
        errors,
        timestamp: new Date().toISOString()
      }
    }
  }

  static notFound(resource = 'Resource') {
    return {
      status: 404,
      body: {
        success: false,
        message: `${resource}을(를) 찾을 수 없습니다.`,
        timestamp: new Date().toISOString()
      }
    }
  }

  static serverError(error) {
    return {
      status: 500,
      body: {
        success: false,
        message: '서버 오류가 발생했습니다.',
        error: error.message || 'Internal Server Error',
        timestamp: new Date().toISOString()
      }
    }
  }

  static send(res, response) {
    return res.status(response.status).json(response.body)
  }
}

module.exports = { ResponseHelper }
