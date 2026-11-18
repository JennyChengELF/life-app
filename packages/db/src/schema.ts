/**
 * 試算表結構：每個 APP 一個試算表檔案（file），檔案內每張工作表是一個資料表（table）。
 * 第一列是欄位名稱（英文），APP 依欄位名稱找欄位，所以使用者調整欄位順序也沒關係。
 */

/**
 * 2：喝水紀錄加「drink」、新增飲品清單（2026-11-17）
 * 3：體重表 healthWeights 改名為身體量測 healthBodyMeasurements 並加上身體組成欄位；新增偶爾量測、健康設定（2026-11-17）
 * 4：新增血壓、血糖、體溫（2026-11-17）
 * 5：新增健檢 / 檢驗：報告、檢驗項目、檢驗結果（2026-11-17）
 * 6：新增排便 APP、綜合 APP 的試算表（2026-11-18）
 * 7：新增記帳 APP 的試算表（帳戶、分類、交易、明細）；綜合加人物、機構（2026-11-18）
 */
export const SCHEMA_VERSION = 7;

export type ColType = 'datetime' | 'date' | 'number' | 'text' | 'bool' | 'any';

export interface ColumnDef {
  name: string;
  type: ColType;
  /** 給「說明」工作表看的中文說明 */
  label: string;
}

export type FileKey = 'water' | 'health' | 'bowel' | 'hub' | 'money';

export interface FileDef {
  /** 試算表檔名（不加版本號） */
  title: string;
  description: string;
}

export const FILES: Record<FileKey, FileDef> = {
  water: { title: '生活APP-喝水', description: '喝水 APP 的資料：喝水紀錄、每日目標、常用杯子、設定' },
  health: { title: '生活APP-健康', description: '健康 APP 的資料：身體量測（體重、體脂⋯⋯）、血壓、血糖、體溫、健檢 / 檢驗、偶爾量測（身高、圍度⋯⋯）、設定' },
  bowel: { title: '生活APP-排便', description: '排便 APP 的資料：排便紀錄、設定' },
  hub: { title: '生活APP-綜合', description: '綜合 APP（首頁）的資料：設定、人物、機構（銀行、商店⋯⋯）' },
  money: { title: '生活APP-記帳', description: '記帳 APP 的資料：帳戶、分類、交易（一次付款 / 收款 / 轉帳）、明細（支出、收入、分帳、借款、還款）、設定' },
};

export interface TableDef {
  file: FileKey;
  /** 以前的表名：試算表裡有舊名稱的工作表時，自動改成新名稱（資料保留） */
  formerNames?: string[];
  description: string;
  columns: ColumnDef[];
}

const systemCols: ColumnDef[] = [
  { name: 'id', type: 'text', label: '系統編號（APP 自動填，請勿修改）' },
  { name: 'createdAt', type: 'datetime', label: '建立時間（APP 自動填）' },
  { name: 'updatedAt', type: 'datetime', label: '最後修改時間（APP 自動填）' },
  { name: 'deletedAt', type: 'datetime', label: '刪除時間（有值代表已刪除；APP 自動填）' },
];

