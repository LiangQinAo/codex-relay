<template>
  <div class="h-[100dvh] flex flex-col overflow-hidden bg-slate-950 text-slate-100">
    <!-- 背景装饰光晕 -->
    <div class="pointer-events-none fixed inset-0 -z-10 overflow-hidden">
      <div class="absolute -top-40 right-0 w-[600px] h-[600px] rounded-full bg-cyan-500/5 blur-[120px]"></div>
      <div class="absolute -bottom-40 -left-20 w-96 h-96 rounded-full bg-indigo-600/5 blur-[100px]"></div>
    </div>

    <!-- ── 顶部导航栏 ─────────────────────────────────────── -->
    <header class="shrink-0 z-10 border-b border-slate-800/60 bg-slate-950/80 backdrop-blur-xl" style="padding-top: env(safe-area-inset-top)">
      <div class="max-w-7xl mx-auto px-4 h-14 flex items-center gap-2">
        <button
          class="lg:hidden p-2 -ml-1 rounded-xl hover:bg-slate-800 active:bg-slate-700 transition"
          @click="showSidebar = !showSidebar"
          aria-label="会话列表"
        >
          <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="M3 6h18M3 12h18M3 18h18"/>
          </svg>
        </button>
        <div class="flex-1 min-w-0 flex items-center gap-2">
          <span class="hidden sm:block text-[10px] text-slate-600 uppercase tracking-[0.35em] shrink-0">Codex</span>
          <span class="text-sm font-semibold truncate">{{ currentSession?.title || '私人 AI 管家' }}</span>
        </div>
        <div class="flex items-center gap-1.5 flex-none">
          <span class="relative flex h-2 w-2 mr-0.5">
            <span v-if="agentStatus === 'online'" class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span class="relative inline-flex h-2 w-2 rounded-full" :class="agentStatus === 'online' ? 'bg-emerald-400' : 'bg-rose-500'"></span>
          </span>
          <span class="hidden sm:block text-xs text-slate-400">{{ agentStatus === 'online' ? '在线' : '离线' }}</span>
          <span v-if="queueLength > 0" class="text-[11px] px-1.5 py-0.5 rounded-full bg-cyan-400/15 border border-cyan-400/30 text-cyan-300 leading-none">{{ queueLength }}</span>
          <span class="hidden md:flex items-center gap-1 text-[11px] px-2 py-1 rounded-lg border"
            :class="socketConnected ? 'border-emerald-400/20 text-emerald-400/80 bg-emerald-400/5' : 'border-rose-400/20 text-rose-400/80 bg-rose-400/5'">
            <span class="w-1 h-1 rounded-full" :class="socketConnected ? 'bg-emerald-400' : 'bg-rose-400'"></span>
            {{ socketConnected ? '已连接' : '断开' }}
          </span>
          <span
            class="text-[10px] px-2 py-1 rounded-lg border border-slate-800/70 bg-slate-900/40 text-slate-500 font-mono"
            :title="buildLabel"
          >版本 {{ buildLabel }}</span>
          <button
            class="p-2 rounded-xl transition active:scale-95"
            :class="showSettings ? 'bg-slate-700 text-cyan-300' : 'hover:bg-slate-800 text-slate-400 hover:text-slate-200'"
            @click="showSettings = !showSettings"
            aria-label="设置"
          >
            <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="M10.5 6h9.75M10.5 6a1.5 1.5 0 11-3 0m3 0a1.5 1.5 0 10-3 0M3.75 6H7.5m3 12h9.75m-9.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-3.75 0H7.5m9-6h3.75m-3.75 0a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m-9.75 0h9.75"/>
            </svg>
          </button>
        </div>
      </div>
    </header>

    <!-- ── 设置抽屉 ────────────────────────────────────────── -->
    <div
      v-show="showSettings"
      class="shrink-0 border-b border-slate-800/60 bg-slate-950/90 backdrop-blur-xl overflow-y-auto scrollbar"
      style="max-height: min(60vh, 300px)"
    >
      <div class="max-w-7xl mx-auto px-4 py-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <div class="space-y-2">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Auth Token</p>
          <div class="flex gap-2">
            <input
              v-model="token"
              type="password"
              class="flex-1 min-w-0 rounded-lg bg-slate-900/80 border border-slate-700 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
              placeholder="输入 auth token"
            />
            <button
              class="shrink-0 rounded-lg bg-cyan-500 text-slate-900 font-semibold px-3 py-2 text-sm hover:bg-cyan-400 active:scale-95 transition"
              @click="saveToken"
            >保存</button>
          </div>
          <p class="text-[11px]"><span class="text-slate-500">连接：</span><span :class="socketConnected ? 'text-emerald-400' : 'text-rose-400'">{{ socketConnected ? '已连接' : '断开' }}</span></p>
        </div>
        <div class="space-y-2">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-500">当前会话</p>
          <div class="flex flex-wrap gap-2 text-xs">
            <button class="rounded-lg border border-slate-700 px-3 py-2 hover:border-slate-500 hover:bg-slate-800/60 active:scale-95 transition" @click="editSessionTitle">重命名</button>
            <button class="rounded-lg border border-slate-700 px-3 py-2 hover:border-slate-500 hover:bg-slate-800/60 active:scale-95 transition" @click="editSystemPrompt">系统提示</button>
            <button class="rounded-lg border border-rose-400/40 px-3 py-2 text-rose-300 hover:border-rose-400/70 hover:bg-rose-900/20 active:scale-95 transition" @click="archiveSession">归档</button>
          </div>
          <div v-if="summary" class="text-[11px] bg-slate-900/60 border border-slate-700/60 rounded-lg p-2.5 max-h-16 overflow-y-auto scrollbar text-slate-400 whitespace-pre-wrap leading-relaxed">{{ summary }}</div>
          <p v-else class="text-[11px] text-slate-600">暂无摘要，对话较短</p>
          <p v-if="summaryUpdatedAt" class="text-[10px] text-slate-600">更新于 {{ formatRelativeTime(summaryUpdatedAt) }}</p>
        </div>
        <div class="space-y-2 sm:col-span-2 lg:col-span-1">
          <div class="flex items-center justify-between">
            <p class="text-[10px] font-semibold uppercase tracking-widest text-slate-500">Agent 环境</p>
            <div class="flex gap-1">
              <button class="text-[11px] text-slate-500 hover:text-slate-300 px-2 py-1 rounded-lg hover:bg-slate-800 active:scale-95 transition" @click="requestAgentInfo">刷新</button>
              <button class="text-[11px] text-amber-400/70 hover:text-amber-300 px-2 py-1 rounded-lg hover:bg-amber-900/20 active:scale-95 transition" @click="runDiagnostics">自检</button>
            </div>
          </div>
          <div class="text-[11px] text-slate-400 space-y-0.5" v-if="agentInfo">
            <div class="flex gap-2"><span class="text-slate-600 w-11 shrink-0">主机</span>{{ agentInfo.hostname }}</div>
            <div class="flex gap-2"><span class="text-slate-600 w-11 shrink-0">平台</span>{{ agentInfo.platform }}/{{ agentInfo.arch }}</div>
            <div class="flex gap-2"><span class="text-slate-600 w-11 shrink-0">Node</span>{{ agentInfo.nodeVersion }}</div>
            <div class="flex gap-2"><span class="text-slate-600 w-11 shrink-0">Codex</span>{{ agentInfo.codexVersion }}</div>
            <div class="flex gap-2"><span class="text-slate-600 w-11 shrink-0">目录</span><span class="font-mono text-[10px] break-all text-slate-500">{{ agentInfo.cwd }}</span></div>
            <div class="flex gap-2"><span class="text-slate-600 w-11 shrink-0">用户</span>{{ agentInfo.user }}</div>
          </div>
          <p v-else class="text-[11px] text-slate-600">暂无数据，点击刷新</p>
        </div>
      </div>
    </div>

    <!-- ── 主体区：侧边栏 + 聊天 ──────────────────────────── -->
    <div class="flex-1 min-h-0 overflow-hidden">
      <div class="max-w-7xl mx-auto h-full w-full min-w-0 px-4 py-4 flex gap-4 overflow-hidden">
        <!-- 侧边栏遮罩（移动端） -->
        <transition name="fade">
          <div
            v-if="showSidebar"
            class="lg:hidden fixed inset-0 z-30 bg-slate-950/70 backdrop-blur-[2px]"
            @click="showSidebar = false"
          ></div>
        </transition>

        <!-- 侧边栏 -->
        <aside
          class="glass rounded-2xl flex flex-col gap-3 p-4 min-h-0 overflow-hidden
                 lg:static lg:w-72 lg:shrink-0
                 fixed inset-y-4 left-4 z-40 w-[82vw] max-w-xs
                 transition-transform duration-300 ease-out will-change-transform"
          :class="showSidebar ? 'translate-x-0' : '-translate-x-[calc(100%+2rem)] lg:translate-x-0'"
        >
          <div class="flex items-center justify-between">
            <h2 class="text-sm font-semibold">会话</h2>
            <button
              class="text-xs font-medium text-cyan-400 hover:text-cyan-300 px-2 py-1 rounded-lg hover:bg-cyan-400/10 active:scale-95 transition"
              @click="createSession"
            >+ 新建</button>
          </div>
          <div class="relative">
            <svg class="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500 pointer-events-none" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" d="m21 21-5.197-5.197m0 0A7.5 7.5 0 1 0 5.196 5.196a7.5 7.5 0 0 0 10.607 10.607Z"/>
            </svg>
            <input
              v-model="search"
              class="w-full rounded-lg bg-slate-900/60 border border-slate-700/80 pl-8 pr-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-cyan-400/50"
              placeholder="搜索..."
            />
          </div>
          <div class="flex-1 min-h-0 overflow-y-auto overflow-x-hidden scrollbar pr-1 space-y-1">
            <button
              v-for="session in filteredSessions"
              :key="session.id"
              @click="selectSession(session.id)"
              class="w-full text-left rounded-xl border px-3 py-2.5 transition active:scale-[0.98]"
              :class="session.id === currentSessionId
                ? 'border-cyan-400/50 bg-cyan-400/10 shadow-[0_0_16px_rgba(34,211,238,0.07)]'
                : 'border-slate-800/70 bg-slate-900/40 hover:border-slate-700 hover:bg-slate-800/40'"
            >
              <div class="font-medium truncate text-sm">{{ session.title }}</div>
              <div class="text-[11px] text-slate-500 mt-0.5">{{ formatRelativeTime(session.updatedAt) }}</div>
            </button>
            <div v-if="!filteredSessions.length" class="text-xs text-slate-600 px-3 py-6 text-center">
              {{ search ? '无匹配会话' : '暂无会话，点击新建' }}
            </div>
          </div>
        </aside>

        <!-- 聊天主面板 -->
        <main class="flex-1 min-h-0 min-w-0 glass rounded-2xl flex flex-col overflow-hidden">
          <div class="flex-1 min-h-0 min-w-0 overflow-y-auto overflow-x-hidden scrollbar px-4 py-4 space-y-3" ref="messageBox">
            <!-- 空状态 -->
            <div v-if="!messages.length" class="h-full flex flex-col items-center justify-center gap-4 select-none">
              <div class="w-14 h-14 rounded-2xl bg-slate-800/60 flex items-center justify-center">
                <svg class="w-7 h-7 text-slate-600" fill="none" stroke="currentColor" stroke-width="1.5" viewBox="0 0 24 24">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M8.625 12a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375M21 12c0 4.556-4.03 8.25-9 8.25a9.764 9.764 0 01-2.555-.337A5.972 5.972 0 015.41 20.97a5.969 5.969 0 01-.474-.065 4.48 4.48 0 00.978-2.025c.09-.457-.133-.901-.467-1.226C3.93 16.178 3 14.189 3 12c0-4.556 4.03-8.25 9-8.25s9 3.694 9 8.25z"/>
                </svg>
              </div>
              <div class="text-center">
                <p class="text-sm text-slate-500 font-medium">{{ currentSessionId ? '发送消息开始对话' : '选择或新建会话' }}</p>
                <p class="text-xs text-slate-600 mt-1">{{ currentSessionId ? 'Agent 将在收到消息后响应' : '从左侧选择一个会话' }}</p>
              </div>
            </div>

            <!-- 消息气泡 -->
            <div
              v-for="message in messages"
              :key="message.id"
              class="flex msg-fade-in"
              :class="message.role === 'assistant' ? 'justify-start' : 'justify-end'"
            >
              <div
                class="max-w-[88%] sm:max-w-[80%] rounded-2xl px-4 py-3 text-sm leading-relaxed"
                :class="message.role === 'assistant'
                  ? 'bg-slate-900/80 border border-slate-700/60 rounded-tl-sm'
                  : 'bg-gradient-to-br from-cyan-400 to-cyan-500 text-slate-900 rounded-tr-sm'"
              >
                <div
                  class="markdown-body break-words"
                  v-html="renderMarkdown(message)"
                ></div>
                <div
                  class="mt-1.5 flex flex-wrap items-center gap-1.5 text-[11px]"
                  :class="message.role === 'assistant' ? 'text-slate-500' : 'text-slate-700'"
                >
                  <span>{{ formatRelativeTime(message.createdAt) }}</span>
                  <span v-if="message.role === 'assistant' && message.durationMs != null">· {{ formatDuration(message.durationMs) }}</span>
                </div>
              </div>
            </div>

            <!-- 流式思考过程气泡 -->
            <div v-if="streamState?.reasoning" class="flex justify-start msg-fade-in">
              <div class="max-w-[88%] sm:max-w-[80%] rounded-2xl rounded-tl-sm px-3 py-2 text-xs leading-relaxed bg-slate-800/60 border border-slate-700/40 text-slate-500 italic">
                <span class="not-italic text-slate-600 mr-1.5">思考中</span>{{ streamState.reasoning }}
              </div>
            </div>

            <!-- 流式输出气泡 -->
            <div v-if="streamState?.content" class="flex justify-start msg-fade-in">
              <div class="max-w-[88%] sm:max-w-[80%] rounded-2xl rounded-tl-sm px-4 py-3 text-sm leading-relaxed bg-slate-900/80 border border-cyan-400/20">
                <div
                  class="markdown-body break-words"
                  v-html="renderMarkdownText(streamState.displayed)"
                ></div>
                <span v-if="streamState.displayed.length < streamState.content.length" class="stream-cursor inline-block w-[2px] h-[1em] bg-cyan-400 ml-0.5 align-text-bottom rounded-sm"></span>
              </div>
            </div>

            <!-- Agent 思考指示器 -->
            <div v-if="agentProcessing && !streamState?.content && !streamState?.reasoning" class="flex justify-start msg-fade-in">
              <div class="bg-slate-900/80 border border-slate-700/60 rounded-2xl rounded-tl-sm px-4 py-3.5 flex gap-1.5 items-center">
                <span class="w-1.5 h-1.5 rounded-full bg-slate-400 typing-dot"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-slate-400 typing-dot" style="animation-delay: 0.15s"></span>
                <span class="w-1.5 h-1.5 rounded-full bg-slate-400 typing-dot" style="animation-delay: 0.3s"></span>
              </div>
            </div>
          </div>

          <!-- 输入区 -->
          <div class="shrink-0 border-t border-slate-800/60 p-3 input-safe-bottom">
            <div v-if="attachments.length" class="mb-2 flex gap-2 overflow-x-auto scrollbar pb-1">
              <div
                v-for="item in attachments"
                :key="item.id"
                class="relative w-20 h-20 rounded-xl overflow-hidden border border-slate-700/60 bg-slate-900/70 shrink-0"
              >
                <img :src="item.previewUrl" alt="" class="w-full h-full object-cover" />
                <div v-if="item.uploading" class="absolute inset-0 bg-slate-900/70 flex items-center justify-center">
                  <svg class="w-5 h-5 animate-spin text-slate-300" viewBox="0 0 24 24" fill="none">
                    <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                    <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 12 0 12 0z"/>
                  </svg>
                </div>
                <button
                  class="absolute top-1 right-1 bg-slate-900/80 hover:bg-slate-800 text-slate-200 rounded-full w-6 h-6 flex items-center justify-center"
                  @click="removeAttachment(item.id)"
                  aria-label="移除图片"
                >
                  ×
                </button>
                <div v-if="item.error" class="absolute inset-0 bg-rose-900/80 text-[10px] text-rose-100 p-1">
                  {{ item.error }}
                </div>
              </div>
            </div>
            <div class="flex gap-2 items-end">
              <input
                ref="fileInputRef"
                type="file"
                accept="image/*"
                class="hidden"
                @change="handleImageChange"
              />
              <button
                class="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl transition active:scale-95 disabled:cursor-not-allowed"
                :class="uploading
                  ? 'bg-slate-800 text-slate-500'
                  : 'bg-slate-900/70 text-slate-300 hover:bg-slate-800'"
                :disabled="!socketConnected || !currentSessionId || uploading"
                @click="openImagePicker"
                aria-label="上传图片"
              >
                <svg v-if="!uploading" class="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M4 16l4-4a3 3 0 014 0l2 2m4-4v6a2 2 0 01-2 2H6a2 2 0 01-2-2V8a2 2 0 012-2h6m4 0h4v4" />
                </svg>
                <svg v-else class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 12 0 12 0z"/>
                </svg>
              </button>
            <div class="flex gap-2 items-end min-w-0">
              <textarea
                ref="textareaRef"
                v-model="input"
                rows="1"
                class="flex-1 min-w-0 rounded-xl bg-slate-900/60 border border-slate-700/80 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/60 resize-none leading-relaxed overflow-y-auto"
                style="max-height: 8rem"
                placeholder="输入消息...（Enter 发送，Shift+Enter 换行）"
                @keydown="handleKeydown"
                @input="autoResize"
                @paste="handlePaste"
                :disabled="!socketConnected || !currentSessionId"
              ></textarea>
              <button
                class="shrink-0 w-11 h-11 flex items-center justify-center rounded-xl transition active:scale-95 disabled:cursor-not-allowed"
                :class="canSend
                  ? 'bg-emerald-500 text-white hover:bg-emerald-400 shadow-[0_0_18px_rgba(52,211,153,0.3)]'
                  : 'bg-slate-800 text-slate-600'"
                :disabled="!canSend"
                @click="sendMessage"
                aria-label="发送"
              >
                <svg v-if="!sending" class="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M3.478 2.405a.75.75 0 00-.926.94l2.432 7.905H13.5a.75.75 0 010 1.5H4.984l-2.432 7.905a.75.75 0 00.926.94 60.519 60.519 0 0018.445-8.986.75.75 0 000-1.218A60.517 60.517 0 003.478 2.405z"/>
                </svg>
                <svg v-else class="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/>
                  <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 12 0 12 0z"/>
                </svg>
              </button>
            </div>
            </div>
            <div class="mt-2 flex items-center justify-between px-1 text-[11px] text-slate-600 h-4">
              <span>{{ statusDisplay }}</span>
              <span v-if="lastTaskStatus" class="text-slate-700">{{ lastTaskStatus }}<span v-if="lastTaskAt"> · {{ formatRelativeTime(lastTaskAt) }}</span></span>
            </div>
          </div>
        </main>
      </div>
    </div>

    <!-- ── 自检记录折叠条 ──────────────────────────────────── -->
    <div class="shrink-0 border-t border-slate-800/40 bg-slate-950/60" style="padding-bottom: env(safe-area-inset-bottom)">
      <div class="max-w-7xl mx-auto px-4">
        <button
          class="w-full min-w-0 flex flex-wrap items-center gap-1.5 py-2.5 text-[11px] text-slate-600 hover:text-slate-400 transition"
          @click="showDiagPanel = !showDiagPanel"
        >
          <svg class="w-3.5 h-3.5 transition-transform duration-200" :class="showDiagPanel ? 'rotate-180' : ''" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" d="m19 9-7 7-7-7"/>
          </svg>
          <span class="min-w-0 break-words">自检记录（{{ diagnostics.length }}）</span>
          <span v-if="diagnostics.length" class="min-w-0 break-words text-slate-700">· 最近：{{ formatRelativeTime(diagnostics[0]?.createdAt) }}</span>
        </button>
        <div v-if="showDiagPanel" class="pb-3 grid gap-3 lg:grid-cols-2 max-h-56 overflow-y-auto scrollbar">
          <div
            v-for="diag in diagnostics"
            :key="diag.id"
            class="rounded-xl border border-slate-700/60 bg-slate-900/60 px-3 py-2"
          >
            <div class="text-[11px] text-slate-500 mb-1">{{ formatRelativeTime(diag.createdAt) }}</div>
            <pre class="whitespace-pre-wrap text-slate-300 text-[10px]">{{ JSON.stringify(diag.payload, null, 2) }}</pre>
          </div>
          <div v-if="!diagnostics.length" class="text-[11px] text-slate-600 px-3 py-2">暂无记录</div>
        </div>
      </div>
    </div>

    <!-- ── Modal 弹窗 ──────────────────────────────────────── -->
    <transition name="modal">
      <div v-if="modal.show" class="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
        <div class="absolute inset-0 bg-slate-950/80 backdrop-blur-sm" @click="modalCancel"></div>
        <div class="relative w-full max-w-sm mx-4 mb-4 sm:mb-0 glass rounded-2xl p-6 space-y-4 shadow-2xl">
          <h3 class="text-base font-semibold">{{ modal.title }}</h3>
          <p v-if="modal.message" class="text-sm text-slate-400">{{ modal.message }}</p>
          <textarea
            v-if="modal.multiline"
            v-model="modal.inputVal"
            rows="5"
            class="w-full rounded-xl bg-slate-900/60 border border-slate-700 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/60 resize-none"
            :placeholder="modal.placeholder"
          ></textarea>
          <input
            v-else-if="!modal.confirmOnly"
            ref="modalInputRef"
            v-model="modal.inputVal"
            type="text"
            class="w-full rounded-xl bg-slate-900/60 border border-slate-700 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-cyan-400/60"
            :placeholder="modal.placeholder"
            @keydown.enter="modalConfirm"
          />
          <div class="flex gap-2 justify-end pt-1">
            <button
              class="rounded-xl border border-slate-700 px-4 py-2.5 text-sm hover:border-slate-500 hover:bg-slate-800/60 active:scale-95 transition"
              @click="modalCancel"
            >取消</button>
            <button
              class="rounded-xl px-4 py-2.5 text-sm font-semibold active:scale-95 transition"
              :class="modal.danger ? 'bg-rose-500 text-white hover:bg-rose-400' : 'bg-cyan-500 text-slate-900 hover:bg-cyan-400'"
              @click="modalConfirm"
            >{{ modal.confirmLabel || '确定' }}</button>
          </div>
        </div>
      </div>
    </transition>

  </div>
