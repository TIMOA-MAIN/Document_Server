// App.cjs
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const cors = require('cors');

const { ChannelRoutes } = require('./routes/ChannelRoutes.cjs');
const { SSERoutes } = require('./routes/SSERoutes.cjs');

const { LogHelper } = require('./utils/LogHelper.cjs');
const { ResponseHelper } = require('./utils/ResponseHelper.cjs');

class App {
  constructor(config, controller) {
    this.app = express();
    this.server = http.createServer(this.app);
    this.wss = new WebSocket.Server({ noServer: true });

    this.config = config
    
    this.controller = controller;
    this.channel_routes = null;
    this.sse_routes = null;
  }

  async init() {
    LogHelper.log('info', 'Document 서버 초기화 시작');
    
    try {
      // 1. Express 미들웨어 설정
      this._setup_middleware();

      // 2. Routes 생성
      this._init_routes();
      
      // 2. Routes 설정
      this._setup_routes();
      
      // 3. WebSocket 설정
      this._setup_websocket();
      
      // 4. 에러 핸들러
      this._setup_error_handlers();
      
      LogHelper.log('success', 'Document 서버 초기화 완료');
      
    } catch (error) {
      LogHelper.log('error', 'Document 서버 초기화 실패:', error.message);
      throw error;
    }
  }

