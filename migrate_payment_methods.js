const fs = require('fs');
const path = require('path');

const dbPath = path.join(__dirname, 'data', 'transactions.json');
const backupPath = path.join(__dirname, 'data', 'transactions_backup_payment_methods.json');
const serveBackupPath = path.join(__dirname, 'data', 'transactions_backup.json');

if (!fs.existsSync(dbPath)) {
    console.error(`Database file not found: ${dbPath}`);
    process.exit(1);
}

// 백업 복사
fs.copyFileSync(dbPath, backupPath);
console.log(`Backup created at: ${backupPath}`);

const data = JSON.parse(fs.readFileSync(dbPath, 'utf8'));

let modifiedCount = 0;

data.forEach(tx => {
    const oldMethod = tx.method;
    const desc = tx.desc || '';
    
    let newMethod = oldMethod;
    
    // 1. 정현 카드 / 정현카드 교정
    if (oldMethod === "정현 카드" || oldMethod === "정현카드") {
        if (desc.includes("현대")) {
            newMethod = "현대카드";
        } else if (desc.includes("신한")) {
            newMethod = "신한카드";
        } else if (desc.includes("하나")) {
            newMethod = "하나카드";
        } else if (desc.includes("우리")) {
            newMethod = "우리은행";
        } else if (desc.includes("카카오")) {
            newMethod = "카카오뱅크";
        } else if (desc.includes("혜영")) {
            newMethod = "혜영카드";
        } else {
            newMethod = "하나카드"; // 사용자 지정 폴백
        }
    }
    // 2. 혜영 카드 교정
    else if (oldMethod === "혜영 카드") {
        newMethod = "혜영카드";
    }
    // 3. 은행/현금 or 현금/은행 교정
    else if (oldMethod === "은행/현금" || oldMethod === "현금/은행") {
        if (desc.includes("카카오")) {
            newMethod = "카카오뱅크";
        } else {
            newMethod = "우리은행";
        }
    }
    
    if (oldMethod !== newMethod) {
        tx.method = newMethod;
        modifiedCount++;
    }
});

if (modifiedCount > 0) {
    const updatedJson = JSON.stringify(data);
    fs.writeFileSync(dbPath, updatedJson, 'utf8');
    fs.writeFileSync(serveBackupPath, updatedJson, 'utf8');
    console.log(`Successfully updated ${modifiedCount} transactions.`);
} else {
    console.log("No payment methods need to be migrated.");
}