</template>

<script setup>
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue';
import { io } from 'socket.io-client';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({
  breaks: true
});
DOMPurify.setConfig({
  ADD_TAGS: ['img'],
  ADD_ATTR: ['target', 'rel', 'class']
});
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'A') {
    node.setAttribute('rel', 'noopener noreferrer');
  }
  if (node.tagName === 'IMG') {
    const src = node.getAttribute('src') || '';
    const allowed = src.startsWith('http') || src.startsWith('/uploads/') || src.startsWith('data:image/');
    if (!allowed) node.removeAttribute('src');
  }
});

const appVersion = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : 'dev';
const buildTimeRaw = typeof __BUILD_TIME__ !== 'undefined' ? __BUILD_TIME__ : '';
const gitCommit = typeof __GIT_COMMIT__ !== 'undefined' ? __GIT_COMMIT__ : 'nogit';
const buildTimeShort = computed(() => {
  if (!buildTimeRaw) return '';
  const date = new Date(buildTimeRaw);
  if (Number.isNaN(date.getTime())) return buildTimeRaw;
  const pad2 = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
});
const buildLabel = computed(() => {
  const parts = [`v${appVersion}`];
  if (buildTimeShort.value) parts.push(buildTimeShort.value);
  if (gitCommit && gitCommit !== 'nogit') parts.push(`#${gitCommit}`);
  return parts.join(' · ');
});

