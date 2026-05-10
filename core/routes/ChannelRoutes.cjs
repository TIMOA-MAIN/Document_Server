// core/routes/ChannelRoutes.cjs
const express = require('express')
const { ResponseHelper } = require('../utils/ResponseHelper.cjs')
const { LogHelper } = require('../utils/LogHelper.cjs')

class ChannelRoutes {
    constructor(controller) {
        this.controller = controller
        this.router = express.Router()
        this._init()
    }

    _init() {
        this._setup_routes()
        LogHelper.log('success', 'ChannelRoutes 초기화 완료')
    }

    _setup_routes() {
        // 채널 조회
        this.router.get('/server/:serverId/channels', this._handle_get_server_channels.bind(this))

        // 채널 관리 핵심 API 
        this.router.post('/channel/create', this._handle_create_channel.bind(this))
        this.router.get('/channel/page/:channelId/:serverId', this._handle_get_page_data.bind(this))
        this.router.post('/channel/:channelId/:serverId/save', this._handle_update_channel_page_title.bind(this))
        this.router.delete('/channel/:channelId/:serverId/delete', this._handle_delete_channel.bind(this))
    }

    // 서버 별 채널 조회
    async _handle_get_server_channels(req, res){
        try {
            const server_id = parseInt(req.params.serverId)
            
            if (!server_id) {
                LogHelper.log('error', '유효하지 않은 server_id')
                return res.status(400).json({
                    success: false,
                    error: '유효하지 않은 server_id'
                })
            }
            
            const result = await this.controller.get_channels_by_server(server_id)

            if (!result.success) {
                LogHelper.log('error', '채널 조회 실패:', result.error)
                return res.status(400).json({
                    success: false,
                    error: result.error
                })
            }

            LogHelper.log('success', `전체 채널 조회 API 성공: count=${result.channels.length}`)
            return res.status(200).json(result.channels)

        } catch (error) {
            LogHelper.log('error', '전체 채널 조회 API 실패', error.message)
            return res.status(500).json({
                success: false,
                error: '전체 채널 조회 실패',
                message: error.message
            })
        }
    }

    // 채널 생성
    async _handle_create_channel(req, res){
        try {
            const { serverId, pageTitle } = req.body

            const channel_data = { 
                server_id: serverId, 
                page_title: pageTitle 
            }

            const result = await this.controller.create_channel(channel_data)

            if (result.success) {
                LogHelper.log('success', `채널 생성 API 성공: channel_id=${result.channel.channel_id}`)
                return res.status(200).json(result.channel)
            } else {
                LogHelper.log('error', '채널 생성 API 실패:', result.error)
                return res.status(400).json({
                    success: false,
                    error: result.error || '채널 생성 실패'
                })
            }

        } catch (error) {
            LogHelper.log('error', '채널 생성 API 실패', error.message)
            return res.status(500).json({
                success: false,
                error: '채널 생성 실패',
                message: error.message
            })
        }
    }

    // 채널 별 페이지 데이터 조회
    async _handle_get_page_data(req, res){
        try {
            const channel_id = parseInt(req.params.channelId)
            const server_id = parseInt(req.params.serverId)
            
            if (!channel_id || !server_id) {
                return res.status(400).json({
                    success: false,
                    error: '유효하지 않은 파라미터'
                })
            }
            
            const result = await this.controller.get_page_data(server_id, channel_id)

            if (!result.success) {
                return res.status(400).json({
                    success: false,
                    error: result.error
                })
            }

            LogHelper.log('success', `페이지 조회 API 성공: channel_id=${channel_id}`)
            return res.status(200).json(result.page_data)

        } catch (error) {
            LogHelper.log('error', '페이지 데이터 조회 API 실패', error.message)
            return res.status(500).json({
                success: false,
                error: '페이지 데이터 조회 실패',
                message: error.message
            })
        }
    }

    // 채널 페이지 타이틀 수정
    async _handle_update_channel_page_title(req, res){
        try {
            const channel_id = parseInt(req.params.channelId)
            const { serverId, pageTitle } = req.body

            if (!channel_id || !serverId || !pageTitle) {
                return res.status(400).json({
                    success: false,
                    error: '필수 파라미터 누락'
                })
            }

            const updates = { server_id: serverId, page_title: pageTitle }

            const result = await this.controller.update_channel(channel_id, updates)

            if (result.success) {
                LogHelper.log('success', `채널 수정 API 성공: channel_id=${channel_id}`)
                return res.status(200).json(result.channel)
            } else {
                LogHelper.log('warning', `채널 수정 API 실패: ${result.error}`)
                return res.status(404).json({
                    success: false,
                    error: result.error || '채널을 찾을 수 없음'
                })
            }

        } catch (error) {
            LogHelper.log('error', `채널 수정 API 실패: channel_id=${req.params.channelId}`, error.message)
            return res.status(500).json({
                success: false,
                error: '채널 수정 실패',
                message: error.message
            })
        }
    }

    // 채널 삭제
    async _handle_delete_channel(req, res){
        try {
            const channel_id = parseInt(req.params.channelId)
            const server_id = parseInt(req.params.serverId)

            if (!channel_id || !server_id) {
                return res.status(400).json({
                    success: false,
                    error: '유효하지 않은 파라미터'
                })
            }

            const result = await this.controller.delete_channel(server_id, channel_id)

            if (result.success) {
                LogHelper.log('success', `채널 삭제 API 성공: channel_id=${channel_id}`)
                return res.status(200).json({
                    success: true,
                    message: '채널이 삭제되었습니다.'
                })
            } else {
                LogHelper.log('warning', `채널 삭제 API 실패: ${result.error}`)
                return res.status(404).json({
                    success: false,
                    error: result.error || '채널을 찾을 수 없음'
                })
            }

        } catch (error) {
            LogHelper.log('error', `채널 삭제 API 실패: channel_id=${req.params.channelId}`, error.message)
            return res.status(500).json({
                success: false,
                error: '채널 삭제 실패',
                message: error.message
            })
        }
    }

    get_router() {
        return this.router
    }
}

module.exports = { ChannelRoutes }
