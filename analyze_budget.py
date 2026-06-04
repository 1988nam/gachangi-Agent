import json
import os

db_path = os.path.join("data", "transactions.json")

if not os.path.exists(db_path):
    print("Database not found!")
    exit(1)

with open(db_path, "r", encoding="utf-8") as f:
    txs = json.load(f)

# Filter transactions up to May ("1월", "2월", "3월", "4월", "5월")
target_months = ["1월", "2월", "3월", "4월", "5월"]
filtered_txs = [t for t in txs if t.get("month") in target_months]

monthly_exp = {m: 0 for m in target_months}
monthly_inc = {m: 0 for m in target_months}
cat_exp = {}

for t in filtered_txs:
    month = t.get("month")
    # inc and exp values are integers (parsed from string or already ints)
    inc = int(t.get("inc", 0) or 0)
    exp = int(t.get("exp", 0) or 0)
    cat = t.get("cat", "미분류")

    monthly_exp[month] += exp
    monthly_inc[month] += inc
    
    if exp > 0:
        cat_exp[cat] = cat_exp.get(cat, 0) + exp

print("--- 월별 지출 현황 ---")
total_exp = 0
for m in target_months:
    print(f"{m}: 지출 {monthly_exp[m]:,}원 / 수입 {monthly_inc[m]:,}원")
    total_exp += monthly_exp[m]

avg_exp = total_exp / len(target_months)
print(f"\n5개월 총 지출: {total_exp:,}원")
print(f"5개월 평균 월 지출: {avg_exp:,.2f}원")

print("\n--- 카테고리별 누적 지출 순위 ---")
sorted_cats = sorted(cat_exp.items(), key=lambda x: x[1], reverse=True)
for cat, val in sorted_cats:
    percentage = (val / total_exp) * 100 if total_exp > 0 else 0
    print(f"- {cat}: {val:,}원 ({percentage:.1f}%)")