const token = ref(localStorage.getItem('authToken') || '');
const sessions = ref([]);
const currentSessionId = ref(null);
const messages = ref([]);
const summary = ref('');
const summaryUpdatedAt = ref(null);
const input = ref('');
const status = ref('请先保存 Token');
const queueLength = ref(0);
const agentStatus = ref('offline');
const socketConnected = ref(false);
const sending = ref(false);
const lastTaskStatus = ref('');
const lastTaskAt = ref(null);
const agentInfo = ref(null);
const diagnostics = ref([]);
const search = ref('');
const showSidebar = ref(true);
const showSettings = ref(false);
const showDiagPanel = ref(false);
const streamState = ref(null); // { taskId, content, displayed, reasoning }
const attachments = ref([]);
const uploading = ref(false);
let _streamTimer = null;

function _tickStream() {
  const s = streamState.value;
  if (!s) { clearInterval(_streamTimer); _streamTimer = null; return; }
  if (s.displayed.length < s.content.length) {
    s.displayed = s.content.slice(0, s.displayed.length + s._rate);
    scrollToBottom();
  }
}

function clearStreamState() {
  if (_streamTimer) { clearInterval(_streamTimer); _streamTimer = null; }
  streamState.value = null;
}

function _finishStream() {
  // instantly complete any remaining chars, then keep visible until message:new
  const s = streamState.value;
  if (s) s.displayed = s.content;
  if (_streamTimer) { clearInterval(_streamTimer); _streamTimer = null; }
}

