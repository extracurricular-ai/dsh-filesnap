/**
 * `filesnap` namespace dictionaries. Product copy is Chinese, so `zh` is the
 * key-set source of truth and `en` is checked complete against it.
 *
 * @module
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'open': '回退',
  'title': '回退到某一轮开始时',
  'empty': '暂无回退点。每轮开始时会自动记录一个。',
  'unavailable': '当前会话不支持回退。',
  'noLabel': '（无消息）',
  'turn': '第 {turn} 轮',
  'redo': '撤销回退',
  'working': '正在回退…',
  'failed': '回退未完成：{reason}',
  'close': '关闭',
} satisfies Record<string, string>

/** The filesnap namespace key union. */
export type RewindKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'open': 'Rewind',
  'title': 'Rewind to the start of a turn',
  'empty': 'No rewind points yet. One is taken at the start of each turn.',
  'unavailable': 'Rewind is not available in this session.',
  'noLabel': '(no message)',
  'turn': 'Turn {turn}',
  'redo': 'Undo the rewind',
  'working': 'Rewinding…',
  'failed': 'The rewind did not complete: {reason}',
  'close': 'Close',
} satisfies Record<RewindKey, string>
