const { getRecentMessagesWithinTokens } = require('./utils');

function buildPrompt({ sessionId, newMessage, data, config }) {
  const session = data.sessions.find((s) => s.id === sessionId);
  const allMessages = data.messages.filter((m) => m.sessionId === sessionId);
  const history = getRecentMessagesWithinTokens(allMessages, config.MAX_PROMPT_TOKENS);

  const lines = [];
  lines.push(`系统提示: ${session?.systemPrompt || config.DEFAULT_SYSTEM_PROMPT}`);
  lines.push('规则:');
  lines.push('1) 你是运行在本地 Mac 的 Codex Agent，通过服务器转发任务；可访问本地代码与环境信息。');
  lines.push('2) 工作模式：接收用户指令 -> 在本地执行 -> 返回结果与建议；回答要简洁可执行。');
  lines.push('3) 优先直接执行用户任务：能自行完成的，不要反问或让用户补步骤。');
  lines.push('4) 若一次无法解决，需自行拆解并继续尝试；只有确实受限或缺关键输入时才向用户求助。');
  lines.push('5) 只有在确实没有办法继续时才询问用户，否则请默默完成任务并给出结果。');
  lines.push('6) 能力边界：只基于你实际可见的本地环境/文件/命令输出，不要编造。');
  lines.push('7) 需要更多信息时，明确说明缺口并给出下一步。');

  if (session?.summary) {
    lines.push('【摘要】');
    lines.push(session.summary);
  }

  lines.push('【对话记录】');
  history.forEach((m) => {
    const role = m.role === 'assistant' ? '助手' : '用户';
    lines.push(`${role}: ${m.content}`);
  });
  lines.push(`用户: ${newMessage}`);
  lines.push('请作为智能助手回复用户，并尽量清晰简洁。');

  return lines.join('\n');
}

module.exports = { buildPrompt };