const textareaRef = ref(null);
const fileInputRef = ref(null);
const modalInputRef = ref(null);

// Modal 系统（替代 window.prompt / window.confirm）
const modal = ref({
  show: false, title: '', message: '', placeholder: '', inputVal: '',
  multiline: false, confirmOnly: false, danger: false, confirmLabel: '确定',
  resolve: null
});

function showModal(options) {
  return new Promise((resolve) => {
    modal.value = {
      show: true,
      title: options.title || '',
      message: options.message || '',
      placeholder: options.placeholder || '',
      inputVal: options.defaultValue || '',
      multiline: options.multiline || false,
      confirmOnly: options.confirmOnly || false,
      danger: options.danger || false,
      confirmLabel: options.confirmLabel || '确定',
      resolve
    };
    if (!options.confirmOnly && !options.multiline) {
      nextTick(() => modalInputRef.value?.focus());
    }
  });
}
function modalConfirm() {
  if (!modal.value.show) return;
  const val = modal.value.confirmOnly ? true : modal.value.inputVal;
  modal.value.show = false;
  modal.value.resolve?.(val);
}
function modalCancel() {
  if (!modal.value.show) return;
  modal.value.show = false;
  modal.value.resolve?.(null);
}

let socket = null;
let typingTimers = new Map();
const messageIdSet = new Set();
const pendingTaskIds = new Set();

