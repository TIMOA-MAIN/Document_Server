# TIMOA Document Server

> **Notion형 블록 문서의 실시간 공동 편집 서버**  
> Y.js CRDT로 블록 단위 변경을 병합하고, 채널별 문서를 자동 저장합니다.

![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Yjs](https://img.shields.io/badge/Y.js-CRDT-orange?style=flat-square)
![WebSocket](https://img.shields.io/badge/WebSocket-ws-black?style=flat-square)
![MSSQL](https://img.shields.io/badge/MS_SQL-CC2927?style=flat-square&logo=microsoftsqlserver&logoColor=white)

---

## 개요

TIMOA의 **Notion** 대체 기능을 담당합니다.  
팀 서버 안에 문서 채널을 만들고, 채널마다 하나의 Y.Doc을 공유해 여러 사용자가 동시에 블록 문서를 편집합니다.

초기에는 Spring Boot + STOMP로 구현했지만, 블록 단위 동시 편집에서 충돌 처리가 어려워 **Node.js + Y.js CRDT로 재구현**했습니다.

→ 결정 배경  
- [ADR 0005 — Document Server Spring → Node.js 전환](https://github.com/TIMOA-MAIN/TIMOA_Docs/blob/main/decisions/service/0005-document-server-migration.md)  
- [ADR 0007 — Notion형 블록 에디터 도입](https://github.com/TIMOA-MAIN/TIMOA_Docs/blob/main/decisions/service/0007-notionblock-adoption.md)  
- [ADR 0008 — STOMP 제거](https://github.com/TIMOA-MAIN/TIMOA_Docs/blob/main/decisions/service/0008-stomp-removal.md)  
- [ADR 0015 — Notion API 연동 시도와 대안](https://github.com/TIMOA-MAIN/TIMOA_Docs/blob/main/integration/0015-notion-api-fallback.md)

```
Client (블록 에디터) ── ws /document/:channelId/:serverId/:userId/:room ──┐
                                                                         ▼
                                              채널 검증 (server ↔ channel 소속 확인)
                                                                         ▼
                                               DB → Y.Doc 복원 (최초 접속 시)
                                                                         ▼
                                               Y.XmlFragment 동기화 (CRDT 병합)
                                                                         ▼
                                               변경 감지 → 디바운스 → MS SQL 저장
```

## 주요 기능

### 채널 기반 문서 협업
- 팀 서버(server) → 문서 채널(channel) → 문서(Y.Doc) 계층 구조
- WebSocket 연결 시 **채널이 해당 서버 소속인지 DB에서 검증**한 뒤에만 Room에 입장
- 최초 접속자가 들어오면 DB에서 문서를 읽어 Y.Doc을 **먼저 복원한 뒤** 동기화 시작 (빈 문서 덮어쓰기 방지)

### 자동 저장
- 문서는 `Y.XmlFragment('document-store')`에 블록 트리로 저장
- 문서 변경 시 **0.5초 디바운스 저장**으로 타이핑 중 과도한 DB 쓰기 방지
- 마지막 사용자가 나가면 즉시 저장하고, **30초 유예 후 Room 정리** (그 사이 재입장하면 정리 취소)
- 연결/종료 시 DB 세션 기록으로 접속 현황 추적

### 리소스 관리
- 비활성 Room과 만료 세션을 주기적으로 정리
- `BaseManager` 공통 클래스로 매니저 간 로깅·검증 로직 통일

## API

### REST
| Method | Path | 설명 |
|---|---|---|
| `GET` | `/server/:serverId/channels` | 서버의 문서 채널 목록 |
| `POST` | `/channel/create` | 문서 채널 생성 |
| `GET` | `/channel/page/:channelId/:serverId` | 문서 내용 조회 |
| `POST` | `/channel/:channelId/:serverId/save` | 수동 저장 |
| `DELETE` | `/channel/:channelId/:serverId/delete` | 채널 삭제 |
| `GET` | `/health` | 헬스체크 |

### SSE
| Method | Path | 설명 |
|---|---|---|
| `GET` | `/user/:userId/:serverId` | 채널 생성·삭제 등 이벤트 구독 |

### WebSocket
`ws://<host>/document/:channelId/:serverId/:userId/:roomName` — Y.js 동기화 프로토콜

## 프로젝트 구조

```
Document_Server/
├── Start.cjs                    # 진입점
├── config/Config.cjs            # 서버·CRDT·DB 설정
├── core/
│   ├── App.cjs                  # Express + HTTP + WS 업그레이드
│   ├── Control.cjs              # 연결 파라미터 검증, 매니저 조립
│   ├── BaseManager.cjs          # 매니저 공통 베이스
│   ├── routes/                  # ChannelRoutes, SSERoutes
│   └── utils/                   # LogHelper, ResponseHelper, ValidationHelper
├── realtime/
│   ├── CRDTManager.cjs          # 연결 처리·종료 시 저장·정리 스케줄
│   ├── SSEManager.cjs
│   └── crdt/
│       ├── ConnectionManager.cjs
│       └── DocumentManager.cjs  # Y.Doc 복원·디바운스 저장·강제 저장
├── services/                    # ChannelManager, NotionManager, SessionManager
└── database/                    # DatabaseService + Channel/Notion/Session/User Repository
```

## 실행

```bash
npm install
npm run dev        # nodemon
```

### 환경 변수 (`.env`)
| 변수 | 설명 | 기본값 |
|---|---|---|
| `PORT` | 서버 포트 | `8002` |
| `HOST` | 바인딩 주소 | `0.0.0.0` |
| `DB_SERVER` / `DB_PORT` | MS SQL 호스트 / 포트 | — / `1433` |
| `DB_NAME` / `DB_USER` / `DB_PASSWORD` | DB 접속 정보 | — |

## 관련 레포
- [Desktop_Client](https://github.com/TIMOA-MAIN/Desktop_Client) — 블록 에디터 UI (BlockNote + Y.js)
- [Proxy_Server](https://github.com/TIMOA-MAIN/Proxy_Server) — `/proxy/document`, `/proxy/sse-document` 라우팅
