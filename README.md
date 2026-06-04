# 가챙이 대시보드 🏠💰

Google Sheets 기반 가계부 자동화 서버리스 웹 대시보드

이 애플리케이션은 백엔드 서버 없이 브라우저에서 직접 Google Sheets API 및 Google Drive API(GIS / GAPI)와 통신하도록 설계된 정적 웹 애플리케이션입니다.

---

## 시작하기 전 1회 설정

### 1. Google Cloud Console 설정

1. [console.cloud.google.com](https://console.cloud.google.com) 접속
2. 새 프로젝트 생성 (예: `gachangi-dashboard`)
3. **API 및 서비스 → 라이브러리** → `Google Sheets API` 및 `Google Drive API` 활성화
4. **API 및 서비스 → 사용자 인증 정보** →
   - **OAuth 2.0 클라이언트 ID** 생성
     - 유형: `웹 애플리케이션`
     - 승인된 JavaScript 원본:
       ```
       http://localhost:8080
       ```
     - 생성 후 **클라이언트 ID** 복사
   - **API 키** 생성 후 복사

### 2. config.js 수정

`js/config.js` 파일을 열어 아래 정보를 본인의 값으로 수정합니다:

```javascript
CLIENT_ID: 'YOUR_CLIENT_ID.apps.googleusercontent.com',
API_KEY:   'YOUR_API_KEY',
SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',
// 기타 드라이브 폴더 ID 등 설정
```

### 3. 로컬 서버 실행 (테스트용)

```powershell
# 이 폴더에서 실행
cd C:\...\gachangi-dashboard

# 의존성 설치 (최초 1회)
npm install

# 로컬 개발 서버 실행
npm start
```
4. 브라우저에서 `http://localhost:8080` 접속 후 로그인하여 동작 확인

---

## GitHub Pages 배포 및 외부 기기 사용법 (서버리스)

가챙이 대시보드는 백엔드 서버가 필요 없는 100% 정적 클라이언트 앱이므로, GitHub Pages에 업로드하면 모바일, 태블릿, 다른 PC 등에서 자유롭게 접속할 수 있습니다.

### 1. GitHub 저장소 생성 및 코드 업로드
1. GitHub에 새 저장소(Repository)를 만듭니다 (예: `gachangi-dashboard`).
2. 로컬 프로젝트 폴더를 저장소에 업로드(push)합니다:
   ```bash
   git init
   git add .
   git commit -m "feat: 정적 서버리스 가계부 전환 완료"
   git branch -M main
   git remote add origin https://github.com/본인계정명/gachangi-dashboard.git
   git push -u origin main
   ```

### 2. GitHub Pages 설정
1. 생성한 GitHub 저장소의 **Settings -> Pages** 메뉴로 이동합니다.
2. **Build and deployment -> Source** 항목을 `Deploy from a branch`로 선택합니다.
3. Branch를 `main` (또는 배포한 브랜치) 및 `/ (root)` 폴더로 지정하고 **Save**를 누릅니다.
4. 몇 분 후 페이지 상단에 배포 주소가 생성됩니다 (예: `https://본인계정명.github.io/gachangi-dashboard/`).

### 3. Google Cloud Console 승인 도메인 설정 (필수)
배포된 주소에서 Google API가 정상 작동하려면 Google Cloud가 해당 도메인의 요청을 승인해야 합니다.
1. [Google Cloud Console](https://console.cloud.google.com)의 **API 및 서비스 -> 사용자 인증 정보**로 이동합니다.
2. 기존에 생성해 둔 OAuth 2.0 클라이언트 ID를 클릭하여 상세 편집 화면으로 들어갑니다.
3. **승인된 JavaScript 원본 (Authorized JavaScript Origins)**에 본인의 GitHub Pages URL을 추가합니다:
   - `https://본인계정명.github.io`
   *(※ 주의: 저장소 이름인 `/gachangi-dashboard/`는 제외하고, 도메인까지만 입력합니다.)*
4. **저장**을 누릅니다. (구글 서버에 반영되는 데 약 5~10분 정도 소요될 수 있습니다.)

---

## 기능 및 탭 구성

| 탭 | 기능 |
|----|------|
| 📊 대시보드 | YTD 누적 지출(저축 제외) 분석, 예산 관리, 월별 소비 트렌드 차트 |
| 📅 월별 현황 | 당월 소비 지출 총계, 고정비 요약, 카테고리별 지출 순위 차트 |
| 📋 상세 내역 | 전체 입출금 목록, `(저축)` 분류 적용 및 자산 흐름 인디고 색상 시각화 |
| ➕ 항목 추가 | 신규 내역 등록(입력값에 따라 구글 시트 셀 자동 추가) |
| ⚙️ 예산 설정 | 브라우저 로컬 스토리지에 저장되는 카테고리별 예산 설정 및 현황 |