const currentSession = computed(() => sessions.value.find((s) => s.id === currentSessionId.value));
const filteredSessions = computed(() => {
  if (!search.value.trim()) return sessions.value;
  const key = search.value.toLowerCase();
  return sessions.value.filter((s) => s.title.toLowerCase().includes(key));
});
const canSend = computed(() => !sending.value
  && socketConnected.value
  && !!currentSessionId.value
  && !uploading.value
  && (!!input.value.trim() || attachments.value.length > 0));
const agentProcessing = computed(() => lastTaskStatus.value === 'claimed');
const statusDisplay = computed(() => {
  if (!token.value) return '请先配置 Token';
  if (!socketConnected.value) return '未连接';
  if (uploading.value) return '上传中...';
  if (sending.value) return '发送中...';
  return status.value;
});

function formatTime(value) {
  if (!value) return '';
  return new Date(value).toLocaleString();
}

function formatRelativeTime(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return new Date(value).toLocaleDateString();
}

function formatDuration(ms) {
  if (ms === null || ms === undefined) return '';
  const value = Number(ms);
  if (!Number.isFinite(value)) return '';
  if (value < 1000) return `${Math.max(0, Math.round(value))} ms`;
  if (value < 10000) return `${(value / 1000).toFixed(2)} s`;
  return `${(value / 1000).toFixed(1)} s`;
}

function saveToken() {
  localStorage.setItem('authToken', token.value);
  status.value = 'Token 已保存';
  init();
}

async function request(path, options = {}) {
  if (!token.value) throw new Error('缺少 Token');
  const headers = Object.assign({
    'Content-Type': 'application/json',
    'x-auth-token': token.value
  }, options.headers || {});

  const response = await fetch(path, {
    ...options,
    headers
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }

  return response.json();
}

async function uploadImage(file) {
  if (!token.value) throw new Error('缺少 Token');
  const form = new FormData();
  form.append('file', file);
  const response = await fetch('/upload', {
    method: 'POST',
    headers: { 'x-auth-token': token.value },
    body: form
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `HTTP ${response.status}`);
  }
  const data = await response.json();
  return data.url;
}

function refreshUploading() {
  uploading.value = attachments.value.some((item) => item.uploading);
}

function addAttachment(file) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const previewUrl = URL.createObjectURL(file);
  const item = {
    id,
    name: file.name,
    previewUrl,
    url: '',
    uploading: true,
    error: ''
  };
  attachments.value.push(item);
  refreshUploading();
  return item;
}

