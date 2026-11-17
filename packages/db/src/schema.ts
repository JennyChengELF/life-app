/**
 * 試算表結構：每個 APP 一個試算表檔案（file），檔案內每張工作表是一個資料表（table）。
 * 第一列是欄位名稱（英文），APP 依欄位名稱找欄位，所以使用者調整欄位順序也沒關係。
 */

/**
 * 2：喝水紀錄加「drink」、新增飲品清單（2026-11-17）
 * 3：體重表 healthWeights 改名為身體量測 healthBodyMeasurements 並加上身體組成欄位；新增偶爾量測、健康設定（2026-11-17）
 */
export const SCHEMA_VERSION = 3;

export type ColType = 'datetime' | 'date' | 'number' | 'text' | 'bool' | 'any';

export interface ColumnDef {
  name: string;
  type: ColType;
  /** 給「說明」工作表看的中文說明 */
  label: string;
}

export type FileKey = 'water' | 'health';

export interface FileDef {
  /** 試算表檔名（不加版本號） */
  title: string;
  description: string;
}

export const FILES: Record<FileKey, FileDef> = {
  water: { title: '生活APP-喝水', description: '喝水 APP 的資料：喝水紀錄、每日目標、常用杯子、設定' },
  health: { title: '生活APP-健康', description: '健康 APP 的資料：身體量測（體重、體脂⋯⋯）、偶爾量測（身高、圍度⋯⋯）、設定' },
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
  healthSettings: {
    file: 'health',
    description: '健康 APP 的設定，請在 APP 裡修改。',
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
