function estimateTokens(text) {
  if (!text) return 0;
  const asciiMatch = text.match(/[\x00-\x7F]/g);
  const ascii = asciiMatch ? asciiMatch.length : 0;
  const nonAscii = text.length - ascii;
  return Math.ceil(ascii / 4 + nonAscii / 1.5);
}

function estimateMessageTokens(message) {
  const content = message?.content || '';
  return estimateTokens(content) + 6;
}

function getKeepStartIndexByTokens(messages, maxTokens) {
  if (!Array.isArray(messages) || messages.length === 0) return 0;
  let total = 0;
  let start = messages.length;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const cost = estimateMessageTokens(messages[i]);
    if (total + cost > maxTokens && i < messages.length - 1) {
      break;
    }
    total += cost;
    start = i;
  }
  return start;
}

function getRecentMessagesWithinTokens(messages, maxTokens) {
  const start = getKeepStartIndexByTokens(messages, maxTokens);
  return messages.slice(start);
}

module.exports = {
  estimateTokens,
  estimateMessageTokens,
  getKeepStartIndexByTokens,
  getRecentMessagesWithinTokens
};
