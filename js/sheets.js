/**
 * 가챙이 대시보드 - Google Sheets API 직접 연동 모듈 (서버리스 정적 버전)
 * 백엔드 프록시 서버 없이 브라우저에서 직접 Google Sheets API와 통신하여 데이터를 처리합니다.
 */

const SheetsAPI = (() => {
  const cfg = GACHANGI_CONFIG;
  let _sheetMeta = {}; // { '1월': sheetId, ... }
  let _categories = [...cfg.DEFAULT_CATEGORIES];
  let _methods = [...cfg.DEFAULT_METHODS];

  // 열 인덱스 (구글 시트 백업/마이그레이션용 호환성 필드)
  let colIndices = {
    date: 0,   // A
    desc: 1,   // B
    inc: 2,    // C
    exp: 3,    // D
    cat: 5,    // F
    method: 6  // G
  };

  /** 컬럼 인덱스를 문자열 라벨로 변환 (마이그레이션용) */
  function _colIndexToLabel(index) {
    let label = '';
    let temp = index;
    while (temp >= 0) {
      label = String.fromCharCode((temp % 26) + 65) + label;
      temp = Math.floor(temp / 26) - 1;
    }
    return label;
  }

  /** 구글 시트에서 단일 월 원본 데이터 로드 */
  async function loadMonthDataFromGoogleSheets(monthName) {
    const sheetId = _sheetMeta[monthName];
    if (sheetId === undefined) return [];

    const endRow = cfg.START_ROW + 500;
    const range = `${monthName}!A${cfg.START_ROW}:Z${endRow}`;

    const res = await gapi.client.sheets.spreadsheets.get({
      spreadsheetId: cfg.SPREADSHEET_ID,
      ranges: [range],
      includeGridData: true,
      fields: 'sheets.data.rowData.values(formattedValue,effectiveFormat.backgroundColor)',
    });

    const rowData = res.result.sheets?.[0]?.data?.[0]?.rowData || [];
    const transactions = [];
    let lastValidDate = '';

    rowData.forEach((row, i) => {
      const cells = row.values || [];
      const rawDate = cells[colIndices.date]?.formattedValue || '';
      const desc = cells[colIndices.desc]?.formattedValue || '';
      
      let inc = 0;
      let exp = 0;
      const rawCat = cells[colIndices.cat]?.formattedValue || '';
      const cat = _normalizeCategory(rawCat, desc);
      
      if (colIndices.inc === colIndices.exp) {
        const amt = _parseNumber(cells[colIndices.inc]?.formattedValue);
        if (cat === '수입') {
          inc = amt;
        } else {
          exp = amt;
        }
      } else {
        inc = _parseNumber(cells[colIndices.inc]?.formattedValue);
        exp = _parseNumber(cells[colIndices.exp]?.formattedValue);
        
        if (cat === '수입' && inc === 0 && exp > 0) {
          inc = exp;
          exp = 0;
        }
        if (cat !== '수입' && exp === 0 && inc > 0) {
          exp = inc;
          inc = 0;
        }
      }

      if (!rawDate && !desc && inc === 0 && exp === 0) return;

      if (rawDate) {
        lastValidDate = rawDate;
      }
      const date = rawDate || lastValidDate || '-';

      const bgColor = cells[colIndices.date]?.effectiveFormat?.backgroundColor || { red: 1, green: 1, blue: 1 };

      transactions.push({
        rowIndex: cfg.START_ROW + i,
        date,
        desc,
        inc,
        exp,
        cat,
        method: cells[colIndices.method]?.formattedValue || '',
        bgColor,
        needsReview: _isYellow(bgColor),
      });
    });

    return transactions;
  }

  /** 드롭다운 목록 로드 */
  async function _loadDropdowns() {
    const existingMonth = cfg.MONTH_NAMES.find(m => _sheetMeta[m] !== undefined);
    if (!existingMonth) return;

    try {
      const catCol = _colIndexToLabel(colIndices.cat);
      const methodCol = _colIndexToLabel(colIndices.method);

      const res = await gapi.client.sheets.spreadsheets.get({
        spreadsheetId: cfg.SPREADSHEET_ID,
        ranges: [`${existingMonth}!${catCol}25:${methodCol}25`],
        includeGridData: true,
        fields: 'sheets.data.rowData.values.dataValidation',
      });

      const sheet = res.result.sheets?.[0];
      const rows = sheet?.data?.[0]?.rowData || [];
      const catCell = rows[0]?.values?.[0];
      const methodCell = rows[0]?.values?.[1];

      _categories = _extractDropdown(catCell) || _categories;
    } catch (e) {
      console.warn('[Sheets] 드롭다운 로드 실패, 기본값 사용:', e.message);
    }
  }

  function _extractDropdown(cell) {
    const dv = cell?.dataValidation;
    if (!dv) return null;
    const vals = dv.condition?.values;
    if (!vals || vals.length === 0) return null;

    if (dv.condition.type === 'ONE_OF_LIST') {
      return vals.map(v => v.userEnteredValue).filter(Boolean);
    }
    return null;
  }

  function _isYellow(bg) {
    if (!bg) return false;
    const r = Math.round((bg.red || 0) * 255);
    const g = Math.round((bg.green || 0) * 255);
    const b = Math.round((bg.blue || 0) * 255);
    return r >= 240 && g >= 240 && b <= 20;
  }

  function _parseNumber(str) {
    if (!str) return 0;
    return parseInt(str.replace(/[^0-9-]/g, ''), 10) || 0;
  }

  function _normalizeCategory(cat, desc) {
    const trimmedDesc = (desc || '').trim();
    const trimmed = (cat || '').trim();
    // (버그수정) 과거: desc에 '공금'이 포함되면 명시 분류(cat)를 무시하고 무조건 '기타'로 덮어썼다.
    // → 예) '공금-마트장보기'(분류 생활비)가 '기타'로 둔갑. 이제는 명시 분류가 없을 때만
    //    '공금' 항목을 '기타'로 분류하고, 분류가 지정돼 있으면 그 분류를 존중한다.
    if (!trimmed && (trimmedDesc.includes('공금') || trimmedDesc.includes('혜영 공금') || trimmedDesc.includes('혜영공금'))) {
      return '기타';
    }
    const mapping = {
      '식비': '생활비', '식생활': '생활비', '외식': '생활비', '배달': '생활비', '마트': '생활비', '식재료': '생활비', '생필품': '생활비', '생활용품': '생활비',
      '자동차': '교통/차량', '교통': '교통/차량', '교통비': '교통/차량', '주유': '교통/차량', '차량': '교통/차량',
      '집': '주거/통신', '주거': '주거/통신', '통신비': '주거/통신', '통신': '주거/통신', '핸드폰': '주거/통신', '휴대폰': '주거/통신', '인터넷': '주거/통신',
      '보험료': '보험',
      '의료비': '의료/건강', '병원': '의료/건강', '약국': '의료/건강', '건강': '의료/건강',
      '여행': '여행/여가', '여가': '여행/여가', '문화': '여행/여가', '영화': '여행/여가', '도서': '여행/여가', '숙박': '여행/여가',
      '아가': '육아', '육아': '육아', '교육': '육아', '학원': '육아',
      '용돈': '용돈', '의류': '용돈', '패션': '용돈', '취미': '용돈', '개인': '용돈',
      '기타': '기타', '고정비': '기타', '잡비': '기타', '가족': '가족', '공금': '기타', '경조사': '기타', '경조사비': '기타', '회비': '기타', '구독': '기타', '구독료': '기타', '세금': '기타', '과태료': '기타',
      '투자/저축': '투자/저축', '저축': '투자/저축', '투자': '투자/저축', '예금': '투자/저축', '적금': '투자/저축', '청약': '투자/저축', '주식': '투자/저축', '펀드': '투자/저축',
      '수입': '수입', '급여': '수입', '월급': '수입', '보너스': '수입', '성과급': '수입', '상여금': '수입', '이자': '수입', '지원금': '수입'
    };

    let resolvedCat = mapping[trimmed] || trimmed;

    if (!trimmed && desc) {
      const descUpper = desc.toUpperCase();
      const keywordRules = [
        { cat: '생활비', keywords: ['국밥', '식당', '카페', '커피', '베이커리', '제과', '치킨', '피자', '스타벅스', '배달의민족', '요기요', '배민', '코스트코', '이마트', '홈플러스', '롯데마트', '쿠팡', '마켓컬리', '다이소', '편의점', 'CU', 'GS25', '지에스네트웍스', '(주)지에스네트웍스', '식비', '외식', '배달', '마트', '식재료', '생활용품', '생필품', '올리브영', '푸드', '반찬', '밀키트'] },
        { cat: '교통/차량', keywords: ['GS칼텍스', 'SK에너지', 'S-OIL', '현대오일뱅크', '주유소', '하이패스', '도로공사', '주차장', '카센터', '택시', '카카오T', '버스', '지하철', 'KTX', 'SRT', '쏘카', '교통', '차량', '주유', '자동차', '대리운전', '통행료', '주차'] },
        { cat: '주거/통신', keywords: ['관리비', '도시가스', '한국전력', 'KEPCO', '수도요금', '전기요금', '가스요금', '아파트관리', '월세', '임대료', '통신비', '통신', '핸드폰', '휴대폰', '인터넷', 'SKT', 'KT', 'LGU+', '요금제', '정수기', '렌탈'] },
        { cat: '보험', keywords: ['실손보험', '암보험', '자동차보험', '보험료', '보험', '생명보험', '손해보험', '화재보험'] },
        { cat: '의료/건강', keywords: ['약국', '병원', '의원', '한의원', '치과', '피부과', '내과', '소아과', '메디컬', '클리닉', '의료비', '건강', '피트니스', '헬스', '요가', '필라테스', '비타민', '영양제'] },
        { cat: '여행/여가', keywords: ['항공', '에어', '호텔', '숙박', '리조트', '펜션', '에어비앤비', '야놀자', '여기어때', '아고다', '익스피디아', '하나투어', '인터파크투어', '여행', '여가', '문화', '영화', '도서', 'CGV', '롯데시네마', '교보문고', '티켓', '리조트'] },
        { cat: '육아', keywords: ['기저귀', '분유', '아동복', '유아복', '베이비', '유모차', '카시트', '장난감', '육아', '소아과', '산후조리원', '아가', '교육', '학원', '어린이집', '유치원', '키즈카페', '키즈'] },
        { cat: '용돈', keywords: ['용돈', '의류', '패션', '취미', '개인', '백화점', '아울렛', '미용', '헤어', '미용실', '네일'] },
        { cat: '투자/저축', keywords: ['적금', '주식', '예금', '청약', '펀드', '개인연금', '저축', '투자', '증권', '자산'] },
        { cat: '수입', keywords: ['급여', '월급', '보너스', '성과급', '상여금', '이자', '지원금', '수입', '환급', '캐시백', '입금'] },
        { cat: '가족', keywords: ['부모님', '어버이날', '명절', '세뱃돈', '용돈(부모님)', '엄마', '아빠', '시댁', '친정', '가족 행사', '가족 모임'] },
        { cat: '기타', keywords: ['넷플릭스', 'NETFLIX', 'SPOTIFY', '멜론', '유튜브프리미엄', '디즈니플러스', '왓챠', '쿠팡플레이', '아마존프라임', '애플뮤직', '티빙', '웨이브', '회비', '모임 회비', '고정비', '잡비', '공금', '경조사', '경조사비', '세금', '과태료', '구독', '구독료', '주민세', '지방세', '벌금'] }
      ];

      for (const rule of keywordRules) {
        if (rule.cat === '기타' && resolvedCat === '기타') continue;
        const matched = rule.keywords.some(kw => descUpper.includes(kw.toUpperCase()));
        if (matched) {
          resolvedCat = rule.cat;
          break;
        }
      }
    }

    return resolvedCat;
  }

  // ─── 리팩토링된 직접 구글 API 연동 함수 ───

  /** 스프레드시트 메타데이터 로드 (시트 목록 및 ID 조회) */
  async function loadSpreadsheetMeta() {
    console.log('[Sheets] 구글 API 직접 연동 - 메타데이터 로드 시작');
    try {
      const res = await gapi.client.sheets.spreadsheets.get({
        spreadsheetId: cfg.SPREADSHEET_ID,
        fields: 'sheets.properties(title,sheetId)'
      });
      const sheets = res.result.sheets || [];
      _sheetMeta = {};
      sheets.forEach(s => {
        _sheetMeta[s.properties.title] = s.properties.sheetId;
      });
      console.log('[Sheets] 메타데이터 로드 성공:', _sheetMeta);
      await _loadDropdowns();
    } catch (e) {
      console.error('[Sheets] 메타데이터 로드 실패:', e);
      throw e;
    }
    return _sheetMeta;
  }

  /** 특정 월 데이터 로드 */
  async function loadMonthData(monthName) {
    if (Object.keys(_sheetMeta).length === 0) {
      await loadSpreadsheetMeta();
    }
    const rawTxs = await loadMonthDataFromGoogleSheets(monthName);
    
    // 날짜가 '-'인 고정비 항목을 해당 월의 1일(예: 05/01)로 동적 변환
    const processed = rawTxs.map(t => {
      if (t.date === '-') {
        const mMatch = monthName.match(/(\d+)월/);
        const displayDate = mMatch ? `${mMatch[1].padStart(2, '0')}/01` : '-';
        return {
          ...t,
          date: displayDate,
          isFixed: true // 고정비 플래그 추가
        };
      }
      return t;
    });

    console.log(`[Sheets] 구글 시트 [${monthName}] 데이터 필터 및 고정비 변환 완료: ${processed.length}건`);
    return processed;
  }

  /** 단일 거래 내역 추가 */
  async function addTransaction(monthName, data, isFixed = false) {
    const matchedTxs = await addTransactionsBatch(monthName, [data], isFixed);
    const matched = matchedTxs.find(r => r.date === data.date && r.desc === data.desc && r.exp === (data.exp || 0) && r.inc === (data.inc || 0));
    return matched ? matched.rowIndex : matchedTxs.length;
  }

  /** 다중 거래 내역 일괄 추가 */
  async function addTransactionsBatch(monthName, itemsData, isFixed = false) {
    if (!itemsData || itemsData.length === 0) return [];
    
    if (Object.keys(_sheetMeta).length === 0) {
      await loadSpreadsheetMeta();
    }
    const sheetId = _sheetMeta[monthName];
    if (sheetId === undefined) {
      throw new Error(`[Sheets] 해당 월의 시트를 찾을 수 없음: ${monthName}`);
    }

    const values = itemsData.map(item => [
      item.date || '-',
      item.desc || '',
      item.inc || 0,
      item.exp || 0,
      '', // Column E
      item.cat || '',
      item.method || ''
    ]);

    const range = `${monthName}!A4`;
    console.log(`[Sheets] 일괄 추가 중 - month: "${monthName}", 건수: ${values.length}`);
    
    const appendRes = await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: cfg.SPREADSHEET_ID,
      range,
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values }
    });

    const updatedRange = appendRes.result.updates?.updatedRange;
    console.log(`[Sheets] 추가 완료 updatedRange:`, updatedRange);
    
    const match = updatedRange?.match(/A(\d+):/);
    if (match) {
      const startRow = parseInt(match[1], 10);
      const formatRequests = [];

      itemsData.forEach((item, index) => {
        const rowNum = startRow + index;
        let red = 1, green = 1, blue = 1;
        if (!isFixed) {
          red = 1; green = 1; blue = 0; // Yellow
        } else if (item.bgColor) {
          red = item.bgColor.red ?? 1;
          green = item.bgColor.green ?? 1;
          blue = item.bgColor.blue ?? 1;
        }

        formatRequests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: rowNum - 1,
              endRowIndex: rowNum,
              startColumnIndex: 0,
              endColumnIndex: 1
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red, green, blue }
              }
            },
            fields: 'userEnteredFormat.backgroundColor'
          }
        });
      });

      if (formatRequests.length > 0) {
        console.log(`[Sheets] 일괄 포맷팅 업데이트 중 - month: "${monthName}", 건수: ${formatRequests.length}`);
        await gapi.client.sheets.spreadsheets.batchUpdate({
          spreadsheetId: cfg.SPREADSHEET_ID,
          resource: { requests: formatRequests }
        });
      }
    }

    return await loadMonthData(monthName);
  }

  /** 단일 거래 내역 수정 */
  async function updateRow(monthName, rowIndex, data) {
    const update = {
      month: monthName,
      rowIndex: rowIndex,
      date: data.date,
      desc: data.desc,
      inc: data.inc || 0,
      exp: data.exp || 0,
      cat: data.cat,
      method: data.method,
      needsReview: false,
      bgColor: { red: 1, green: 1, blue: 1 }
    };

    await updateRowsBatch(monthName, [update]);
  }

  /** 단일 거래 내역 삭제 */
  async function deleteRow(monthName, rowIndex) {
    await deleteRowsBatch(monthName, [rowIndex]);
  }

  /** 다중 행 일괄 수정 */
  async function updateRowsBatch(monthName, updates) {
    if (!updates || updates.length === 0) return;
    
    if (Object.keys(_sheetMeta).length === 0) {
      await loadSpreadsheetMeta();
    }
    const sheetId = _sheetMeta[monthName];
    if (sheetId === undefined) {
      throw new Error(`[Sheets] 해당 월의 시트를 찾을 수 없음: ${monthName}`);
    }

    const preparedUpdates = updates.map(u => {
      if (u.colIndex !== undefined) {
        const fieldMap = {
          0: 'date',
          1: 'desc',
          2: 'inc',
          3: 'exp',
          5: 'cat',
          6: 'method'
        };
        const fieldName = fieldMap[u.colIndex];
        const upObj = { month: monthName, rowIndex: u.rowIndex };
        upObj[fieldName] = u.value;
        if (fieldName === 'cat' && u.value === '수입') {
          upObj.needsReview = false;
          upObj.bgColor = { red: 1, green: 1, blue: 1 };
        }
        return upObj;
      }
      return { month: monthName, ...u };
    });

    const data = [];
    const formatRequests = [];

    for (const up of preparedUpdates) {
      const row = up.rowIndex;

      if (up.date !== undefined) data.push({ range: `${monthName}!A${row}`, values: [[up.date]] });
      if (up.desc !== undefined) data.push({ range: `${monthName}!B${row}`, values: [[up.desc]] });
      if (up.inc !== undefined) data.push({ range: `${monthName}!C${row}`, values: [[up.inc]] });
      if (up.exp !== undefined) data.push({ range: `${monthName}!D${row}`, values: [[up.exp]] });
      if (up.cat !== undefined) data.push({ range: `${monthName}!F${row}`, values: [[up.cat]] });
      if (up.method !== undefined) data.push({ range: `${monthName}!G${row}`, values: [[up.method]] });

      if (up.bgColor !== undefined || up.needsReview !== undefined) {
        let red = 1, green = 1, blue = 1;
        if (up.bgColor) {
          red = up.bgColor.red ?? 1;
          green = up.bgColor.green ?? 1;
          blue = up.bgColor.blue ?? 1;
        } else if (up.needsReview) {
          red = 1; green = 1; blue = 0;
        }

        formatRequests.push({
          repeatCell: {
            range: {
              sheetId,
              startRowIndex: row - 1,
              endRowIndex: row,
              startColumnIndex: 0,
              endColumnIndex: 1
            },
            cell: {
              userEnteredFormat: {
                backgroundColor: { red, green, blue }
              }
            },
            fields: 'userEnteredFormat.backgroundColor'
          }
        });
      }
    }

    if (data.length > 0) {
      await gapi.client.sheets.spreadsheets.values.batchUpdate({
        spreadsheetId: cfg.SPREADSHEET_ID,
        resource: {
          valueInputOption: 'USER_ENTERED',
          data
        }
      });
    }

    if (formatRequests.length > 0) {
      await gapi.client.sheets.spreadsheets.batchUpdate({
        spreadsheetId: cfg.SPREADSHEET_ID,
        resource: { requests: formatRequests }
      });
    }
  }

  /** 다중 행 일괄 삭제 */
  async function deleteRowsBatch(monthName, rowIndexes) {
    if (!rowIndexes || rowIndexes.length === 0) return;

    if (Object.keys(_sheetMeta).length === 0) {
      await loadSpreadsheetMeta();
    }
    const sheetId = _sheetMeta[monthName];
    if (sheetId === undefined) {
      throw new Error(`[Sheets] 해당 월의 시트를 찾을 수 없음: ${monthName}`);
    }

    // 아래서부터 삭제하여 인덱스가 꼬이지 않도록 역순 정렬
    const sortedRowIndexes = [...rowIndexes].map(Number).filter(n => !isNaN(n)).sort((a, b) => b - a);

    if (sortedRowIndexes.length === 0) return;

    const requests = sortedRowIndexes.map(row => ({
      deleteDimension: {
        range: {
          sheetId,
          dimension: 'ROWS',
          startIndex: row - 1,
          endIndex: row
        }
      }
    }));

    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: cfg.SPREADSHEET_ID,
      resource: { requests }
    });
  }

  /** 검토 완료 (배경색 흰색) */
  async function markReviewed(monthName, rowIndex) {
    const update = {
      month: monthName,
      rowIndex: rowIndex,
      needsReview: false,
      bgColor: { red: 1, green: 1, blue: 1 }
    };
    await updateRowsBatch(monthName, [update]);
  }

  // ─── 고정비 관련 구현 (미래 전파 연산 포함) ───

  /** 고정비 추가 (현재 월부터 12월까지) */
  async function addFixedExpense(startMonthName, data) {
    const months = cfg.MONTH_NAMES;
    const startIndex = months.indexOf(startMonthName);
    if (startIndex === -1) throw new Error(`유효하지 않은 월: ${startMonthName}`);

    const targetMonths = months.slice(startIndex).filter(m => _sheetMeta[m] !== undefined);
    for (const month of targetMonths) {
      await addTransaction(month, { ...data, date: '-' }, true);
    }
  }

  /** 고정비 수정 (현재 월 및 미래 월 일괄 동기화) */
  async function updateFixedExpense(startMonthName, rowIndex, data) {
    const sheetTxs = await loadMonthData(startMonthName);
    const originalTx = sheetTxs.find(t => t.rowIndex === rowIndex);
    if (!originalTx) throw new Error(`수정할 고정비 행을 찾을 수 없음: #${rowIndex}`);
    // 미래 월 매칭 기준: desc(내용)만으로는 동명 항목 오삭제·수입/지출 전도가 발생한다.
    // → 내용 + 분류(cat) + 수입/지출 성격(polarity)을 모두 일치시켜 안전하게 식별한다.
    const oldDesc = (originalTx.desc || '').trim();
    const oldCat = (originalTx.cat || '').trim();
    const oldIsIncome = (Number(originalTx.inc) || 0) > 0;
    const _matchesFixed = (t, month) =>
      t.month === month && t.date === '-' &&
      (t.desc || '').trim() === oldDesc &&
      (t.cat || '').trim() === oldCat &&
      (((Number(t.inc) || 0) > 0) === oldIsIncome);

    // 현재 월 업데이트
    await updateRow(startMonthName, rowIndex, { ...data, date: '-' });

    // 미래 월 스캔 및 업데이트
    const months = cfg.MONTH_NAMES;
    const startIndex = months.indexOf(startMonthName);
    if (startIndex === -1) return;

    const futureMonths = months.slice(startIndex + 1).filter(m => _sheetMeta[m] !== undefined);
    
    // 미래 월 데이터를 비동기로 순회 조회하여 기존 고정비 항목 검색
    const allData = [];
    for (const m of futureMonths) {
      const mData = await loadMonthData(m);
      allData.push(...mData.map(t => ({ ...t, month: m })));
    }

    const updatesByMonth = {};

    for (const month of futureMonths) {
      const target = allData.find(t => _matchesFixed(t, month));
      if (target) {
        const finalInc = (data.cat === '수입' || target.cat === '수입') ? target.inc : data.inc;
        if (!updatesByMonth[month]) updatesByMonth[month] = [];
        updatesByMonth[month].push({
          rowIndex: target.rowIndex,
          desc: data.desc,
          inc: finalInc,
          exp: data.exp || 0,
          cat: data.cat,
          method: data.method,
          needsReview: false,
          bgColor: { red: 1, green: 1, blue: 1 }
        });
      }
    }

    // 각 월별로 일괄 수정 전송
    for (const month of Object.keys(updatesByMonth)) {
      await updateRowsBatch(month, updatesByMonth[month]);
    }
  }

  /** 고정비 삭제 (현재 월 및 미래 월 일괄 삭제) */
  async function deleteFixedExpense(startMonthName, rowIndex) {
    const sheetTxs = await loadMonthData(startMonthName);
    const originalTx = sheetTxs.find(t => t.rowIndex === rowIndex);
    if (!originalTx) throw new Error(`삭제할 고정비 행을 찾을 수 없음: #${rowIndex}`);
    // 동명 항목 오삭제·수입/지출 전도 방지: 내용 + 분류 + 수입/지출 성격을 모두 일치시켜 식별.
    const oldDesc = (originalTx.desc || '').trim();
    const oldCat = (originalTx.cat || '').trim();
    const oldIsIncome = (Number(originalTx.inc) || 0) > 0;
    const _matchesFixed = (t, month) =>
      t.month === month && t.date === '-' &&
      (t.desc || '').trim() === oldDesc &&
      (t.cat || '').trim() === oldCat &&
      (((Number(t.inc) || 0) > 0) === oldIsIncome);

    // 현재 월 삭제
    await deleteRow(startMonthName, rowIndex);

    // 미래 월 스캔 및 일괄 삭제
    const months = cfg.MONTH_NAMES;
    const startIndex = months.indexOf(startMonthName);
    if (startIndex === -1) return;

    const futureMonths = months.slice(startIndex + 1).filter(m => _sheetMeta[m] !== undefined);
    
    const allData = [];
    for (const m of futureMonths) {
      const mData = await loadMonthData(m);
      allData.push(...mData.map(t => ({ ...t, month: m })));
    }

    for (const month of futureMonths) {
      const target = allData.find(t => _matchesFixed(t, month));
      if (target) {
        await deleteRow(month, target.rowIndex);
      }
    }
  }

  async function migrateHistoricalCategories(progressCallback) {
    if (progressCallback) progressCallback('완료', 1, 1);
    return 0;
  }

  // ─── 보유 카드 관리 직접 구글 API 연동 ───
  async function loadCards() {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: cfg.SPREADSHEET_ID,
      range: '보유 카드!A3:G100'
    });
    const rows = response.result.values || [];
    const cards = [];
    rows.forEach((row, i) => {
      if (i === 0) return; // skip header
      const cardName = row[1] || '';
      const owner = row[2] || '';
      const purpose = row[3] || '';
      const minFee = row[4] || '';
      const linkedBank = row[5] || '';
      const linkedAccount = row[6] || '';
      if (!cardName && !owner && !purpose) return;
      cards.push({
        rowIndex: 3 + i,
        cardName,
        owner,
        purpose,
        minFee,
        linkedBank,
        linkedAccount
      });
    });
    return cards;
  }

  async function addCard(data) {
    const values = [
      ['', data.cardName || '', data.owner || '', data.purpose || '', data.minFee || '', data.linkedBank || '', data.linkedAccount || '']
    ];
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: cfg.SPREADSHEET_ID,
      range: '보유 카드!A4',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values }
    });
    return { success: true };
  }

  async function updateCard(rowIndex, data) {
    const values = [
      [data.cardName || '', data.owner || '', data.purpose || '', data.minFee || '', data.linkedBank || '', data.linkedAccount || '']
    ];
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: cfg.SPREADSHEET_ID,
      range: `보유 카드!B${rowIndex}:G${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });
    return { success: true };
  }

  async function deleteCard(rowIndex) {
    if (Object.keys(_sheetMeta).length === 0) {
      await loadSpreadsheetMeta();
    }
    const sheetId = _sheetMeta['보유 카드'];
    if (sheetId === undefined) {
      throw new Error('보유 카드 시트의 ID를 조회할 수 없습니다.');
    }
    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: cfg.SPREADSHEET_ID,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex - 1,
              endIndex: rowIndex
            }
          }
        }]
      }
    });
    return { success: true };
  }

  // ─── 보유 계좌 관리 직접 구글 API 연동 ───
  async function loadAccounts() {
    const response = await gapi.client.sheets.spreadsheets.values.get({
      spreadsheetId: cfg.SPREADSHEET_ID,
      range: '보유 통장/자산!A2:G100'
    });
    const rows = response.result.values || [];
    const accounts = [];
    rows.forEach((row, i) => {
      if (i === 0) return; // skip header
      const type = row[1] || '';
      const owner = row[2] || '';
      const purpose = row[3] || '';
      const accountName = row[4] || '';
      const accountNumber = row[5] || '';
      const ownerName = row[6] || '';
      if (!type && !owner && !accountName) return;
      accounts.push({
        rowIndex: 2 + i,
        type,
        owner,
        purpose,
        accountName,
        accountNumber,
        ownerName
      });
    });
    return accounts;
  }

  async function addAccount(data) {
    const values = [
      ['', data.type || '', data.owner || '', data.purpose || '', data.accountName || '', data.accountNumber || '', data.ownerName || '']
    ];
    await gapi.client.sheets.spreadsheets.values.append({
      spreadsheetId: cfg.SPREADSHEET_ID,
      range: '보유 통장/자산!A3',
      valueInputOption: 'USER_ENTERED',
      insertDataOption: 'INSERT_ROWS',
      resource: { values }
    });
    return { success: true };
  }

  async function updateAccount(rowIndex, data) {
    const values = [
      [data.type || '', data.owner || '', data.purpose || '', data.accountName || '', data.accountNumber || '', data.ownerName || '']
    ];
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: cfg.SPREADSHEET_ID,
      range: `보유 통장/자산!B${rowIndex}:G${rowIndex}`,
      valueInputOption: 'USER_ENTERED',
      resource: { values }
    });
    return { success: true };
  }

  async function deleteAccount(rowIndex) {
    if (Object.keys(_sheetMeta).length === 0) {
      await loadSpreadsheetMeta();
    }
    const sheetId = _sheetMeta['보유 통장/자산'];
    if (sheetId === undefined) {
      throw new Error('보유 통장/자산 시트의 ID를 조회할 수 없습니다.');
    }
    await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: cfg.SPREADSHEET_ID,
      resource: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowIndex - 1,
              endIndex: rowIndex
            }
          }
        }]
      }
    });
    return { success: true };
  }

  function getCategories() { return _categories; }
  function getMethods() { return _methods; }
  function getSheetMeta() { return _sheetMeta; }
  function getColIndices() { return colIndices; }

  // ─── 예산 설정 (구글 시트 '예산설정' 탭에 영구 저장 → 기기 간 동기화) ───
  const BUDGET_SHEET = '예산설정';
  async function _ensureBudgetSheet() {
    if (Object.keys(_sheetMeta).length === 0) await loadSpreadsheetMeta();
    if (_sheetMeta[BUDGET_SHEET] !== undefined) return;
    const addRes = await gapi.client.sheets.spreadsheets.batchUpdate({
      spreadsheetId: cfg.SPREADSHEET_ID,
      resource: { requests: [{ addSheet: { properties: { title: BUDGET_SHEET } } }] },
    });
    const newId = addRes.result.replies?.[0]?.addSheet?.properties?.sheetId;
    if (newId !== undefined) _sheetMeta[BUDGET_SHEET] = newId;
    await gapi.client.sheets.spreadsheets.values.update({
      spreadsheetId: cfg.SPREADSHEET_ID,
      range: `${BUDGET_SHEET}!A1:B1`,
      valueInputOption: 'RAW',
      resource: { values: [['카테고리', '월예산']] },
    });
  }
  async function loadBudgets() {
    try {
      await _ensureBudgetSheet();
      const res = await gapi.client.sheets.spreadsheets.values.get({
        spreadsheetId: cfg.SPREADSHEET_ID,
        range: `${BUDGET_SHEET}!A2:B1000`,
      });
      const rows = res.result.values || [];
      const out = {};
      rows.forEach(r => {
        const cat = (r[0] || '').toString().trim();
        if (!cat) return;
        out[cat] = parseInt(String(r[1] || '0').replace(/[^0-9.-]/g, ''), 10) || 0;
      });
      return out;
    } catch (e) { console.warn('[Sheets] 예산 로드 실패:', e); return {}; }
  }
  async function saveBudgets(budgets) {
    await _ensureBudgetSheet();
    const entries = Object.entries(budgets || {}).filter(([c]) => c && c.trim());
    // 기존 값 전체 비우고 재작성(삭제된 항목 반영)
    await gapi.client.sheets.spreadsheets.values.clear({
      spreadsheetId: cfg.SPREADSHEET_ID,
      range: `${BUDGET_SHEET}!A2:B1000`,
    });
    if (entries.length > 0) {
      await gapi.client.sheets.spreadsheets.values.update({
        spreadsheetId: cfg.SPREADSHEET_ID,
        range: `${BUDGET_SHEET}!A2`,
        valueInputOption: 'RAW',
        resource: { values: entries.map(([cat, amt]) => [cat, amt]) },
      });
    }
    return { success: true };
  }

  return {
    loadBudgets,
    saveBudgets,
    loadSpreadsheetMeta,
    loadMonthData,
    updateCell: async (m, r, c, v) => {
      const up = { rowIndex: r, colIndex: c, value: v };
      await updateRowsBatch(m, [up]);
    },
    updateRow,
    deleteRow,
    updateRowsBatch,
    deleteRowsBatch,
    markReviewed,
    addTransaction,
    addTransactionsBatch,
    normalizeCategory: _normalizeCategory,
    migrateHistoricalCategories,
    getCategories,
    getMethods,
    getSheetMeta,
    getColIndices,
    addFixedExpense,
    updateFixedExpense,
    deleteFixedExpense,
    loadCards,
    addCard,
    updateCard,
    deleteCard,
    loadAccounts,
    addAccount,
    updateAccount,
    deleteAccount,
  };
})();
