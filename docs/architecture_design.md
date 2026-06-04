# 가챙이 대시보드 - 서버리스 아키텍처 설계 사양서 (Architecture Design Document)

이 문서는 가챙이 대시보드가 백엔드 서버 없이 브라우저에서 직접 Google API 및 Gemini API와 통신(정적 서버리스 구조)하도록 설계된 사양을 정의합니다. 향후 유사한 에이전트를 구축하거나 본 프로젝트를 확장할 때 참조하는 개발 가이드라인입니다.

---

## 1. 아키텍처 개요 (Architecture Overview)

기존의 Node.js 백엔드 프록시 서버 구조를 탈피하고, HTML/JS/CSS만으로 이루어진 **100% Client-Side 정적 웹 애플리케이션**으로 전환되었습니다.
- **호스팅**: GitHub Pages, Netlify, Vercel 등의 정적 호스팅 서비스로 배포 가능.
- **인증 및 통신**: 브라우저에서 Google Identity Services(GIS) 팝업을 통해 직접 Google OAuth 2.0 Access Token을 획득하고, 이 토큰으로 Google Sheets 및 Google Drive API(GAPI)와 직접 REST 통신 수행.
- **AI 관제**: 브라우저에서 직접 Google Gemini API를 호출하여 영수증/문자 파일을 분석하고 시트에 삽입.

---

## 2. 구글 OAuth 2.0 및 API 통신 사양

### 2.1 인증 모듈 (`js/auth.js`)
- **GIS Token Client Flow**: `google.accounts.oauth2.initTokenClient`를 사용하여 브라우저 직접 팝업 로그인 창을 구동합니다.
- **토큰 로컬 캐시**: 발급된 Access Token과 만료 시각(Expiry)을 `localStorage` (`gachangi_access_token`, `gachangi_token_expiry`)에 저장하여, 브라우저 새로고침 시 세션이 유지되는 자동 로그인(Auto-login)을 지원합니다.
- **Client-side Credentials**: static 앱이므로 Client Secret을 노출하지 않고, 오직 `CLIENT_ID`와 `API_KEY`만 사용해 인증합니다.
- **API 스코프**:
  - Sheets API: `https://www.googleapis.com/auth/spreadsheets`
  - Drive API: `https://www.googleapis.com/auth/drive`

### 2.2 시트 연동 모듈 (`js/sheets.js`)
- **셀 배경색 및 검토 대기열 판단**:
  - `gapi.client.sheets.spreadsheets.get` 호출 시 `includeGridData: true` 옵션과 `fields: 'sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)'` 필터를 지정하여 셀의 배경색 정보를 함께 수신합니다.
  - 셀의 날짜 배경색이 노란색(`rgb: {red: 1, green: 1, blue: 0}`)인 경우 검토가 필요한 거래(`needsReview = true`)로 판단하여 대시보드 검토 큐에 적재합니다.
- **고정비(Fixed Expenses) 판별 및 수식 보존**:
  - 날짜가 `-`로 표기된 항목을 고정비 항목(`isFixed = true`)으로 간주합니다.
  - 고정비 및 일반 거래 내역을 추가/수정하여 시트를 다시 쓸 때는 `E열(누적 잔액)`의 수식이 깨지는 `#REF!` 오류를 막기 위해, 매 행마다 `=E(row-1)+C(row)-D(row)` 형태의 상대 수식을 동적으로 생성하여 기록합니다.

---

## 3. 핵심 비즈니스 로직 및 예외 규칙

### 3.1 '투자/저축' 카테고리 특수 처리
- **KPI 배제**: 종합 대시보드 및 월별 현황의 누적 지출(YTD KPI 및 트렌드 차트) 집계 시 `'투자/저축'` 카테고리 금액은 소모성 지출이 아니므로 합산에서 **제외**합니다. 
- **누적 순저축 집계**: 수입에서 일반 지출을 차감하고 남은 누적 순저축(Balance) 계산 시에는 투자/저축액이 자산으로 온전히 보존되어 누적 집계됩니다.
- **시각화 스타일 규칙**:
  - 상세 내역, 고정비 관리, 검토 대기열 등 모든 거래 리스트 화면에서 `'투자/저축'` 카테고리는 빨간색 지출 글자색 대신 **인디고(Indigo) 보라색 계열**을 적용합니다.
  - 금액 왼쪽에 **`(저축)`** 이라는 별도의 뱃지/라벨 텍스트를 접두어로 자동 추가하여 소비 지출과 완벽하게 시각적으로 구별합니다.