async function startUpload(file) {
  const item = addAttachment(file);
  try {
    const url = await uploadImage(file);
    item.url = url;
    item.uploading = false;
    item.error = '';
    status.value = '图片已上传';
  } catch (error) {
    item.uploading = false;
    item.error = error.message || '上传失败';
    status.value = `上传失败：${item.error}`;
  } finally {
    refreshUploading();
  }
}

function removeAttachment(id) {
  const idx = attachments.value.findIndex((item) => item.id === id);
  if (idx === -1) return;
  const item = attachments.value[idx];
  if (item?.previewUrl) {
    try { URL.revokeObjectURL(item.previewUrl); } catch (_) {}
  }
  attachments.value.splice(idx, 1);
  refreshUploading();
}

function insertAtCursor(text) {
  const el = textareaRef.value;
  if (!el) {
    input.value += text;
    return;
  }
  const start = el.selectionStart ?? input.value.length;
  const end = el.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  nextTick(() => {
    el.focus();
    const pos = start + text.length;
    el.setSelectionRange(pos, pos);
    autoResize();
  });
}

function openImagePicker() {
  if (!socketConnected.value || !currentSessionId.value) {
    status.value = '请先连接并选择会话';
    return;
  }
  fileInputRef.value?.click();
}

async function handleImageChange(event) {
  const file = event?.target?.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (!file.type || !file.type.startsWith('image/')) {
    status.value = '仅支持图片文件';
    return;
  }
  status.value = '上传中...';
  startUpload(file);
}

function handlePaste(event) {
  const items = event?.clipboardData?.items || [];
  const images = [];
  for (const item of items) {
    if (item.type && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) images.push(file);
    }
  }
  if (!images.length) return;
  event.preventDefault();
  status.value = '上传中...';
  images.forEach((file) => startUpload(file));
}

function connectSocket() {
  if (socket) {
    socket.disconnect();
  }
  socket = io('/', {
    auth: { token: token.value, role: 'frontend' },
    transports: ['websocket']
  });

  socket.on('connect', () => {
    socketConnected.value = true;
    status.value = '已连接 WebSocket';
    clearStreamState();
    if (currentSessionId.value) {
      socket.emit('session:subscribe', currentSessionId.value);
    }
    socket.emit('agent:request-info');
    loadMessages({ reset: true, typewriter: false });
  });

  socket.on('disconnect', () => {
    socketConnected.value = false;
    status.value = '连接已断开，正在等待重连';
  });

  socket.on('connect_error', (error) => {
    status.value = `WebSocket 连接失败：${error.message || '未知错误'}`;
  });

  socket.on('agent:status', (payload) => {
    agentStatus.value = payload.status;
    queueLength.value = payload.queueLength;
  });

  socket.on('queue:update', (payload) => {
    queueLength.value = payload.queueLength;
  });

  socket.on('agent:info', (payload) => {
    agentInfo.value = payload.info;
  });

  socket.on('agent:diagnostics', (payload) => {
    diagnostics.value = [payload.entry, ...diagnostics.value].slice(0, 20);
  });

  socket.on('message:new', (message) => {
    if (message.sessionId !== currentSessionId.value) return;
    appendMessage(message, { typewriter: message.role === 'assistant' });
  });

  socket.on('message:stream', (payload) => {
    if (!payload?.taskId) return;
    if (payload.sessionId !== currentSessionId.value) return;
    if (!streamState.value || streamState.value.taskId !== payload.taskId) {
      streamState.value = { taskId: payload.taskId, content: '', displayed: '', reasoning: '', _rate: 1 };
    }
    if (payload.type === 'reasoning') {
      streamState.value.reasoning = payload.chunk;
    } else if (payload.type === 'response') {
      streamState.value.reasoning = ''; // 有回复时清除思考
      streamState.value.content += payload.chunk;
      // 计算打字速率：目标在 2~5 秒内打完
      // 短文(≤60字): 目标2s；长文最慢5s；30ms/tick
      const len = streamState.value.content.length;
      const targetMs = Math.min(5000, Math.max(2000, len * 25));
      const ticks = targetMs / 30;
      streamState.value._rate = Math.max(1, Math.ceil(len / ticks));
      // 启动打字机（已启动则复用）
      if (!_streamTimer) {
        _streamTimer = setInterval(_tickStream, 30);
      }
    }
    scrollToBottom();
  });

  socket.on('task:status', (payload) => {
    if (!payload) return;
    lastTaskStatus.value = payload.status || '';
    lastTaskAt.value = new Date().toISOString();
    if (payload.status === 'claimed') {
      status.value = '任务处理中...';
    } else if (payload.status === 'completed') {
      status.value = '任务完成';
      if (payload.id && pendingTaskIds.has(payload.id)) {
        pendingTaskIds.delete(payload.id);
        loadMessages({ reset: false, typewriter: true });
      }
    }
  });

  socket.on('summary:update', (payload) => {
    if (payload.sessionId !== currentSessionId.value) return;
    summary.value = payload.summary || '';
    summaryUpdatedAt.value = payload.updatedAt || null;
  });
}

async function init() {
  if (!token.value) return;
  await loadSessions();
  connectSocket();
}

async function loadSessions() {
  try {
    const data = await request('/sessions');
    sessions.value = data.sessions;
    if (!currentSessionId.value && sessions.value.length) {
      await selectSession(sessions.value[0].id);
    }
    status.value = '已加载会话';
  } catch (error) {
    status.value = `加载会话失败：${error.message}`;
  }
}

