/**
 * dsh-night-museum — shared constants and small helpers.
 */

import os from 'node:os'
import path from 'node:path'

export const ROUTE = {
  state: '/api/night-museum/state',
  sessions: '/api/night-museum/sessions',
  exhibit: '/api/night-museum/exhibit',
  run: '/api/night-museum/run',
  createSession: '/api/night-museum/session',
}

export const STATUSES = new Set(['pending', 'running', 'done', 'failed', 'stopped', 'blocked'])
export const MAX_TITLE = 80
export const MAX_PROMPT = 20000
export const RUN_HARD_DEADLINE_MS = 3 * 60 * 60 * 1000
export const WAIT_SLICE_MS = 5 * 60 * 1000
export const POLL_MS = 450

export function dshHome() {
  const fromEnv = process.env.DSH_HOME
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return fromEnv.trim()
  return path.join(os.homedir(), '.dsh')
}

export function todayKey(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

export function isPeak(date = new Date()) {
  const day = date.getDay()
  if (day < 1 || day > 5) return false
  const minutes = date.getHours() * 60 + date.getMinutes()
  return (minutes >= 9 * 60 && minutes < 12 * 60) || (minutes >= 14 * 60 && minutes < 18 * 60)
}

export function text(value, max) {
  return String(value ?? '').trim().slice(0, max)
}

export function oneLine(value, max) {
  return text(String(value ?? '').replace(/\s+/g, ' '), max)
}

export function describeError(error) {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 180 ? `${message.slice(0, 177)}…` : message
}

export function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

export function fail(message, status = 400) {
  return jsonResponse({ ok: false, error: message }, status)
}

export function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('aborted'))
      return
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort)
      resolve()
    }, ms)
    function onAbort() {
      clearTimeout(timer)
      reject(signal.reason ?? new Error('aborted'))
    }
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

export function sessionTitle(summary) {
  const title = summary?.projections?.values?.title
  if (typeof title === 'string' && title.trim() !== '') return oneLine(title, 48)
  if (summary?.blank) return '空白会话'
  return '未命名会话'
}
