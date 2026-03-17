const path = require('path');
require('dotenv').config();

const BASE_DIR = path.join(__dirname, '..');

const config = {
  AUTH_TOKEN: process.env.AUTH_TOKEN,
  PORT: process.env.PORT || 3000,
  DATA_FILE: path.join(BASE_DIR, 'data.json'),
  LOG_DIR: path.join(BASE_DIR, 'logs'),
  PUBLIC_DIR: path.join(BASE_DIR, 'public'),
  UPLOAD_DIR: path.join(BASE_DIR, 'uploads'),
  DEFAULT_SYSTEM_PROMPT: process.env.DEFAULT_SYSTEM_PROMPT || '你是一个可靠的私人AI管家，回答简洁明确。',
  MAX_HISTORY: Number.parseInt(process.env.MAX_HISTORY || '24', 10),
  MAX_HISTORY_TOKENS: Number.parseInt(process.env.MAX_HISTORY_TOKENS || '12000', 10),
  MAX_PROMPT_TOKENS: Number.parseInt(process.env.MAX_PROMPT_TOKENS || `${process.env.MAX_HISTORY_TOKENS || '12000'}`, 10),
  SUMMARY_MAX_CHARS: Number.parseInt(process.env.SUMMARY_MAX_CHARS || '2400', 10),
  SUMMARY_CHUNK_MAX_CHARS: Number.parseInt(process.env.SUMMARY_CHUNK_MAX_CHARS || '8000', 10),
  TASK_TIMEOUT_MS: Number.parseInt(process.env.TASK_TIMEOUT_MS || '300000', 10),
  AGENT_OFFLINE_MS: Number.parseInt(process.env.AGENT_OFFLINE_MS || '20000', 10),
  MAX_MESSAGE_CHARS: Number.parseInt(process.env.MAX_MESSAGE_CHARS || '8000', 10),
  MAX_UPLOAD_MB: Number.parseInt(process.env.MAX_UPLOAD_MB || '10', 10),
  MAX_TASK_HISTORY: Number.parseInt(process.env.MAX_TASK_HISTORY || '2000', 10)
};

module.exports = { config, BASE_DIR };
