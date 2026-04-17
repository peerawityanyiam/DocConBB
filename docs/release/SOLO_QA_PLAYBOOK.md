# Solo QA Playbook (ทำคนเดียวได้)

## เป้าหมาย
- ปิดความเสี่ยงก่อนขึ้น production โดยไม่ต้องรอทีมใหญ่
- จับบัคซ้ำเดิมให้เร็ว: อัปโหลดล้มเหลว, ภาพรวมไม่ตรง, ไฟล์ค้างบน card

## ขั้นตอนใช้งาน (แนะนำตามลำดับ)
1. เตรียมชุดข้อมูลทดสอบคงที่ 7-10 งาน
2. รัน UAT checklist ทีละข้อ
3. เก็บหลักฐานลง evidence log ทุกเคส
4. รันสคริปต์เช็กตัวเลขภาพรวม
5. อัปเดต bug list พร้อมสถานะ `OPEN/VERIFY/CLOSED`

## ไฟล์ที่ต้องใช้
- Checklist: [UAT_CHECKLIST.md](/C:/Project/project 1/hospital-docs/docs/release/UAT_CHECKLIST.md)
- Bug tracker: [GO_LIVE_BUG_LIST.md](/C:/Project/project 1/hospital-docs/docs/release/GO_LIVE_BUG_LIST.md)
- Evidence log: [UAT_EVIDENCE_LOG.md](/C:/Project/project 1/hospital-docs/docs/release/UAT_EVIDENCE_LOG.md)

## คำสั่งช่วยเช็กภาพรวม
```bash
npm run qa:stats
```

ผลที่คาดหวัง:
- แสดงจำนวนรวม
- แสดงแยกแต่ละสถานะ
- แสดงสรุป `pending / waitingApproval / completed / cancelled`
- ถ้าตัวเลขผิดจากหน้าจอ ให้แนบผลนี้ลง bug `B-003`

## กติกา pass/fail สำหรับ go-live
- `P0 = 0`
- `P1 = 0`
- เคสอัปโหลดหลักผ่านบนมือถือจริงอย่างน้อย:
  - Word 1 ไฟล์
  - รูป 10 รูป
  - รูป 20 รูป (ใกล้เพดาน)