async function selectSession(id) {
  currentSessionId.value = id;
  clearStreamState();
  if (socketConnected.value) {
    socket.emit('session:subscribe', id);
  }
  await loadMessages({ reset: true, typewriter: false });
  await refreshTaskStatus();
  if (window.innerWidth < 1024) {
    showSidebar.value = false;
  }
}

async function loadMessages(options = {}) {
  if (!currentSessionId.value) return;
  const reset = options.reset === true;
  const typewriter = options.typewriter === true;
  try {
    const data = await request(`/sessions/${currentSessionId.value}/messages`);
    summary.value = data.summary || '';
    summaryUpdatedAt.value = data.summaryUpdatedAt || null;
    if (reset) {
      typingTimers.forEach((timer) => clearInterval(timer));
      typingTimers.clear();
      messageIdSet.clear();
      messages.value = [];
    }
    let appended = 0;
    data.messages.forEach((message) => {
      if (messageIdSet.has(message.id)) return;
      appendMessage(message, { typewriter: typewriter && message.role === 'assistant' });
      appended += 1;
    });
    if (reset || appended) {
      await scrollToBottom();
    }
  } catch (error) {
    status.value = `加载消息失败：${error.message}`;
  }
}

async function refreshTaskStatus() {
  if (!token.value) return;
  if (!currentSessionId.value) {
    lastTaskStatus.value = '';
    lastTaskAt.value = null;
    return;
  }
  try {
    const data = await request(`/sessions/${currentSessionId.value}/task-status`);
    const task = data?.task || null;
    if (task && task.status && task.status !== 'completed') {
      lastTaskStatus.value = task.status;
      lastTaskAt.value = task.startedAt || task.createdAt || null;
      return;
    }
    lastTaskStatus.value = '';
    lastTaskAt.value = null;
  } catch (error) {
    console.warn('刷新任务状态失败', error);
  }
}

function appendMessage(message, options = {}) {
  if (!message || !message.id) return;
  if (messageIdSet.has(message.id)) return;
  messageIdSet.add(message.id);
  // 若该消息已通过流式渲染过，先把剩余字符打完再切换，避免跳变
  const wasStreamed = message.taskId && streamState.value?.taskId === message.taskId;
  if (wasStreamed) {
    _finishStream();
    // 短暂延迟让最后一帧渲染后再替换为正式气泡
    setTimeout(() => { streamState.value = null; }, 50);
  }
  const shouldTypewriter = !wasStreamed && options.typewriter === true;
  const entry = {
    ...message,
    _display: message.role === 'assistant' && shouldTypewriter ? '' : message.content
  };
  messages.value.push(entry);
  if (message.role === 'assistant' && shouldTypewriter) {
    startTypewriter(entry);
  } else {
    scrollToBottom();
  }
}

function startTypewriter(message) {
  if (typingTimers.has(message.id)) {
    clearInterval(typingTimers.get(message.id));
  }
  const content = message.content || '';
  const id = message.id;
  let index = 0;
  const timer = setInterval(() => {
    index += Math.max(1, Math.floor(content.length / 120));
    // 必须通过 messages.value 找到响应式 Proxy 版本再修改，
    // 否则 Vue 3 无法侦测直接对原始对象的属性赋值
    const entry = messages.value.find((m) => m.id === id);
    if (entry) {
      entry._display = content.slice(0, index);
    }
    if (index >= content.length) {
      clearInterval(timer);
      typingTimers.delete(id);
    }
    scrollToBottom();
  }, 24);
  typingTimers.set(message.id, timer);
}

function escapeHtml(text) {
  return (text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function renderMarkdownText(text) {
  const html = marked.parse(text || '');
  return DOMPurify.sanitize(html);
}

function renderMarkdown(message) {
  const raw = message._display ?? message.content ?? '';
  if (message.role === 'user') {
    // 用户消息：允许 markdown，但不允许原始 HTML 直接渲染
    return renderMarkdownText(escapeHtml(raw));
  }
  return renderMarkdownText(raw);
}

async function scrollToBottom() {
  await nextTick();
  const box = messageBox.value;
  if (box) {
    box.scrollTop = box.scrollHeight;
  }
}

async function createSession() {
  try {
    const data = await request('/sessions', { method: 'POST' });
    sessions.value.unshift(data.session);
    await selectSession(data.session.id);
  } catch (error) {
    status.value = `创建会话失败：${error.message}`;
  }
}

async function editSessionTitle() {
  if (!currentSession.value) return;
  const title = await showModal({
    title: '重命名会话',
    placeholder: '新的会话标题',
    defaultValue: currentSession.value.title
  });
  if (!title) return;
  try {
    const data = await request(`/sessions/${currentSession.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title })
    });
    const idx = sessions.value.findIndex((s) => s.id === data.session.id);
    if (idx !== -1) sessions.value.splice(idx, 1, data.session);
  } catch (error) {
    status.value = `更新失败：${error.message}`;
  }
}

async function editSystemPrompt() {
  if (!currentSession.value) return;
  const systemPrompt = await showModal({
    title: '系统提示词',
    placeholder: '输入系统提示词...',
    defaultValue: currentSession.value.systemPrompt || '',
    multiline: true
  });
  if (systemPrompt === null) return;
  try {
    const data = await request(`/sessions/${currentSession.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ systemPrompt })
    });
    const idx = sessions.value.findIndex((s) => s.id === data.session.id);
    if (idx !== -1) sessions.value.splice(idx, 1, data.session);
  } catch (error) {
    status.value = `更新失败：${error.message}`;
  }
}

