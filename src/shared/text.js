const MOJIBAKE_REPLACEMENTS = new Map([
  ["纭", "确认"],
  ["鎷掔粷", "拒绝"],
  ["鍙栨秷", "取消"],
  ["鍏佽", "允许"],
  ["鎵瑰噯", "批准"],
  ["缁х画", "继续"],
  ["宸ュ叿", "工具"],
  ["杩炴帴鍣", "连接器"],
  ["搴旂敤", "应用"]
]);

export function normalizeText(value) {
  let text = String(value ?? "")
    .replace(/\r\n/g, "\n")
    .replace(/\u00a0/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  for (const [bad, good] of MOJIBAKE_REPLACEMENTS) {
    text = text.split(bad).join(good);
  }

  return text;
}

export function includesAnyText(value, patterns) {
  const text = normalizeText(value).toLowerCase();
  return patterns.some((pattern) => text.includes(normalizeText(pattern).toLowerCase()));
}
