function buildSummaryPrompt(session, chunk, config) {
  const lines = [];
  lines.push('你是对话压缩器，需要把历史对话压缩为简洁摘要。');
  lines.push('要求:');
  lines.push(`1) 用中文输出不超过 ${config.SUMMARY_MAX_CHARS} 字符的摘要。`);
  lines.push('2) 只输出摘要内容，不要标题、编号或多余说明。');
  lines.push('3) 必须保留用户的关键约束、偏好、未完成事项与结论。');
  if (session.summary) {
    lines.push('已有摘要:');
    lines.push(session.summary);
  }
  lines.push('新增对话:');
  chunk.forEach((m) => {
    const role = m.role === 'assistant' ? '助手' : '用户';
    lines.push(`${role}: ${m.content}`);
  });
  lines.push('请输出更新后的摘要。');
  return lines.join('\n');
}

function getSummaryChunk(messages, startIndex, endIndex, config) {
  const chunk = [];
  let size = 0;
  for (let i = startIndex; i < endIndex; i += 1) {
    const message = messages[i];
    const content = message?.content || '';
    const estimated = content.length + 12;
    if (size + estimated > config.SUMMARY_CHUNK_MAX_CHARS && chunk.length > 0) {
      break;
    }
    chunk.push(message);
    size += estimated;
  }
  return chunk;
}

module.exports = { buildSummaryPrompt, getSummaryChunk };
