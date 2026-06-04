/**
 * 가챙이 대시보드 - Google API 설정 (템플릿)
 * 이 파일을 복사하여 js/config.js를 생성한 후 본인의 Google Cloud Console 값으로 채워주세요.
 * js/config.js 파일은 .gitignore에 의해 Git 추적에서 제외됩니다.
 */
const GACHANGI_CONFIG = {
  // Google Cloud Console → API 및 서비스 → 사용자 인증 정보
  CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com',
  API_KEY: 'YOUR_GOOGLE_API_KEY',

  // 가계부 스프레드시트 ID (URL에서 /d/ 다음 부분)
  SPREADSHEET_ID: 'YOUR_SPREADSHEET_ID',

  // Google Sheets API 스코프 및 Drive API 스코프
  SCOPES: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive',

  // Google Gemini API Key
  GEMINI_API_KEY: 'YOUR_GEMINI_API_KEY',

  // 구글 드라이브 폴더 ID 목록
  SOURCE_FOLDER_ID: 'YOUR_SOURCE_FOLDER_ID',
  ARCHIVE_FOLDER_ID: 'YOUR_ARCHIVE_FOLDER_ID',
  FAIL_FOLDER_ID: 'YOUR_FAIL_FOLDER_ID',

  // 데이터 시작 행 (code.gs의 START_ROW와 동일)
  START_ROW: 4,

  // 기본 카테고리 목록 (시트 드롭다운과 동일하게)
  DEFAULT_CATEGORIES: [
    '생활비', '교통/차량', '주거/통신', '보험', '의료/건강',
    '여행/여가', '육아', '용돈', '기타', '투자/저축', '수입', '가족'
  ],

  // 기본 결제수단 목록
  DEFAULT_METHODS: ['신한카드', '현대카드', '하나카드', '우리은행', '카카오뱅크', '혜영카드'],

  // 검토 필요 배경색 (노란색 #ffff00)
  REVIEW_COLOR: { red: 1, green: 1, blue: 0 },

  // 월 시트 이름 패턴
  MONTH_NAMES: ['1월', '2월', '3월', '4월', '5월', '6월', '7월', '8월', '9월', '10월', '11월', '12월'],
};