export const TABLES = {
  waterLogs: {
    file: 'water',
    description: '喝水紀錄。可以直接在最下方新增一列，只要填 time（時間，例 2026/11/17 14:30）和 ml，其他欄位 APP 會自動補上。',
    columns: [
      { name: 'time', type: 'datetime', label: '喝完的時間（必填）' },
      { name: 'ml', type: 'number', label: '喝了多少 ml（必填）' },
      { name: 'drink', type: 'text', label: '喝什麼（填飲品清單裡的名稱；空白 = 清單第一個，預設是開水）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'date', type: 'date', label: '日期（APP 依 time 自動填）' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（water = 喝水 APP、sheet = 直接在試算表）' },
      ...systemCols,
    ],
  },
  waterDays: {
    file: 'water',
    description: '每天的目標與是否達標（APP 自動維護）。過了當天就鎖定目標，之後體重改變不影響。',
    columns: [
      { name: 'date', type: 'date', label: '日期' },
      { name: 'goal', type: 'number', label: '當天目標 ml' },
      { name: 'total', type: 'number', label: '當天喝水總量 ml' },
      { name: 'achieved', type: 'bool', label: '是否達標' },
      { name: 'weightUsed', type: 'number', label: '計算目標用的體重 kg（空白 = 沒有體重，用預設目標）' },
      { name: 'factor', type: 'number', label: '計算用的係數 ml/kg' },
      { name: 'extraMl', type: 'number', label: '計算用的額外加量 ml' },
      { name: 'rounded', type: 'bool', label: '是否四捨五入到百位' },
      { name: 'locked', type: 'bool', label: '目標是否已鎖定（過了當天）' },
      ...systemCols,
    ],
  },
  waterCups: {
    file: 'water',
    description: '常用杯子，點一下就記一杯。',
    columns: [
      { name: 'name', type: 'text', label: '名稱（例：保溫瓶）' },
      { name: 'ml', type: 'number', label: '容量 ml' },
      { name: 'sort', type: 'number', label: '排序' },
      ...systemCols,
    ],
  },
  waterDrinks: {
    file: 'water',
    description: '飲品清單（記錄時選喝什麼）。第一個是預設飲品。目前所有飲品都算 100% 喝水量。請在 APP 裡修改。',
    columns: [
      { name: 'name', type: 'text', label: '名稱（例：開水、茶）' },
      { name: 'sort', type: 'number', label: '排序（最小的是預設飲品）' },
      ...systemCols,
    ],
  },
  waterSettings: {
    file: 'water',
    description: '喝水 APP 的設定，請在 APP 裡修改。',
    columns: [
      { name: 'key', type: 'text', label: '設定名稱' },
      { name: 'value', type: 'any', label: '設定值' },
    ],
  },
  healthBodyMeasurements: {
    file: 'health',
    formerNames: ['healthWeights'],
    description: '身體量測（體重計量的，一次量測一列）。可以直接在最下方新增一列，只要填 time 和 kg，其他欄位有量才填。',
    columns: [
      { name: 'time', type: 'datetime', label: '量的時間（必填）' },
      { name: 'kg', type: 'number', label: '體重 kg（必填）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'date', type: 'date', label: '日期（APP 依 time 自動填）' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（water、health、sheet）' },
      ...systemCols,
      { name: 'bodyFatPct', type: 'number', label: '體脂肪 %' },
      { name: 'bodyFatKg', type: 'number', label: '體脂肪 kg' },
      { name: 'visceralFatLevel', type: 'number', label: '內臟脂肪程度（等級，沒有單位）' },
      { name: 'bmiScale', type: 'number', label: '體重計顯示的 BMI（APP 另外用身高自動算，不寫進試算表）' },
      { name: 'bmiOk', type: 'bool', label: '體重計 BMI 和自動算的不同時，已確認不用改（TRUE）' },
      { name: 'bodyFatOk', type: 'bool', label: '體重 × 體脂肪 % 和體脂肪 kg 不同時，已確認不用改（TRUE）' },
      { name: 'skeletalMuscleOk', type: 'bool', label: '體重 × 骨骼肌 % 和骨骼肌 kg 不同時，已確認不用改（TRUE）' },
      { name: 'skeletalMusclePct', type: 'number', label: '骨骼肌 %' },
      { name: 'skeletalMuscleKg', type: 'number', label: '骨骼肌 kg' },
      { name: 'muscleKg', type: 'number', label: '肌肉量 kg' },
      { name: 'bodyAge', type: 'number', label: '身體年齡' },
      { name: 'bmrKcal', type: 'number', label: '基礎代謝 kcal' },
      { name: 'personId', type: 'text', label: '是誰的資料（空白 = 我自己）' },
    ],
  },
  healthOccasionalItems: {
    file: 'health',
    description: '偶爾量測的項目清單（身高、各部位圍度⋯⋯）。請在 APP 裡新增或修改。',
    columns: [
      { name: 'name', type: 'text', label: '項目名稱（例：腰圍）' },
      { name: 'unit', type: 'text', label: '單位（例：cm）' },
      { name: 'sort', type: 'number', label: '排序' },
      { name: 'code', type: 'text', label: 'APP 內建項目的代號（height = 身高，用來算 BMI；請勿修改）' },
      ...systemCols,
    ],
  },
  healthOccasionalMeasurements: {
    file: 'health',
    description: '偶爾量測的紀錄，一個項目一列。可以直接在最下方新增一列，填 time、item（項目清單裡的名稱）、value。',
    columns: [
      { name: 'time', type: 'datetime', label: '量的時間（必填）' },
      { name: 'item', type: 'text', label: '項目（填項目清單裡的名稱，必填）' },
      { name: 'value', type: 'number', label: '數值（必填）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'date', type: 'date', label: '日期（APP 依 time 自動填）' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（health、sheet）' },
      { name: 'personId', type: 'text', label: '是誰的資料（空白 = 我自己）' },
      ...systemCols,
    ],
  },
  healthBloodPressure: {
    file: 'health',
    description: '血壓紀錄，量一次一列。可以直接在最下方新增一列，填 time、systolic、diastolic。',
    columns: [
      { name: 'time', type: 'datetime', label: '量的時間（必填）' },
      { name: 'systolic', type: 'number', label: '收縮壓（高）mmHg（必填）' },
      { name: 'diastolic', type: 'number', label: '舒張壓（低）mmHg（必填）' },
      { name: 'pulse', type: 'number', label: '脈搏 次/分' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'date', type: 'date', label: '日期（APP 依 time 自動填）' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（health、sheet）' },
      { name: 'personId', type: 'text', label: '是誰的資料（空白 = 我自己）' },
      ...systemCols,
    ],
  },
  healthBloodGlucose: {
    file: 'health',
    description: '血糖紀錄，量一次一列。可以直接在最下方新增一列，填 time、timing、mgdl。',
    columns: [
      { name: 'time', type: 'datetime', label: '量的時間（必填）' },
      { name: 'timing', type: 'text', label: '測量時機（空腹、飯前、飯後2小時、睡前、隨機，必填）' },
      { name: 'mgdl', type: 'number', label: '血糖 mg/dL（必填）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'date', type: 'date', label: '日期（APP 依 time 自動填）' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（health、sheet）' },
      { name: 'personId', type: 'text', label: '是誰的資料（空白 = 我自己）' },
      ...systemCols,
    ],
  },
  healthTemperature: {
    file: 'health',
    description: '體溫紀錄，量一次一列。可以直接在最下方新增一列，填 time、kind、site、celsius。',
    columns: [
      { name: 'time', type: 'datetime', label: '量的時間（必填）' },
      { name: 'kind', type: 'text', label: '種類（一般、基礎，必填）' },
      { name: 'site', type: 'text', label: '部位（耳溫、額溫、口溫、腋溫；空白 = 不知道）' },
      { name: 'celsius', type: 'number', label: '體溫 °C（必填）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'date', type: 'date', label: '日期（APP 依 time 自動填）' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（health、sheet）' },
      { name: 'personId', type: 'text', label: '是誰的資料（空白 = 我自己）' },
      ...systemCols,
    ],
  },
  healthLabReports: {
    file: 'health',
    description: '健檢 / 檢驗報告，一次檢驗一列；結果在 healthLabResults。建議在 APP 裡新增。',
    columns: [
      { name: 'date', type: 'date', label: '檢驗日期（必填）' },
      { name: 'kind', type: 'text', label: '種類（健檢、門診檢驗、其他）' },
      { name: 'place', type: 'text', label: '醫院 / 診所' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（health、sheet）' },
      { name: 'personId', type: 'text', label: '是誰的資料（空白 = 我自己）' },
      ...systemCols,
    ],
  },
  healthLabItems: {
    file: 'health',
    description: '檢驗項目清單（單位、預設正常範圍）。請在 APP 裡新增或修改。',
    columns: [
      { name: 'name', type: 'text', label: '項目名稱（例：總膽固醇）' },
      { name: 'unit', type: 'text', label: '單位' },
      { name: 'type', type: 'text', label: '數字 或 文字（文字 = 選項，例：尿蛋白 −、±、+）' },
      { name: 'refLow', type: 'number', label: '預設正常範圍下限（報告沒印範圍時用）' },
      { name: 'refHigh', type: 'number', label: '預設正常範圍上限' },
      { name: 'redLow', type: 'number', label: '低於這個算明顯異常（紅色）' },
      { name: 'redHigh', type: 'number', label: '高於或等於這個算明顯異常（紅色）' },
      { name: 'options', type: 'text', label: '文字項目的選項（用逗號分開）' },
      { name: 'warnOptions', type: 'text', label: '算「注意」的選項（黃色）' },
      { name: 'badOptions', type: 'text', label: '算「異常」的選項（紅色）' },
      { name: 'sort', type: 'number', label: '排序' },
      { name: 'code', type: 'text', label: 'APP 內建項目的代號（hba1c = 糖化血色素，血糖頁會顯示；請勿修改）' },
      ...systemCols,
    ],
  },
  healthLabResults: {
    file: 'health',
    description: '檢驗結果，一個項目一列；reportId 對到 healthLabReports 的 id。建議在 APP 裡新增。',
    columns: [
      { name: 'reportId', type: 'text', label: '哪一份報告（healthLabReports 的 id，必填）' },
      { name: 'item', type: 'text', label: '項目（填檢驗項目清單裡的名稱，必填）' },
      { name: 'value', type: 'number', label: '數值（數字項目）' },
      { name: 'text', type: 'text', label: '結果文字（文字項目，例：±）' },
      { name: 'refLow', type: 'number', label: '報告上印的正常範圍下限（沒印就空白）' },
      { name: 'refHigh', type: 'number', label: '報告上印的正常範圍上限' },
      { name: 'date', type: 'date', label: '檢驗日期（和報告不同天才填，空白 = 報告的日期）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（health、sheet）' },
      { name: 'personId', type: 'text', label: '是誰的資料（空白 = 我自己）' },
      ...systemCols,
    ],
  },
  healthSettings: {
    file: 'health',
    description: '健康 APP 的設定，請在 APP 裡修改。',
    columns: [
      { name: 'key', type: 'text', label: '設定名稱' },
      { name: 'value', type: 'any', label: '設定值' },
    ],
  },
  bowelLogs: {
    file: 'bowel',
    description:
      '排便紀錄，一次一列。可以直接在最下方新增一列，只要填 time，其他都選填。選項請照欄位說明填中文；可以選好幾個的用「、」分開（例：1、4）。空白 = 沒填。',
    columns: [
      { name: 'time', type: 'datetime', label: '時間（必填）' },
      { name: 'passed', type: 'bool', label: '有沒有排出（FALSE = 有便意但沒排出，不算次數；空白 = 有排出）' },
      { name: 'types', type: 'text', label: '型態（布里斯托 1–7、未觀察；可以填好幾個，例：1、4）' },
      { name: 'amount', type: 'text', label: '量（極少、少量、普通、普通偏多、大量）' },
      { name: 'color', type: 'text', label: '顏色（黃色、黃褐色、褐色、深褐色、綠色、黑色、紅色、灰白色、未觀察）' },
      { name: 'afterFeeling', type: 'text', label: '排便後感受（排乾淨、排不乾淨、仍有便意）' },
      { name: 'ease', type: 'text', label: '順暢度（順暢、稍微用力、非常用力）' },
      { name: 'urgency', type: 'text', label: '急迫程度（無、稍急、非常急、來不及）' },
      { name: 'duration', type: 'text', label: '花多久（5分鐘內、5～10分鐘、10～20分鐘、20分鐘以上）' },
      { name: 'smellLevel', type: 'text', label: '氣味強度（很淡、普通、較臭、非常臭、未觀察）' },
      { name: 'smellType', type: 'text', label: '特殊氣味（甜味、酸味、腐敗味、其他、無特殊氣味、未觀察）' },
      { name: 'symptoms', type: 'text', label: '症狀（可以填好幾個，用「、」分開；選項見 APP）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'date', type: 'date', label: '日期（APP 依 time 自動填）' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（bowel = 排便 APP、hub = 綜合首頁、sheet = 直接在試算表）' },
      ...systemCols,
    ],
  },
  hubPeople: {
    file: 'hub',
    description: '人物（和我相關的人）。分帳、借款會用到。可以直接新增一列，只要填 name。改名請在 APP 裡改（用到的紀錄會一起改）。',
    columns: [
      { name: 'name', type: 'text', label: '名稱（必填，不可重複）' },
      { name: 'isSelf', type: 'bool', label: '是不是我自己（TRUE；全部只有一筆）' },
      { name: 'sort', type: 'number', label: '排序' },
      { name: 'archived', type: 'bool', label: '停用（TRUE = 選單不再出現，舊紀錄保留）' },
      { name: 'note', type: 'text', label: '備註' },
      ...systemCols,
    ],
  },
  hubOrganizations: {
    file: 'hub',
    description: '機構（銀行、證券商、電子支付、商店、醫院⋯⋯）。記帳的帳戶掛在機構底下。可以直接新增一列，只要填 name。',
    columns: [
      { name: 'name', type: 'text', label: '名稱（必填，不可重複；例：永豐銀行）' },
      { name: 'kind', type: 'text', label: '類別（例：銀行、證券、電子支付、商店、醫院）' },
      { name: 'sort', type: 'number', label: '排序' },
      { name: 'archived', type: 'bool', label: '停用（TRUE）' },
      { name: 'note', type: 'text', label: '備註' },
      ...systemCols,
    ],
  },
  moneyAccounts: {
    file: 'money',
    description: '帳戶（錢放在哪裡）。一個帳戶一種幣別。建議在 APP 裡新增；改名請在 APP 裡改（用到的紀錄會一起改）。',
    columns: [
      { name: 'name', type: 'text', label: '帳戶名稱（必填，不可重複；例：大戶 台幣活存）' },
      { name: 'type', type: 'text', label: '類型（現金、銀行、定存、信用卡、電子支付、儲值卡、禮券，必填）' },
      { name: 'currency', type: 'text', label: '幣別（TWD、USD、JPY⋯⋯；空白 = TWD）' },
      { name: 'org', type: 'text', label: '屬於哪個機構（填機構名稱，例：永豐銀行；現金可空白）' },
      { name: 'openingDate', type: 'date', label: '期初餘額是哪一天的（那天結束時的餘額；空白 = 不顯示餘額）' },
      { name: 'openingBalance', type: 'number', label: '那天的餘額（信用卡填那天的未繳金額，正數 = 欠款）' },
      { name: 'closingDay', type: 'number', label: '信用卡結帳日（1–31）' },
      { name: 'dueDay', type: 'number', label: '信用卡繳款日（1–31）' },
      { name: 'expiryDate', type: 'date', label: '禮券 / 儲值卡到期日（選填）' },
      { name: 'monthlyCheck', type: 'bool', label: '每月要不要盤點（空白 = 要；FALSE = 不用）' },
      { name: 'archived', type: 'bool', label: '停用（TRUE = 記帳時不出現，舊紀錄保留）' },
      { name: 'sort', type: 'number', label: '排序' },
      { name: 'note', type: 'text', label: '備註' },
      ...systemCols,
    ],
  },
  moneyCategories: {
    file: 'money',
    description: '分類。最多三層，用「 / 」分開（例：食 / 三餐 / 早餐）。可以直接新增一列，填 path、kind。',
    columns: [
      { name: 'path', type: 'text', label: '分類（必填；例：食 / 三餐 / 早餐，可只有一、兩層）' },
      { name: 'kind', type: 'text', label: '支出 或 收入（必填）' },
      { name: 'isInvest', type: 'bool', label: '投資類（TRUE = 不算進實際收支）' },
      { name: 'defaultBudget', type: 'text', label: '預設扣哪個預算（預算名稱；預算功能之後做）' },
      { name: 'systemKey', type: 'text', label: '系統分類代碼（投資連動用；請勿修改）' },
      { name: 'archived', type: 'bool', label: '停用（TRUE）' },
      { name: 'sort', type: 'number', label: '排序' },
      ...systemCols,
    ],
  },
  moneyTransactions: {
    file: 'money',
    description:
      '交易：一次付款、收款或轉帳（和帳單比對的單位）。分類、分帳等在明細 moneyLines（transaction 欄填這裡的 id）。金額一律正數，出 / 入看 direction。建議在 APP 裡新增。',
    columns: [
      { name: 'time', type: 'datetime', label: '消費 / 發生時間（必填）' },
      { name: 'direction', type: 'text', label: '出（錢從帳戶出去）、入（錢進帳戶）、轉帳；沒帳戶（朋友先幫我付、不用還了）時空白' },
      { name: 'account', type: 'text', label: '帳戶名稱（轉帳時是轉出的帳戶）' },
      { name: 'amount', type: 'number', label: '金額（帳戶幣別，一律正數）' },
      { name: 'paidBy', type: 'text', label: '朋友先幫我付時，填人物名稱' },
      { name: 'currency', type: 'text', label: '幣別：只有沒帳戶時才填（有帳戶時看帳戶的幣別）；空白 = TWD' },
      { name: 'toAccount', type: 'text', label: '轉帳：轉入的帳戶' },
      { name: 'toAmount', type: 'number', label: '轉帳：轉入帳戶收到多少（換錢時填外幣金額；空白 = 和金額相同）' },
      { name: 'store', type: 'text', label: '店家' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'tags', type: 'text', label: '標籤（多個用「、」分開）' },
      { name: 'date', type: 'date', label: '日期（APP 依 time 自動填）' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（money = 記帳 APP、sheet = 直接在試算表）' },
      ...systemCols,
    ],
  },
  moneyLines: {
    file: 'money',
    description:
      '明細：交易底下的一筆（支出、收入、他欠我、我欠他、他還我、我還他、調整）。金額一律正數。統計、預算看這裡。建議在 APP 裡新增。',
    columns: [
      { name: 'transaction', type: 'text', label: '屬於哪筆交易（moneyTransactions 的 id，必填）' },
      { name: 'kind', type: 'text', label: '支出、收入、他欠我、我欠他、他還我、我還他、調整（必填）' },
      { name: 'amount', type: 'number', label: '金額（一律正數，必填）' },
      { name: 'category', type: 'text', label: '分類（支出、收入必填；填分類的 path）' },
      { name: 'person', type: 'text', label: '人物名稱（他欠我、我欠他、他還我、我還他必填）' },
      { name: 'debtType', type: 'text', label: '他欠我 / 我欠他時：分帳 或 借款' },
      { name: 'budget', type: 'text', label: '扣 / 放進哪個預算（預算功能之後做）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'sort', type: 'number', label: '同一筆交易內的順序' },
      ...systemCols,
    ],
  },
  moneySettings: {
    file: 'money',
    description: '記帳 APP 的設定，請在 APP 裡修改。',
    columns: [
      { name: 'key', type: 'text', label: '設定名稱' },
      { name: 'value', type: 'any', label: '設定值' },
    ],
  },
  hubSettings: {
    file: 'hub',
    description: '綜合 APP（首頁）的設定，請在 APP 裡修改。',
    columns: [
      { name: 'key', type: 'text', label: '設定名稱' },
      { name: 'value', type: 'any', label: '設定值' },
    ],
  },
  bowelSettings: {
    file: 'bowel',
    description: '排便 APP 的設定，請在 APP 裡修改。',
    columns: [
      { name: 'key', type: 'text', label: '設定名稱' },
      { name: 'value', type: 'any', label: '設定值' },
    ],
  },
} satisfies Record<string, TableDef>;

export type TableName = keyof typeof TABLES;

export const TABLE_NAMES = Object.keys(TABLES) as TableName[];

export function tablesOfFile(file: FileKey): TableName[] {
  return TABLE_NAMES.filter((t) => TABLES[t].file === file);
}

export function columnType(table: TableName, col: string): ColType | undefined {
  return (TABLES[table].columns as ColumnDef[]).find((c) => c.name === col)?.type;
}
