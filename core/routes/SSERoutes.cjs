// core/routes/SSERoutes.cjs
const express = require('express')
const { LogHelper } = require('../utils/LogHelper.cjs')
const { ResponseHelper } = require('../utils/ResponseHelper.cjs')

class SSERoutes {
    constructor(sse_manager, database_service) {
        this.database_service = database_service
        this.sse_manager = sse_manager
        this.router = express.Router()
        this._setup_routes()
    }

    // SSE 연결 엔드포인트 - /api/sse/user/{userId}/{serverId}
    _setup_routes(){
        this.router.get('/user/:userId/:serverId', this._handle_sse_events.bind(this))
    }

    async _handle_sse_events(req, res){
        try {
            const user_id = req.params.userId
            const server_id = req.params.serverId

            if (!user_id) {
                return res.status(400).json({
                    error: 'user_id는 필수입니다.',
                    message: 'SSE 연결을 위해서는 user_id가 필요합니다.'
                })
            }

            if (!server_id) {
                return res.status(400).json({
                    error: 'server_id는 필수입니다.',
                    message: 'SSE 연결을 위해서는 server_id가 필요합니다.'
                })
            }

            if (this.database_service) {
                const is_member = await this.database_service.is_user_server_member(server_id, user_id)

                LogHelper.log(`info`, `is_member ${is_member}`)
                
                if (!is_member) {
                    LogHelper.log(`SSE 접근 거부: 사용자 ${user_id}는 서버 ${server_id}의 멤버가 아님`)
                    
                    return res.status(403).json({
                        error: 'NOT_SERVER_MEMBER',
                        message: `사용자 '${user_id}'는 서버 ${server_id}의 멤버가 아닙니다.`
                    })
                }
                
                LogHelper.log(`서버 멤버십 검증 성공: 사용자 ${user_id} → 서버 ${server_id}`)
            } else {
                LogHelper.log(`warn `, 'DatabaseService가 설정되지 않아 멤버십 검증을 건너뜁니다')
            }

            LogHelper.log('info', ` SSE connection request for user: ${user_id}`)

            // 연결 정보 수집
            const connection_info = {
                ip: req.ip || req.connection.remoteAddress,
                user_agent: req.headers['user-agent'],
                origin: req.headers.origin
            }

            // SSE 연결 추가
            const connection_id = this.sse_manager.add_connection(res, user_id, server_id,connection_info)

            LogHelper.log('success', ` SSE 연결 성공: connection_id=${connection_id}, user_id=${user_id}`)

        } catch (error) {
            LogHelper.log('error', ` SSE 연결 실패: user_id=${req.params.userId}`, error.message)
            
            if (!res.headersSent) {
                res.status(500).json({
                    error: 'SSE 연결 실패',
                    message: error.message
                })
            }
        }
    }

    get_router() {
        return this.router
    }
}

module.exports = { SSERoutes }