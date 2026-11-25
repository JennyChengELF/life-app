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
 * 8：交易加分店、帳單名稱；帳戶加國外交易手續費率；機構加國外（2026-11-18）
 * 9：新增預算、預算分配；交易加快速輸入的分類、預算（2026-11-18）
 * 10：新增定存單；帳戶加卡號 / 帳號後幾碼（2026-11-18）
 * 11：新增帳單、帳單明細、盤點；交易加入帳日、繳哪一期（2026-11-18）
 * 12：新增行事曆 APP（群組、行程、設定）（2026-11-20）
 * 13：新增生理期 APP、健康共用身體狀況（2026-11-20）
 * 14：身體量測增加時段分類（起床後、日間、睡前）（2026-11-21）
 * 15：血糖增加餐別（早餐、午餐、晚餐、其他）（2026-11-22）
 * 16：共用人物增加選填姓名（2026-11-25）
 */
export const SCHEMA_VERSION = 16;

export type ColType = 'datetime' | 'date' | 'number' | 'text' | 'bool' | 'any';

export interface ColumnDef {
  name: string;
  type: ColType;
  /** 給「說明」工作表看的中文說明 */
  label: string;
}

export type FileKey = 'water' | 'health' | 'bowel' | 'hub' | 'money' | 'calendar' | 'period';

export interface FileDef {
  /** 試算表檔名（不加版本號） */
  title: string;
  /** APP 改名以前使用的檔名；只用來找回及一次性改名，不影響使用者自行取的名稱 */
  formerTitles?: string[];
  description: string;
}

