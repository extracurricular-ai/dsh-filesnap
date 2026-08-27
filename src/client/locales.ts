/**
 * `filesnap` namespace dictionaries. Product copy is Chinese, so `zh` is the
 * key-set source of truth and `en` is checked complete against it.
 *
 * @module
 */

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'rewindHere': '回退到这一轮之前',
  'rewindTo': '回退到「{label}」之前',
  'covered': '本轮跟踪 {tracked} 个文件（新哈希 {hashed}）',
  'dropped': '跳过 {dropped} 个',
  'failed': '回退未完成：{reason}',
  'undo': '撤销回退',
  'undoFrom': '撤销回退到「{label}」',
  'status': '查看快照状态',
} satisfies Record<string, string>

/** The filesnap namespace key union. */
export type RewindKey = keyof typeof zh

/** English dictionary, checked complete against the zh key set. */
export const en = {
  'rewindHere': 'Rewind to before this turn',
  'rewindTo': 'Rewind to before “{label}”',
  'covered': '{tracked} files tracked this turn ({hashed} newly hashed)',
  'dropped': '{dropped} skipped',
  'failed': 'The rewind did not complete: {reason}',
  'undo': 'Undo the rewind',
  'undoFrom': 'Undo the rewind to “{label}”',
  'status': 'Show snapshot status',
} satisfies Record<RewindKey, string>
