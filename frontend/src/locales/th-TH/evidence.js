// SPDX-FileCopyrightText: 2026 北京京微资易科技有限公司 and AI WorkDeck contributors
// SPDX-License-Identifier: AGPL-3.0-or-later

export default {
  "view": {
    "bySection": "ตามหัวข้อ",
    "byParty": "ตามคู่สัญญา"
  },
  "filter": {
    "allSections": "ทุกหัวข้อ",
    "allParties": "ทุกคู่สัญญา"
  },
  "stat": {
    "total": "ทั้งหมด {count} รายการ"
  },
  "status": {
    "all": "ทั้งหมด",
    "active": "ปกติ",
    "unverified": "รอตรวจสอบ",
    "stale": "มีการแก้ไข",
    "orphan": "ขาดการเชื่อมโยง"
  },
  "group": {
    "none": "ยังไม่ระบุ",
    "untitled": "(ไม่มีหัวข้อ)"
  },
  "action": {
    "keep": "คงการเชื่อมโยง",
    "rebind": "ระบุใหม่",
    "confirmRebind": "ยืนยัน",
    "cancelRebind": "ยกเลิก",
    "delete": "ลบ",
    "removeTarget": "นำออก",
    "open": "ดูเอกสารอ้างอิง",
    "ignore": "ข้าม",
    "expand": "ขยาย",
    "collapse": "ย่อ"
  },
  "method": {
    "written_review": "ตรวจเอกสาร",
    "written_statement": "คำชี้แจงเป็นลายลักษณ์อักษร",
    "web_check": "ตรวจสอบออนไลน์",
    "third_party": "เอกสารบุคคลที่สาม",
    "interview": "สัมภาษณ์",
    "none": "ไม่ระบุวิธี"
  },
  "relation": {
    "supports": "สนับสนุน",
    "contradicts": "ขัดแย้ง",
    "partial": "สนับสนุนบางส่วน"
  },
  "loc": {
    "wholeFile": "ทั้งไฟล์",
    "page": "หน้า {page}",
    "quote": "“{quote}”",
    "region": "บริเวณในภาพ",
    "time": "{time}",
    "web": "{host}",
    "cell": "{sheet}!{cell}"
  },
  "empty": "ยังไม่มีไฟล์อ้างอิงที่เชื่อมโยงกับเอกสารนี้",
  "emptyHint": "ลากไฟล์จากรายการด้านซ้ายมาวางบนข้อความที่เลือกเพื่อสร้างการเชื่อมโยง",
  "emptyFiltered": "ไม่มีการเชื่อมโยงที่ตรงกับตัวกรองปัจจุบัน",
  "fileMissing": "(ไม่พบไฟล์แล้ว)",
  "fileDeleted": "(อยู่ในถังขยะ)",
  "targetsCount": "เอกสารอ้างอิง {count} รายการ",
  "rebindHint": "เลือกข้อความใหม่ในเอกสาร แล้วแตะยืนยัน",
  "rebindNoSelection": "กรุณาเลือกข้อความในเอกสารก่อน",
  "rebindFailed": "ระบุใหม่ไม่สำเร็จ",
  "rebindRetryHint": "บุ๊กมาร์กใหม่อยู่ในเอกสารแล้ว แตะยืนยันอีกครั้งเพื่อลองใหม่",
  "keepGone": "ข้อความนี้ไม่อยู่ในเอกสารแล้ว จึงไม่สามารถคงการเชื่อมโยงได้ โปรดใช้ \"ระบุใหม่\" ในแท็บเอกสารอ้างอิง",
  "orphanGoto": "จุดยึดของข้อความนี้ไม่อยู่ในเอกสารแล้ว แตะ \"ระบุใหม่\" เพื่อเลือกข้อความใหม่",
  "confidence": "ความเชื่อมั่น {value}",
  "loading": "กำลังโหลด…",
  "loadFailed": "โหลดการเชื่อมโยงไม่สำเร็จ",
  "fileTagsLoadFailed": "โหลดแท็กคู่สัญญาไม่สำเร็จ มุมมอง \"ตามคู่สัญญา\" อาจไม่ถูกต้อง",
  "opFailed": "ดำเนินการไม่สำเร็จ",
  "deleteConfirm": "ลบการเชื่อมโยงนี้หรือไม่? ไฟล์เอกสารอ้างอิงจะไม่ถูกลบ",
  "deleteTargetConfirm": "นำเอกสารอ้างอิงนี้ออกหรือไม่?",
  "staleOne": "ข้อความนี้มีเอกสารอ้างอิง {count} รายการ และเนื้อหาถูกแก้ไขแล้ว",
  "staleMany": "ข้อความที่เชื่อมโยง {count} รายการถูกแก้ไขแล้ว",
  "stalePrefix": "แก้ไขแล้ว: "
}
