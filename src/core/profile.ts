import type { Profile, ProfileKey, Settings } from './types';

/**
 * 自社版/汎用版の差分はすべてここに集約する（旧ハードフォークの置き換え）。
 * UI はこの語彙・機能フラグだけを参照し、版分岐のコードを書かないこと。
 */
export const PROFILES: Record<ProfileKey, Profile> = {
  generic: {
    key: 'generic',
    label: '汎用版',
    vocab: {
      popSizes: ['5号', '6号', '7号', '8号', '9号', 'A3', 'ポスター(A2)', 'ポスター(A1)', '競合', '最安売価のみ'],
      shortageCategories: ['1番', '2番', '3番', '4番', '5番', '6番', '米', 'その他'],
      orderTypes: ['発注(上げ)', '発注(下げ)', '指数変更(上げ)', '指数変更(下げ)'],
    },
    features: {
      leadingZeroHighlight: true,
      notes: true,
    },
  },
  jisha: {
    key: 'jisha',
    label: '自社版',
    vocab: {
      popSizes: ['5号', '6号', '7号', '8号', '9号', 'A3', 'ポスター(A2)', 'ポスター(A1)', '競合', '最安売価のみ'],
      shortageCategories: ['1番', '2番', '3番', '4番', '5番', '6番', '米', 'その他'],
      orderTypes: ['発注(上げ)', '発注(下げ)', '指数変更(上げ)', '指数変更(下げ)'],
    },
    features: {
      leadingZeroHighlight: false,
      notes: true,
    },
  },
};

export const DEFAULT_SETTINGS: Settings = {
  profile: 'generic',
  theme: 'auto',
  cameraPreset: 'default',
  cameraFps: 5,
  cameraFocusMode: '',
  tallBarcodeMode: false,
  inputSource: 'camera',
  expiryChips: [2, 3, 4, 7, 14],
  popPresets: [],
  assignees: [],
  exportEol: 'CRLF',
  qrBatchSize: 50,
  historySort: 'newest',
  custSort: 'arrival',
  lastBackupAt: '',
};