- **카테고리 랭킹**: 종합 대시보드의 카테고리 지출 순위(리스트 및 도넛 파이 차트)에는 사용자의 요구에 따라 **투자/저축 금액이 포함되어 랭킹에 표시**됩니다. 이때 비율(%) 계산의 분모는 투자/저축을 포함한 총계(`totalInList`)로 자동 산정됩니다.

---

## 4. UI/UX 및 디자인 규칙

- **폰트 시스템**: 한글과 영문 서체가 어색하게 깨지는 것을 막기 위해 구글 폰트의 **Noto Sans KR**과 **Outfit** 서체를 조합하여 전역에 통일 적용합니다.
  ```css
  font-family: 'Outfit', 'Noto Sans KR', -apple-system, sans-serif;
  ```
  Chart.js 폰트 옵션 및 동적 렌더링 폰트에도 Noto Sans KR 서체가 명시되도록 일관성을 유지합니다.
- **반응형 웹 디자인 (Responsive Design)**: 가로폭 768px 이하 해상도(모바일) 진입 시 미디어 쿼리를 통해 레이아웃이 유연하게 1열 세로 스택 구조로 변환됩니다.
  - 모바일에서는 사이드바가 슬라이드인(Slide-in) 오버레이 형태로 처리되며, ☰ 토글 버튼 및 닫기(`×`) 버튼으로 노출을 제어합니다.
- **카드/계좌 관리 테이블**: 보유 계좌 테이블이 상단, 보유 카드 테이블이 하단에 배치되는 상하 스택 형태를 유지하며, 카드 연결 계좌 입력란은 일반 텍스트가 아닌 동적 보유 계좌 목록 드롭다운(`<select>`)으로 바인딩됩니다.

---

## 5. 로컬 개발 환경 실행 사양

로컬 개발 환경에서의 간편한 정적 파일 서빙을 위해 리팩토링된 로컬 웹 서버(`agent_server.js`)는 OAuth 세션 및 미들웨어 의존성 없이 단독으로 동작합니다.
- **실행**: `npm start` (또는 `node agent_server.js` 실행)
- **포트**: 8080 (http://localhost:8080)
- **기능**: 프로젝트 루트의 정적 파일들을 서빙하며, `/` 경로 외의 기타 하위 라우팅 접근 시 기본 `index.html`을 반환하는 SPA 라우트 규칙을 지원합니다.

---

## 6. 미래의 AI 에이전트 협업 가이드 (AI Agent Collaboration Guide)

이 프로젝트를 처음 접하는 후속 AI 에이전트(또는 개발 어시스턴트)는 다음 가이드라인을 엄격히 따라야 합니다:

1. **사전 지식 습득**: 프로젝트의 소스 코드를 임의로 수정하기 전에 반드시 이 문서(`docs/architecture_design.md`)에 정리된 구글 API 연동 사양 및 비즈니스 로직(특히 '투자/저축' 지출 제외 및 인디고 컬러 시각화 규칙)을 선행 독해하십시오.
2. **컨텍스트 유지**: 이전에 나눈 대화 흐름과 사용자 요구 사항의 변경 이력(Express 백엔드 제거, 모바일 반응형 디자인 적용, Noto Sans KR 폰트 바인딩 완료 등)을 완벽히 보존하고 기억한 상태에서 코드를 작성해야 합니다.
3. **지침 프롬프트**: 사용자가 새로운 대화방에서 다음과 같이 요청하면, 해당 지침에 기반하여 코드의 일관성을 유지하며 구현해야 합니다:
   > *"프로젝트 내의 `docs/architecture_design.md` 파일에 적혀있는 가계부 대시보드 서버리스 인증 구조와 비즈니스 룰, 스타일 규칙을 먼저 읽어보고 작업 계획을 세워줘."*