export const FILES: Record<FileKey, FileDef> = {
  water: { title: '生活APP-喝水', description: '喝水 APP 的資料：喝水紀錄、每日目標、常用杯子、設定' },
  health: { title: '生活APP-健康', description: '健康 APP 的資料：身體量測（體重、體脂⋯⋯）、血壓、血糖、體溫、健檢 / 檢驗、偶爾量測（身高、圍度⋯⋯）、設定' },
  bowel: {
    title: '生活APP-廁所大事',
    formerTitles: ['生活APP-排便'],
    description: '「廁所大事」APP 的資料：排便紀錄、設定',
  },
  hub: { title: '生活APP-綜合', description: '綜合 APP（首頁）的資料：設定、人物、機構（銀行、商店⋯⋯）' },
  money: { title: '生活APP-記帳', description: '記帳 APP 的資料：帳戶、分類、交易（一次付款 / 收款 / 轉帳）、明細（支出、收入、他欠我 / 我欠他、還款）、設定' },
  calendar: { title: '生活APP-行事曆', description: '行事曆 APP 的資料：群組、行程（含旅遊主行程與細項）、設定' },
  period: { title: '生活APP-生理期', description: '生理期 APP 的資料：經期起訖、每日出血、預測與提醒設定' },
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
      { name: 'timing', type: 'text', label: '量測時段：起床後、日間、睡前（空白時 APP 自動設為起床後）' },
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
      { name: 'meal', type: 'text', label: '餐別（早餐、午餐、晚餐、其他；只有飯前／飯後2小時使用）' },
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
  healthConditionItems: {
    file: 'health',
    description: '共用身體狀況清單。生理期 APP 第一版可管理 showInPeriod；同名項目只保留一筆。',
    columns: [
      { name: 'name', type: 'text', label: '症狀名稱（必填、不可重複）' },
      { name: 'showInHealth', type: 'bool', label: '是否顯示於健康 APP' },
      { name: 'showInPeriod', type: 'bool', label: '是否顯示於生理期 APP' },
      { name: 'showInBowel', type: 'bool', label: '是否顯示於廁所大事 APP' },
      { name: 'sort', type: 'number', label: '排序' },
      { name: 'archived', type: 'bool', label: '停用（TRUE；歷史紀錄仍保留）' },
      ...systemCols,
    ],
  },
  healthConditionLogs: {
    file: 'health',
    description: '共用身體狀況，一個症狀一列。直接補資料時填 date、symptom，其他可留白。',
    columns: [
      { name: 'time', type: 'datetime', label: '發生時間（選填）' },
      { name: 'date', type: 'date', label: '日期（必填）' },
      { name: 'symptom', type: 'text', label: '症狀名稱（必填，需存在 healthConditionItems）' },
      { name: 'severity', type: 'text', label: '程度（輕微、中等、嚴重；選填）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'personId', type: 'text', label: '是誰的資料（第一版空白 = 我自己）' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（period、health、sheet）' },
      ...systemCols,
    ],
  },
  periodCycles: {
    file: 'period',
    description: '一次經期一列。補已結束的舊資料只需填 startDate、endDate；一列代表一次經期。',
    columns: [
      { name: 'startDate', type: 'date', label: '開始日（必填，YYYY-MM-DD）' },
      { name: 'endDate', type: 'date', label: '最後一天（進行中的最新一次可留白）' },
      { name: 'excludeFromPrediction', type: 'bool', label: '不納入預測（TRUE；空白 = FALSE）' },
      { name: 'note', type: 'text', label: '整次經期備註' },
      ...systemCols,
    ],
  },
  periodDays: {
    file: 'period',
    description: '每日出血，有資料才存；正式經期外也可記錄，不會自動改變經期起訖。每個日期最多一列。',
    columns: [
      { name: 'date', type: 'date', label: '日期（必填，YYYY-MM-DD）' },
      { name: 'flow', type: 'text', label: '量（點狀、極少、少量、普通、偏多、大量）' },
      { name: 'colors', type: 'text', label: '血色（可複選：粉紅、鮮紅、暗紅、褐色、深褐／近黑、其他；用「、」分隔）' },
      { name: 'clotSize', type: 'text', label: '最大血塊（無、小於1 cm、1～2.4 cm、2.5 cm以上、未觀察）' },
      { name: 'note', type: 'text', label: '當日備註' },
      ...systemCols,
    ],
  },
  periodSettings: {
    file: 'period',
    description: '生理期 APP 的預測與提醒設定，請在 APP 裡修改。',
    columns: [
      { name: 'key', type: 'text', label: '設定名稱' },
      { name: 'value', type: 'any', label: '設定值' },
    ],
  },
  bowelLogs: {
    file: 'bowel',
    description:
      '如廁紀錄，一次一列。可以直接在最下方新增一列，只要填 time；有排出就填 types，沒填 types 代表沒排出。選項請照欄位說明填中文；可以選好幾個的用「、」分開（例：1、4）。',
    columns: [
      { name: 'time', type: 'datetime', label: '時間（必填）' },
      { name: 'passed', type: 'bool', label: 'APP 依 types 自動填：有選型態 = TRUE，沒選 = FALSE（請勿手動修改）' },
      { name: 'types', type: 'text', label: '型態（布里斯托 1–7、未觀察；可複選；空白 = 沒排出）' },
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
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（bowel = 廁所大事 APP、hub = 綜合首頁、sheet = 直接在試算表）' },
      ...systemCols,
    ],
  },
  hubPeople: {
    file: 'hub',
    description: '共用人物，供行事曆、分帳與借款使用。直接新增時只要填 name（暱稱）。請在 APP 裡改暱稱，讓用到的紀錄一起更新。',
    columns: [
      { name: 'name', type: 'text', label: '暱稱（必填，不可重複）' },
      { name: 'isSelf', type: 'bool', label: '是不是我自己（TRUE；全部只有一筆）' },
      { name: 'sort', type: 'number', label: '排序' },
      { name: 'archived', type: 'bool', label: '停用（TRUE = 選單不再出現，舊紀錄保留）' },
      { name: 'note', type: 'text', label: '備註' },
      ...systemCols,
      { name: 'fullName', type: 'text', label: '姓名（選填）' },
    ],
  },
  hubOrganizations: {
    file: 'hub',
    description: '機構（銀行、證券商、電子支付、商店、醫院⋯⋯）。記帳的帳戶掛在機構底下。可以直接新增一列，只要填 name。',
    columns: [
      { name: 'name', type: 'text', label: '名稱（必填，不可重複；例：永豐銀行）' },
      { name: 'kind', type: 'text', label: '類別（商店、餐飲、銀行、證券、保險、電子支付、醫療、公司、政府、其他）' },
      { name: 'foreign', type: 'bool', label: '國外的店家 / 機構（TRUE；刷卡時自動勾國外交易手續費）' },
      { name: 'sort', type: 'number', label: '排序' },
      { name: 'archived', type: 'bool', label: '停用（TRUE）' },
      { name: 'note', type: 'text', label: '備註' },
      ...systemCols,
    ],
  },
  calendarGroups: {
    file: 'calendar',
    description: '行事曆群組。第一次使用會建立「一般」；已有行程的群組只停用，不永久刪除。',
    columns: [
      { name: 'name', type: 'text', label: '群組名稱（必填）' },
      { name: 'color', type: 'text', label: '顏色（CSS 色碼，例 #1f6fd1）' },
      { name: 'kind', type: 'text', label: 'user = 自訂群組；system = 其他 APP 的系統群組' },
      { name: 'sourceType', type: 'text', label: '系統群組來源；自訂群組空白' },
      { name: 'sort', type: 'number', label: '排序' },
      { name: 'hidden', type: 'bool', label: '暫時隱藏（TRUE）' },
      { name: 'archived', type: 'bool', label: '停用（TRUE；舊行程保留）' },
      ...systemCols,
    ],
  },
  calendarEvents: {
    file: 'calendar',
    description: '行程；待辦不放這裡。title 可空白，APP 畫面會顯示「未命名行程」並提醒補上。日期請填 YYYY-MM-DD，時間請填 HH:mm。',
    columns: [
      { name: 'title', type: 'text', label: '標題（可先空白；APP 顯示「未命名行程」並提醒補上）' },
      { name: 'groupId', type: 'text', label: '主要群組 id（APP 自動帶入預設群組）' },
      { name: 'parentEventId', type: 'text', label: '所屬主行程 id；一般行程 / 主行程空白' },
      { name: 'timeType', type: 'text', label: 'range（時段）/ point（時間點）/ allDay（全天）' },
      { name: 'startDate', type: 'date', label: '開始日期（必填）' },
      { name: 'startTime', type: 'text', label: '開始時間 HH:mm；全天空白' },
      { name: 'startTimeZone', type: 'text', label: '開始時區（IANA，例 Asia/Taipei）' },
      { name: 'startUtcOffset', type: 'text', label: '開始時間儲存時的 UTC 位移（例 +08:00；用來保留過去實際時刻）' },
      { name: 'startDisambiguation', type: 'text', label: '日光節約重複時刻：earlier（第一次）/ later（第二次）' },
      { name: 'endDate', type: 'date', label: '結束日期；全天包含這一天' },
      { name: 'endTime', type: 'text', label: '結束時間 HH:mm；時間點 / 全天空白' },
      { name: 'endTimeZone', type: 'text', label: '結束時區（IANA）' },
      { name: 'endUtcOffset', type: 'text', label: '結束時間儲存時的 UTC 位移' },
      { name: 'endDisambiguation', type: 'text', label: '結束時間為重複時刻時選第一次 / 第二次' },
      { name: 'timeMode', type: 'text', label: 'fixedZone（固定時區）/ floatingLocal（跟著所在地）' },
      { name: 'timeZoneInferred', type: 'bool', label: '舊資料缺少時區、由主要時區推定（TRUE）' },
      { name: 'peopleIds', type: 'text', label: '共用人物 id（多個用逗號）' },
      { name: 'tagIds', type: 'text', label: '共用標籤 id（第二輪；多個用逗號）' },
      { name: 'locationType', type: 'text', label: 'place（地點）/ route（起訖）/ online（線上）' },
      { name: 'startPlace', type: 'text', label: '地點或起點' },
      { name: 'endPlace', type: 'text', label: '終點（交通行程）' },
      { name: 'url', type: 'text', label: '線上會議或相關網址' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'status', type: 'text', label: 'scheduled（正常）/ cancelled（已取消）' },
      { name: 'recurrence', type: 'text', label: '重複規則' },
      { name: 'recurrenceParentId', type: 'text', label: '重複行程原規則 id' },
      { name: 'recurrenceInstanceKey', type: 'text', label: '重複行程原發生日期 / 實例鍵' },
      { name: 'exceptions', type: 'text', label: '重複行程略過的發生日期' },
      { name: 'reminders', type: 'text', label: '行程提醒設定 JSON' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（calendar、sheet）' },
      ...systemCols,
    ],
  },
  calendarSettings: {
    file: 'calendar',
    description: '行事曆 APP 的設定，請在 APP 裡修改。',
    columns: [
      { name: 'key', type: 'text', label: '設定名稱' },
      { name: 'value', type: 'any', label: '設定值' },
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
      { name: 'last4', type: 'text', label: '卡號 / 帳號後幾碼（選填，例：5009）' },
      { name: 'openingDate', type: 'date', label: '期初餘額是哪一天的（那天結束時的餘額；空白 = 不顯示餘額）' },
      { name: 'openingBalance', type: 'number', label: '那天的餘額（信用卡填那天的未繳金額，正數 = 欠款）' },
      { name: 'closingDay', type: 'number', label: '信用卡結帳日（1–31）' },
      { name: 'dueDay', type: 'number', label: '信用卡繳款日（1–31）' },
      { name: 'fxFeeRate', type: 'number', label: '信用卡國外交易手續費率 %（例 1.5；空白 = 1.5）' },
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
      { name: 'amount', type: 'number', label: '金額（帳戶幣別；一般支出／收入可填 0，轉帳／借還款須大於 0）' },
      { name: 'paidBy', type: 'text', label: '朋友先幫我付時，填人物名稱' },
      { name: 'currency', type: 'text', label: '幣別：只有沒帳戶時才填（有帳戶時看帳戶的幣別）；空白 = TWD' },
      { name: 'toAccount', type: 'text', label: '轉帳：轉入的帳戶' },
      { name: 'toAmount', type: 'number', label: '轉帳：轉入帳戶收到多少（換錢時填外幣金額；空白 = 和金額相同）' },
      { name: 'store', type: 'text', label: '店家 / 對象（填機構名稱；不在機構清單裡的會自動加進去）' },
      { name: 'branch', type: 'text', label: '分店（選填）' },
      { name: 'statementText', type: 'text', label: '帳單名稱（帳單上印的文字，對帳用）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'tags', type: 'text', label: '標籤（多個用「、」分開）' },
      { name: 'category', type: 'text', label: '快速輸入：在試算表直接記帳時填分類（例：樂 / 數位內容），APP 打開時自動建立明細，這格會清空' },
      { name: 'budget', type: 'text', label: '快速輸入：預算（和 category 一起用）' },
      { name: 'date', type: 'date', label: '日期（APP 依 time 自動填）' },
      { name: 'createdVia', type: 'text', label: '在哪裡輸入（money = 記帳 APP、sheet = 直接在試算表）' },
      ...systemCols,
      { name: 'postedDate', type: 'date', label: '入帳日（對帳時 APP 自動填）' },
      { name: 'statement', type: 'text', label: '繳卡費的轉帳：繳哪一期帳單（moneyStatements 的 id；APP 自動填）' },
    ],
  },
  moneyLines: {
    file: 'money',
    description:
      '明細：交易底下的一筆（支出、收入、他欠我、我欠他、他還我、我還他、調整）。金額一律正數。統計、預算看這裡。建議在 APP 裡新增。',
    columns: [
      { name: 'transaction', type: 'text', label: '屬於哪筆交易（moneyTransactions 的 id，必填）' },
      { name: 'kind', type: 'text', label: '支出、收入、他欠我、我欠他、他還我、我還他、調整（必填）' },
      { name: 'amount', type: 'number', label: '金額（支出／收入可填 0；人物、借還款須大於 0；必填）' },
      { name: 'category', type: 'text', label: '分類（支出、收入必填；填分類的 path）' },
      { name: 'person', type: 'text', label: '人物名稱（他欠我、我欠他、他還我、我還他必填）' },
      { name: 'budget', type: 'text', label: '扣 / 放進哪個預算（預算功能之後做）' },
      { name: 'note', type: 'text', label: '備註' },
      { name: 'sort', type: 'number', label: '同一筆交易內的順序' },
      ...systemCols,
    ],
  },
  moneyCardPayments: {
    file: 'money',
    description:
      '信用卡繳款分配：一筆銀行扣款可以分配到同一發卡機構的多張卡、不同期帳單；同一期也可以分次繳。建議在 APP 裡操作。',
    columns: [
      { name: 'transaction', type: 'text', label: '銀行扣款交易（moneyTransactions 的 id，必填）' },
      { name: 'account', type: 'text', label: '繳入的信用卡帳戶（必填）' },
      { name: 'statement', type: 'text', label: '繳哪一期帳單（moneyStatements 的 id，必填）' },
      { name: 'amount', type: 'number', label: '這張卡／這一期分配到的金額（必填）' },
      { name: 'sort', type: 'number', label: '同一筆扣款內的順序' },
      ...systemCols,
    ],
  },
  moneyBudgets: {
    file: 'money',
    description: '預算（信封袋）。每個預算有理想金額、基本金額；每月草稿帶入基本金額。請在 APP 裡新增或修改（改名時用到的紀錄會一起改）。',
    columns: [
      { name: 'name', type: 'text', label: '預算名稱（必填，不可重複；例：日常雜支）' },
      { name: 'ideal', type: 'number', label: '理想金額（每月預計要放的；加總可以超過薪資，靠年終 / 獎金補）' },
      { name: 'basic', type: 'number', label: '基本金額（依每月花費；加總不超過薪資）' },
      { name: 'monthly', type: 'bool', label: '每月預算（空白 = 是；FALSE = 不是每月都放，例：年度保險費）' },
      { name: 'goal', type: 'number', label: '長期累積的目標金額（選填，顯示進度）' },
      { name: 'archived', type: 'bool', label: '停用（TRUE）' },
      { name: 'sort', type: 'number', label: '排序' },
      { name: 'note', type: 'text', label: '備註' },
      ...systemCols,
    ],
  },
  moneyBudgetAllocations: {
    file: 'money',
    description:
      '預算分配：某月放進某預算的錢（每月、追加、年終），以及「重新整理預算」的期初金額（期初）。預算可用 = 最新一次期初 ＋ 之後的分配 ＋ 放進預算的收入 − 扣預算的支出。建議在 APP 裡操作。',
    columns: [
      { name: 'month', type: 'text', label: '月份（YYYY-MM，必填）' },
      { name: 'budget', type: 'text', label: '預算名稱（必填）' },
      { name: 'kind', type: 'text', label: '每月、追加、年終、期初（必填）' },
      { name: 'amount', type: 'number', label: '金額（必填；可以是負數，例：期初是負的）' },
      { name: 'date', type: 'date', label: '期初才填：從哪一天開始算（那天開始時的金額）' },
      { name: 'ideal', type: 'number', label: '每月才填：當時的理想金額（算「今年還差多少到理想」用）' },
      { name: 'note', type: 'text', label: '備註' },
      ...systemCols,
    ],
  },
  moneyDeposits: {
    file: 'money',
    description: '定存單：定存帳戶裡的一張定存（本金、利率、到期日）。定存帳戶的餘額還是看交易（開定存 = 活存轉到定存）。建議在 APP 裡操作。',
    columns: [
      { name: 'account', type: 'text', label: '定存帳戶名稱（必填）' },
      { name: 'principal', type: 'number', label: '本金（必填）' },
      { name: 'rate', type: 'number', label: '年利率 %（選填）' },
      { name: 'startDate', type: 'date', label: '起存日（必填）' },
      { name: 'maturityDate', type: 'date', label: '到期日（必填；續存時改成新的到期日）' },
      { name: 'termMonths', type: 'number', label: '期間幾個月（續存時預設用這個）' },
      { name: 'fromAccount', type: 'text', label: '從哪個帳戶轉來（解約時預設轉回這裡）' },
      { name: 'endedDate', type: 'date', label: '解約 / 結束日（有值 = 已結束）' },
      { name: 'note', type: 'text', label: '備註' },
      ...systemCols,
    ],
  },
  moneyStatements: {
    file: 'money',
    description: '帳單：某個帳戶的一期（帳戶＋結帳日）。對帳在 APP 裡做；貼帳單明細時 APP 自動建立這一列。',
    columns: [
      { name: 'account', type: 'text', label: '帳戶名稱（必填）' },
      { name: 'closeDate', type: 'date', label: '結帳日（這一期的最後一天，必填）' },
      { name: 'dueDate', type: 'date', label: '繳款期限（信用卡；APP 依繳款日自動算）' },
      { name: 'amountDue', type: 'number', label: '應繳金額（信用卡）' },
      { name: 'doneAt', type: 'datetime', label: '對帳完成時間（APP 自動填）' },
      { name: 'note', type: 'text', label: '備註' },
      ...systemCols,
    ],
  },
  moneyStatementItems: {
    file: 'money',
    description:
      '帳單明細：帳單上的一行。可以在 APP 直接貼，也可以貼在這裡（填 account、closeDate、date、description、amount；信用卡刷卡是正數、退款是負數；銀行存入是正數、支出是負數）。',
    columns: [
      { name: 'account', type: 'text', label: '帳戶名稱（必填）' },
      { name: 'closeDate', type: 'date', label: '哪一期（結帳日，必填）' },
      { name: 'date', type: 'date', label: '消費日 / 交易日' },
      { name: 'postedDate', type: 'date', label: '入帳日' },
      { name: 'description', type: 'text', label: '帳單上的說明' },
      { name: 'amount', type: 'number', label: '金額（照帳單：信用卡刷卡正、退款負；銀行存入正、支出負，必填）' },
      { name: 'origCurrency', type: 'text', label: '外幣幣別（選填）' },
      { name: 'origAmount', type: 'number', label: '外幣金額（選填）' },
      { name: 'matched', type: 'text', label: '配對到的交易 id（APP 自動填，多筆用逗號；「不配對」= 手動取消配對）' },
      ...systemCols,
    ],
  },
  moneyBalanceChecks: {
    file: 'money',
    description: '盤點：某個帳戶某一天的實際餘額（信用卡填未繳金額）。請在 APP 裡盤點。',
    columns: [
      { name: 'account', type: 'text', label: '帳戶名稱（必填）' },
      { name: 'date', type: 'date', label: '盤點哪一天的餘額（那天結束時，必填）' },
      { name: 'actual', type: 'number', label: '實際餘額（信用卡填未繳金額，正數 = 欠款；必填）' },
      { name: 'bookSnapshot', type: 'number', label: '盤點當下 APP 算的餘額（之後補登不改，看「原本差多少」用）' },
      { name: 'note', type: 'text', label: '備註' },
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
    description: '「廁所大事」APP 的設定，請在 APP 裡修改。',
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