  _setup_middleware() {
    // CORS 설정
    this.app.use(cors({
      origin: '*',
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization']
    }));
    
    // JSON 파싱
    this.app.use(express.json({ limit: '50mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '50mb' }));
    
    // 요청 로깅
    this.app.use((req, res, next) => {
      const skip_logging = ['/health', '/favicon.ico', '/api/sse/'].some(path => req.path.includes(path))
      if (!skip_logging) {
        console.log(`${req.method} ${req.path} - ${req.ip}`)
      }
      next();
    });
    
    LogHelper.log('success', '미들웨어 설정 완료');
  }

  _init_routes(){
    console.log('라우트 초기화 중 (SSE 포함)...')
    
    // 각 라우트 클래스 인스턴스 생성
    this.channel_routes = new ChannelRoutes(this.controller);

    // SSE 라우트 초기화
    const sse_manager = this.controller.get_sse_manager()
    const database_service = this.controller.get_database_service()

    if (sse_manager) {
      this.sse_routes = new SSERoutes(sse_manager, database_service)
      console.log('SSE 라우트 초기화 완료 (DatabaseService 주입됨)')
    } else {
      console.log('SSE 매니저를 찾을 수 없음')
    }
    
    console.log('라우트 초기화 완료 (SSE 포함)')
  }

  _setup_routes() {
    // Health check
    this.app.get('/', (req, res) => {
      res.json({ 
        status: 'ok', 
        service: 'Document Service',
        timestamp: new Date().toISOString()
      });
    });
    
    this.app.get('/health', (req, res) => {
      res.json({ 
        status: 'OK',
        timestamp: new Date().toISOString()
      });
    });
    
    // API 라우트 등록
    this.app.use('/api/document', this.channel_routes.get_router());
    this.app.use('/sse', this.sse_routes.get_router());
    
    LogHelper.log('success', 'Routes 설정 완료');
  }

  _setup_websocket() {
    // WebSocket 업그레이드 핸들러
    this.server.on('upgrade', (request, socket, head) => {
      const url = request.url || '';
      
      // /document/:channel_id/:server_id/:user_id/:room_name
      // room_name은 y-websocket이 자동으로 추가 (필수)
      const document_match = url.match(/^\/document\/([^\/\?]+)\/([^\/\?]+)\/([^\/\?]+)\/([^\/\?]+)/);
      
      if (document_match) {
        this.wss.handleUpgrade(request, socket, head, (ws) => {
          this.wss.emit('connection', ws, request);
        });
      } else {
        console.log(`Unknown WebSocket path: ${url}`);
        socket.destroy();
      }
    });

    // WebSocket 연결 핸들러
    this.wss.on('connection', async (ws, request) => {
      const url = request.url;
      console.log(`WebSocket connected: ${url}`);

      // /document/:channel_id/:server_id/:user_id/:room_name (4개 파라미터 필수)
      const document_match = url.match(/^\/document\/([^\/\?]+)\/([^\/\?]+)\/([^\/\?]+)\/([^\/\?]+)/);
      
      if (document_match) {
        const channel_id = parseInt(document_match[1]);
        const server_id = parseInt(document_match[2]);
        const user_id = document_match[3];
        const room_name = document_match[4]; // room_name 추출
        
        if (!channel_id || !server_id || !user_id || !room_name) {
          console.log(`Missing parameters: channel=${channel_id}, server=${server_id}, user=${user_id}, room=${room_name}`);
          ws.close(4001, 'Missing required parameters');
          return;
        }
        
        // parsed_params 설정
        request.parsed_params = {
          channel_id: channel_id,
          server_id: server_id,
          user_id: user_id,
          room_name: room_name
        };
        
        console.log(`Document WebSocket: channel=${channel_id}, server=${server_id}, user=${user_id}, room=${room_name}`);
        
        try {
          await this.controller.handle_websocket_connection(ws, request);
        } catch (error) {
          console.error('WebSocket connection error:', error);
          ws.close(1011, 'Server Error');
        }
        
      } else {
        console.log(`Invalid WebSocket URL format: ${url}`);
        ws.close(4000, 'Invalid URL format');
      }
    });
    
    LogHelper.log('success', 'WebSocket 설정 완료');
  }

  _setup_error_handlers() {
    // 404 핸들러
    this.app.use((req, res) => {
      const available_endpoints = [
        'GET /',
        'GET /health',
        'GET /api/document/server/:serverId/channels',
        'POST /api/document/channel/create',
        'DELETE /api/document/channel/:channelId/:serverId/delete',
        'POST /api/document/channel/:channelId/:serverId/save',
        'GET /api/document/channel/page/:channelId/:serverId',
        'GET /sse/user/:userId/:serverId',
        'WS /document/:channelId/:serverId/:userId'
      ];
      
      res.status(404).json(
        ResponseHelper.notFound('요청한 경로을(를) 찾을 수 없습니다.', {
          path: req.path,
          available_endpoints: available_endpoints
        })
      );
    });
    
    // 에러 핸들러
    this.app.use((error, req, res, next) => {
      LogHelper.log('error', 'Unhandled error:', error.message);
      res.status(500).json(
        ResponseHelper.notFound('서버 내부 오류가 발생했습니다.', {
          message: error.message
        })
      );
    });
    
    LogHelper.log('success', '에러 핸들러 설정 완료');
  }

  async start() {
    return new Promise((resolve, reject) => {
      try {
        this.server.listen(this.config.port, () => {
          LogHelper.log('success', `Document 서버가 포트 ${this.config.port}에서 실행 중입니다`);
          LogHelper.log('info', `HTTP: http://${this.config.host}:${this.config.port}`);
          LogHelper.log('info', `WebSocket: ws://${this.config.host}:${this.config.port}/document/:channelId/:serverId/:userId/:room_name`);
          resolve();
        });
        
        this.server.on('error', (error) => {
          LogHelper.log('error', '서버 시작 실패:', error.message);
          reject(error);
        });
        
      } catch (error) {
        LogHelper.log('error', '서버 시작 중 오류:', error.message);
        reject(error);
      }
    });
  }

  async close() {
    LogHelper.log('info', 'Document 서버 종료 중...');
    
    try {
      // WebSocket 서버 종료
      this.wss.close();
      
      // HTTP 서버 종료
      await new Promise((resolve, reject) => {
        this.server.close((error) => {
          if (error) {
            LogHelper.log('error', 'HTTP 서버 종료 실패:', error.message);
            reject(error);
          } else {
            LogHelper.log('success', 'HTTP 서버 종료 완료');
            resolve();
          }
        });
      });
      
      // Controller 종료
      if (this.controller) {
        await this.controller.close();
      }
      
      LogHelper.log('success', 'Document 서버 종료 완료');
      
    } catch (error) {
      LogHelper.log('error', 'Document 서버 종료 오류:', error.message);
      throw error;
    }
  }
}

module.exports = { App };