async function archiveSession() {
  if (!currentSession.value) return;
  const ok = await showModal({
    title: '确认归档',
    message: '归档后该会话将从列表中移除，确认吗？',
    confirmOnly: true,
    danger: true,
    confirmLabel: '归档'
  });
  if (!ok) return;
  try {
    await request(`/sessions/${currentSession.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ archived: true })
    });
    sessions.value = sessions.value.filter((s) => s.id !== currentSessionId.value);
    currentSessionId.value = sessions.value[0]?.id || null;
    messages.value = [];
    summary.value = '';
    summaryUpdatedAt.value = null;
    if (currentSessionId.value) {
      await loadMessages();
    }
  } catch (error) {
    status.value = `归档失败：${error.message}`;
  }
}

function handleKeydown(event) {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    sendMessage();
  }
}

function autoResize() {
  const el = textareaRef.value;
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = Math.min(el.scrollHeight, 160) + 'px';
}

async function refreshOnFocus() {
  if (!token.value) return;
  if (!socket) {
    connectSocket();
  } else if (!socketConnected.value) {
    socket.connect();
  } else if (currentSessionId.value) {
    socket.emit('session:subscribe', currentSessionId.value);
  }
  clearStreamState();
  lastTaskStatus.value = '';
  lastTaskAt.value = null;
  if (currentSessionId.value) {
    await loadMessages({ reset: true, typewriter: false });
    await refreshTaskStatus();
  } else {
    await loadSessions();
    await refreshTaskStatus();
  }
}

async function sendMessage() {
  if (!input.value.trim() && attachments.value.length === 0) {
    status.value = '请输入内容';
    return;
  }
  if (uploading.value) {
    status.value = '请等待图片上传完成';
    return;
  }
  if (!currentSessionId.value) {
    status.value = '请先创建会话';
    return;
  }
  let content = input.value.trim();
  const imageMarkdown = attachments.value
    .filter((item) => item.url)
    .map((item) => `![${item.name}](${item.url})`)
    .join('\n');
  if (content && imageMarkdown) {
    content = `${content}\n\n${imageMarkdown}`;
  } else if (!content && imageMarkdown) {
    content = imageMarkdown;
  }
  input.value = '';
  attachments.value.forEach((item) => {
    if (item.previewUrl) {
      try { URL.revokeObjectURL(item.previewUrl); } catch (_) {}
    }
  });
  attachments.value = [];
  refreshUploading();

  if (!socketConnected.value) {
    status.value = 'WebSocket 未连接';
    return;
  }

  sending.value = true;
  status.value = '发送中...';
  socket.emit('message:send', { sessionId: currentSessionId.value, content }, (ack) => {
    sending.value = false;
    if (!ack?.ok) {
      status.value = `发送失败：${ack?.error || '未知错误'}`;
      return;
    }
    if (ack.message) {
      appendMessage(ack.message);
    }
    if (ack.task?.id) {
      pendingTaskIds.add(ack.task.id);
    }
    status.value = '已发送';
  });
}

function requestAgentInfo() {
  if (!socketConnected.value) return;
  socket.emit('agent:request-info');
}

function runDiagnostics() {
  if (!socketConnected.value) return;
  socket.emit('agent:run-diagnostics');
}

const messageBox = ref(null);

function handleResize() {
  if (window.innerWidth >= 1024) {
    showSidebar.value = true;
  }
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    refreshOnFocus();
  }
}

onMounted(() => {
  if (window.innerWidth < 1024) {
    showSidebar.value = false;
  }
  window.addEventListener('resize', handleResize);
  window.addEventListener('focus', refreshOnFocus);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  if (token.value) {
    init();
  }
});

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize);
  window.removeEventListener('focus', refreshOnFocus);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  clearStreamState();
});
</script>

<style scoped>
.glass {
  background: rgba(6, 10, 20, 0.80);
  border: 1px solid rgba(148, 163, 184, 0.12);
  box-shadow: 0 20px 48px rgba(0, 0, 0, 0.45), inset 0 1px 0 rgba(255,255,255,0.04);
  backdrop-filter: blur(20px);
  -webkit-backdrop-filter: blur(20px);
}

/* 自定义细滚动条 */
.scrollbar::-webkit-scrollbar { width: 4px; height: 4px; }
.scrollbar::-webkit-scrollbar-track { background: transparent; }
.scrollbar::-webkit-scrollbar-thumb { background: rgba(100,116,139,0.35); border-radius: 2px; }
.scrollbar::-webkit-scrollbar-thumb:hover { background: rgba(100,116,139,0.6); }

/* 安全区 padding */
.input-safe-bottom { padding-bottom: max(12px, env(safe-area-inset-bottom)); }

/* 流式输出光标闪烁 */
@keyframes blink {
  0%, 100% { opacity: 1; }
  50% { opacity: 0; }
}
.stream-cursor { animation: blink 0.9s ease-in-out infinite; }

/* 打字机 loading 动画 */
@keyframes typing {
  0%, 60%, 100% { transform: translateY(0); opacity: 0.4; }
  30% { transform: translateY(-4px); opacity: 1; }
}
.typing-dot { animation: typing 1.2s ease-in-out infinite; }

/* 消息入场动画 */
@keyframes msgFadeIn {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: translateY(0); }
}
.msg-fade-in { animation: msgFadeIn 0.2s ease-out; }

/* GitHub Markdown body */
.markdown-body {
  background: transparent;
  font-size: 13px;
  line-height: 1.6;
}

/* 解决列表样式被全局样式重置的问题（scoped 需要 :deep） */
:deep(.markdown-body ul) {
  list-style: disc;
  padding-left: 1.25rem;
}
:deep(.markdown-body ol) {
  list-style: decimal;
  padding-left: 1.25rem;
}
:deep(.markdown-body li) {
  margin: 0.2em 0;
}

/* Fade transition（遮罩层） */
.fade-enter-active, .fade-leave-active { transition: opacity 0.2s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

/* Modal transition */
.modal-enter-active { transition: opacity 0.2s ease; }
.modal-leave-active { transition: opacity 0.15s ease; }
.modal-enter-from, .modal-leave-to { opacity: 0; }
</style>
