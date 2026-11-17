import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './style.css';
import { usePomodoro, PomodoroPanel, PomodoroSwitch, PomodoroBreakdown } from './Pomodoro.jsx';
import CalendarPublish from './CalendarPublish.jsx';
import { EventCopyPreview } from './EventCopy.jsx';
import ReviewCard from './ReviewCard.jsx';
import useReminders from './useReminders.jsx';
import { touchDragRecently } from './useEventGesture.jsx';
import { localDateKey } from './mood-data.mjs';
import CalendarEvent from './CalendarEvent.jsx';
import EventModal from './EventModal.jsx';
import { occursInWeek } from './calendar-occurrences.mjs';
import { eventCopyPayload } from './event-copy.mjs';
import CalendarSubscriptions, { SubscriptionEvent } from './CalendarSubscriptions.jsx';
import { DeadlineList, DeadlineBadge, DeadlineModal, DeadlineTimeMarkers } from './Deadlines.jsx';
import { deadlineTimeRange } from './deadline-layout.mjs';
import LayerControls from './LayerControls.jsx';
import TimelineZoom from './TimelineZoom.jsx';
import CalendarView from './CalendarView.jsx';
import { pointerMinute } from './timeline-zoom.mjs';
import { createHistory, eventSnapshot } from './history.mjs';
import { parseScheduleCsv, weekCopyPayloads } from './csv-schedule.mjs';
import { readLayerView, LAYER_VIEW_KEY, toggleVisibleLayer, selectEditingLayer, layoutDayEvents, fillBackground } from './layer-layout.mjs';

const API = (import.meta.env?.VITE_API_BASE_URL || import.meta.env?.VITE_API_BASE || '/api').replace(/\/$/, '');
const DAYS = ['周一', '周二', '周三', '周四', '周五', '周六', '周日'];
const DAY_START = 360;
const DAY_END = 1380;
const CELL_MIN = 10;
const CELL_H = 12;
const GRID_COLUMNS = 3;

export function gridNavigationIndex(index, key, total, columns = GRID_COLUMNS) {
  const row = Math.floor(index / columns);
  const column = index % columns;
  if (key === 'ArrowRight') return column + 1 < columns ? index + 1 : index;
  if (key === 'ArrowLeft') return column > 0 ? index - 1 : index;
  if (key === 'ArrowDown') return row + 1 < Math.ceil(total / columns) ? Math.min(total - 1, index + columns) : index;
  if (key === 'ArrowUp') return row > 0 ? index - columns : index;
  if (key === 'Home') return row * columns;
  if (key === 'End') return Math.min(total - 1, row * columns + columns - 1);
  return index;
}

const LAYERS = [
  { id: 'fixed', label: '每周固定', color: '#3D7695' },
  { id: 'flex', label: '预估', color: '#DBB355' },
  { id: 'once', label: '一次性', color: '#C85E3D' },
  { id: 'actual', label: '实际', color: '#5A8A8E' },
];
const CATS = [
  { id: 'class', label: '校内课程', color: '#3D7695', fill: '#E3ECF2' },
  { id: 'inhw', label: '课内作业', color: '#9BAF80', fill: '#EDF2E6' },
  { id: 'study', label: '课外作业', color: '#DBB355', fill: '#F5ECD0' },
  { id: 'work', label: '工作', color: '#6A4BD7', fill: '#ECE8FA' },
  { id: 'meeting', label: '校内会议', color: '#C85E3D', fill: '#F2DDD5' },
  { id: 'sport', label: '运动', color: '#5A8A8E', fill: '#E4EEEE' },
  { id: 'leisure', label: '休闲', color: '#A585A8', fill: '#F2EAF2' },
  { id: 'meal', label: '餐饮', color: '#DFC7B4', fill: '#F6EDE5' },
  { id: 'other', label: '其他', color: '#9A948A', fill: '#ECE9E2' },
];
const TEMPLATES = [
  { id: 'exam', title: '考试周', description: '把复习、作业和休息安排成一周节奏。', project: '期中考试复习', tasks: [['整理考试范围', 60, 1], ['完成错题回顾', 90, 2], ['模拟测试与复盘', 120, 1]] },
  { id: 'project', title: '个人项目', description: '从目标拆成可以直接放进时间轴的行动。', project: '个人项目冲刺', tasks: [['明确本周交付物', 45, 1], ['完成第一版', 120, 2], ['检查并发布', 60, 1]] },
  { id: 'weekly', title: '普通一周', description: '适合第一次使用，快速体验周计划流程。', project: '我的第一周', tasks: [['列出本周最重要的三件事', 45, 1], ['安排一段深度工作', 90, 2], ['周末复盘', 30, 3]] },
];
const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (mins) => `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
const parseTime = (value) => { const [h, m] = String(value || '00:00').split(':').map(Number); return (h || 0) * 60 + (m || 0); };
const startOfWeek = (value) => { const date = new Date(value); date.setHours(0, 0, 0, 0); date.setDate(date.getDate() - ((date.getDay() + 6) % 7)); return date; };
const addDays = (date, count) => { const next = new Date(date); next.setDate(next.getDate() + count); return next; };
const fmtDate = (date) => `${date.getMonth() + 1}/${date.getDate()}`;
const isoDate = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const weekNumber = (date) => { const target = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())); const day = target.getUTCDay() || 7; target.setUTCDate(target.getUTCDate() + 4 - day); const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1)); return Math.ceil((((target - yearStart) / 86400000) + 1) / 7); };
const weekKey = (date) => { const thursday = addDays(startOfWeek(date), 3); return `${thursday.getFullYear()}-W${pad(weekNumber(date))}`; };
const uid = (prefix = 'wb') => `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
const catById = (id) => CATS.find((cat) => cat.id === id) || CATS[CATS.length - 1];
const download = (content, filename, type) => { const url = URL.createObjectURL(new Blob([content], { type })); const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click(); setTimeout(() => URL.revokeObjectURL(url), 300); };
const tokenClaims = (value) => {
  try {
    const encoded = String(value || '').split('.')[1];
    if (!encoded) return null;
    const normalized = encoded.replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')));
  } catch { return null; }
};

function StarIcon() { return <svg className="doodle-star" viewBox="0 0 28 28" aria-hidden="true"><path d="M14 2l3.5 8.5 8.5.5-6.5 5.5 2.5 8.5-8-5.5-8 5.5L8.5 16 2 11l8.5-.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>; }

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('wb-token') || '');
  const [booting, setBooting] = useState(true);
  const [debugMode, setDebugMode] = useState(false);
  const [email, setEmail] = useState('');
  const [authMode, setAuthMode] = useState('login');
  const [password, setPassword] = useState('');
  const [projects, setProjects] = useState([]);
  const [project, setProject] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [events, setEvents] = useState([]);
  const [availability, setAvailability] = useState([]);
  const [review, setReview] = useState(null);
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [layerView, setLayerView] = useState(() => readLayerView(localStorage));
  const { visible: visibleLayers, active: activeLayer } = layerView;
  const setActiveLayer = useCallback((id) => setLayerView((current) => selectEditingLayer(current, id)), []);
  const toggleLayer = useCallback((id) => setLayerView((current) => toggleVisibleLayer(current, id)), []);
  useEffect(() => { try { localStorage.setItem(LAYER_VIEW_KEY, JSON.stringify(layerView)); } catch { /* Display preferences are optional when storage is unavailable. */ } }, [layerView]);
  const [statsLayer, setStatsLayer] = useState('actual');
  // Keep blank-cell clicks inert until the user explicitly chooses a paint color.
  // Double-clicking still creates a calendar event through the grid handler.
  const [activeCat, setActiveCat] = useState('erase');
  const [fills, setFills] = useState([]);

  const [inbox, setInbox] = useState([]);
  const [nightNotes, setNightNotes] = useState([]);
  const [deadlines, setDeadlines] = useState([]);
  const [deadlineId, setDeadlineId] = useState(null);
  const selectedDeadline = deadlines.find((item) => item.id === deadlineId);
  const [newTask, setNewTask] = useState('');
  const [newInbox, setNewInbox] = useState('');
  const [newProject, setNewProject] = useState('');
  const [projectDescription, setProjectDescription] = useState('');
  const [nightDraft, setNightDraft] = useState({ text: '', sleep: '23:30' });
  const [deadlineDraft, setDeadlineDraft] = useState({ text: '', kind: 'hw' });
  const [windowStart, setWindowStart] = useState('09:00');
  const [windowEnd, setWindowEnd] = useState('18:00');
  const [fixedDraft, setFixedDraft] = useState({ title: '', day: '周一', start: '12:00', end: '13:00' });
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [layerOpen, setLayerOpen] = useState(false);
  const [backupOpen, setBackupOpen] = useState(false);
  const [eventModal, setEventModal] = useState(null);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [planVersion, setPlanVersion] = useState(0);
  const [planFeedback, setPlanFeedback] = useState('');
  const [mobileDay, setMobileDay] = useState(() => (new Date().getDay() + 6) % 7);
  const [showGuide, setShowGuide] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [guideStep, setGuideStep] = useState(0);
  const overlayFocus = useRef(null);
  const [dataRevision, setDataRevision] = useState(0);
  const [toastAction, setToastAction] = useState(null);
  const notify = useCallback((message, action = null) => { setToast(message); setToastAction(action); window.clearTimeout(window.__wbToast); window.__wbToast = window.setTimeout(() => { setToast(''); setToastAction(null); }, action ? 7000 : 2600); }, []);
  const [inflight, setInflight] = useState(0);
  const [offline, setOffline] = useState(() => typeof navigator !== 'undefined' && navigator.onLine === false);
  useEffect(() => { const on = () => setOffline(false); const off = () => setOffline(true); window.addEventListener('online', on); window.addEventListener('offline', off); return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); }; }, []);
  const call = useCallback(async (path, options = {}) => {
    setInflight((count) => count + 1);
    try {
      const response = await fetch(`${API}${path}`, { ...options, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(options.headers || {}) } }).catch(() => { throw Object.assign(new Error('网络连接失败，请检查网络后重试'), { status: 0 }); });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw Object.assign(new Error(body.error || '请求失败'), { status: response.status });
      if (options.method && options.method !== 'GET') setDataRevision((value) => value + 1);
      return body;
    } finally { setInflight((count) => Math.max(0, count - 1)); }
  }, [token]);

  // ---- Undo / redo for calendar events --------------------------------------
  // Commands refer to events by a stable "logical" id. Undoing a delete recreates the
  // row under a new database id, so idAlias chains the deleted id to its replacement.
  const history = useRef(null);
  if (!history.current) history.current = createHistory();
  const idAlias = useRef(new Map());
  const [, setHistoryTick] = useState(0);
  const resolveId = (id) => { let current = id; const seen = new Set(); while (idAlias.current.has(current) && !seen.has(current)) { seen.add(current); current = idAlias.current.get(current); } return current; };
  const record = (command) => { history.current.push(command); setHistoryTick((value) => value + 1); };
  const parseExcluded = (value) => { try { const list = typeof value === 'string' ? JSON.parse(value) : value; return Array.isArray(list) ? list : []; } catch { return []; } };
  const patchEventById = async (id, patch) => { const realId = resolveId(id); const saved = await call(`/calendar/events/${realId}`, { method: 'PATCH', body: JSON.stringify(patch) }); setEvents((items) => items.map((item) => item.id === realId ? saved : item)); return saved; };
  const createEventFrom = async (payload, replacedId = null, excluded = []) => {
    let created = await call('/calendar/events', { method: 'POST', body: JSON.stringify(payload) });
    if (excluded.length) created = await call(`/calendar/events/${created.id}`, { method: 'PATCH', body: JSON.stringify({ excluded_weeks: excluded }) });
    if (replacedId != null && replacedId !== created.id) idAlias.current.set(replacedId, created.id);
    setEvents((items) => [...items.filter((item) => item.id !== created.id), created]);
    return created;
  };
  // Brings back a deleted row with every field it had (all-day, imported, deadline events).
  const restoreEventRow = async (row, replacedId) => {
    const created = await call('/calendar/events/restore', { method: 'POST', body: JSON.stringify(row) });
    if (replacedId != null && replacedId !== created.id) idAlias.current.set(replacedId, created.id);
    setEvents((items) => [...items.filter((item) => item.id !== created.id), created]);
    if (created.deadline_kind) setDeadlines(await call('/calendar/deadlines'));
    return created;
  };
  const removeEventById = async (id) => { const realId = resolveId(id); try { await call(`/calendar/events/${realId}?scope=all`, { method: 'DELETE' }); } catch (error) { if (error.status !== 404) throw error; } setEvents((items) => items.filter((item) => item.id !== realId)); };
  const undo = async () => { try { const command = await history.current.undo(); notify(command ? `已撤销：${command.label}` : '没有可撤销的操作'); } catch (error) { notify(`撤销失败：${error.message}`); } setHistoryTick((value) => value + 1); };
  const redo = async () => { try { const command = await history.current.redo(); notify(command ? `已重做：${command.label}` : '没有可重做的操作'); } catch (error) { notify(`重做失败：${error.message}`); } setHistoryTick((value) => value + 1); };
  const undoAction = { label: '撤销', run: undo };
  const pickFields = (source, patch) => Object.fromEntries(Object.keys(patch).map((key) => [key, source?.[key]]));
  const resizeOrigin = useRef(null);
  useEffect(() => {
    const onKey = (event) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      const target = event.target;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      const key = event.key.toLowerCase();
      if (key === 'z') { event.preventDefault(); if (event.shiftKey) redo(); else undo(); }
      else if (key === 'y') { event.preventDefault(); redo(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  const currentWeekKey = weekKey(weekStart);
  const reviewWeek = useRef(currentWeekKey); reviewWeek.current = currentWeekKey;
  const loadReview = useCallback(() => call(`/review?week_key=${reviewWeek.current}&today=${localDateKey(new Date())}`), [call]);
  const refresh = useCallback(async () => { const [projectRows, calendarRows, availabilityRows, reviewRow, deadlineRows] = await Promise.all([call('/projects'), call('/calendar'), call('/availability'), loadReview(), call('/calendar/deadlines')]); setProjects(projectRows); setProject((current) => current && projectRows.some((row) => row.id === current.id) ? current : (projectRows[0] || null)); setEvents(calendarRows); setAvailability(availabilityRows); setReview(reviewRow); setDeadlines(deadlineRows); const workWindow = availabilityRows.find((row) => row.kind === 'window'); if (workWindow) { setWindowStart(fmtTime(workWindow.start_minute)); setWindowEnd(fmtTime(workWindow.end_minute)); } }, [call, loadReview]);
  // Week changes and calendar edits both move the review numbers; a short delay keeps drag previews from spamming it.
  useEffect(() => { if (!token) return undefined; const timer = setTimeout(() => { loadReview().then(setReview).catch(() => {}); }, 400); return () => clearTimeout(timer); }, [token, currentWeekKey, events, loadReview]);
  const reminders = useReminders({ events, weekKeyOf: weekKey, days: DAYS, notify });
  const pomodoro = usePomodoro({ call, weekKey: currentWeekKey, revision: dataRevision, refresh, notify, active: Boolean(token) });
  const subscriptionChanged = useCallback(async (layer) => { await refresh(); setDataRevision((value) => value + 1); if (layer) { setActiveLayer(layer); setStatsLayer(layer); } }, [refresh]);
  const loadScratch = useCallback(async () => {
    try {
      const rows = await call("/workspace/scratch?week_key=" + encodeURIComponent(currentWeekKey));
      const parsed = { inbox: [], night: [], deadline: [], fill: [] };
      for (const row of rows) if (parsed[row.kind]) parsed[row.kind].push({ ...(row.payload || row), __scratchId: row.id, entity_key: row.entity_key || row.payload?.entity_key });
      setInbox(parsed.inbox); setNightNotes(parsed.night); setFills(parsed.fill);
    } catch { /* scratch API optional during migration */ }
  }, [call, currentWeekKey]);
  useEffect(() => { let active = true; if (token) { const claims = tokenClaims(token); const isDebug = claims?.email === 'debug@weeklyboard.local'; setDebugMode(isDebug); if (claims?.email) setEmail(claims.email); setBooting(false); refresh().catch((error) => { if (error?.status === 401 || error?.status === 403) { localStorage.removeItem('wb-token'); if (active) { setToken(''); setDebugMode(false); setEmail(''); } } else if (active) notify(`加载失败：${error.message}`, { label: '重试', run: () => refresh().catch((retryError) => notify(`加载失败：${retryError.message}`)) }); }); return () => { active = false; }; } fetch(`${API}/auth/debug`).then(async (response) => { if (!response.ok) throw new Error('debug disabled'); return response.json(); }).then((session) => { if (!active || !session.token) return; localStorage.setItem('wb-token', session.token); setToken(session.token); setDebugMode(Boolean(session.debugMode)); setEmail(session.user?.email || ''); }).catch(() => active && setBooting(false)); return () => { active = false; }; }, [token, refresh]);
  useEffect(() => { if (!project || !token) return; call(`/projects/${project.id}/tasks`).then(setTasks).catch(() => setTasks([])); }, [call, project, token]);
  useEffect(() => { if (token) loadScratch(); }, [token, loadScratch]);
  useEffect(() => { if (token && !booting && projects.length === 0) setShowTemplates(true); }, [token, booting, projects.length]);
  useEffect(() => {
    // Some of the paper-style sidebar controls intentionally use placeholder text
    // as their visual hint. Keep that hint, but give assistive technology a stable
    // name that does not disappear once the field contains text.
    const labels = new Map([
      ['添加一个任务…', '添加任务'],
      ['本周具体任务…', '任务备注'],
      ['记点什么…', '添加收件箱便签'],
      ['熬夜干了什么…', '熬夜记录内容'],
      ['什么要交 / 要考？', '截止提醒内容'],
      ['新项目名称…', '新项目名称'],
      ['目标与背景（可选）', '项目目标与背景'],
      ['想到什么就写下来…', '快速记录']
    ]);
    const controls = document.querySelectorAll('.sidebar input[placeholder], .sidebar textarea[placeholder], .sidebar select, .cal-view textarea[placeholder]');
    controls.forEach((control) => {
      if (control.closest('label') || control.hasAttribute('aria-label')) return;
      const label = labels.get(control.getAttribute('placeholder')) || (control.tagName === 'SELECT' ? '选择选项' : '输入内容');
      control.setAttribute('aria-label', label);
    });
    document.querySelectorAll('.event[tabindex="0"]').forEach((eventBlock) => {
      if (!eventBlock.hasAttribute('role')) eventBlock.setAttribute('role', 'button');
      if (!eventBlock.hasAttribute('aria-roledescription')) eventBlock.setAttribute('aria-roledescription', '日程');
    });
    const confirmButton = document.querySelector('.planner-panel .paper-btn.primary.small');
    if (confirmButton) {
      const ready = Boolean(window.__wbPlan?.blocks?.length);
      confirmButton.toggleAttribute('disabled', !ready);
      confirmButton.setAttribute('aria-disabled', String(!ready));
      confirmButton.setAttribute('aria-label', ready ? '确认并写入周看板' : '请先生成排程草案');
    }
  }, [token, projects.length, project?.id, calendarOpen, planVersion]);
  useEffect(() => {
    const sidebar = document.querySelector('.sidebar');
    if (!sidebar) return undefined;
    sidebar.id = 'weekSidebar';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mobile-sidebar-toggle';
    button.setAttribute('aria-controls', 'weekSidebar');
    const media = window.matchMedia('(max-width: 760px)');
    const sync = () => {
      const collapsed = sidebar.classList.contains('is-collapsed');
      button.setAttribute('aria-expanded', String(!collapsed));
      button.textContent = collapsed ? '☰ 展开侧栏' : '× 收起侧栏';
      if (!media.matches) sidebar.classList.remove('is-collapsed');
    };
    button.addEventListener('click', () => {
      sidebar.classList.toggle('is-collapsed');
      sync();
      if (!sidebar.classList.contains('is-collapsed')) sidebar.querySelector('input, button, textarea, select')?.focus();
    });
    document.body.append(button);
    media.addEventListener?.('change', sync);
    sync();
    return () => {
      media.removeEventListener?.('change', sync);
      button.remove();
    };
  }, [token]);
  useEffect(() => {
    const closeOverlays = (event) => {
      if (event.key !== 'Escape') return;
      if (deadlineId) return setDeadlineId(null);
      if (eventModal) return setEventModal(null);
      if (calendarOpen) return setCalendarOpen(false);
      if (layerOpen) return setLayerOpen(false);
      if (backupOpen) return setBackupOpen(false);
      if (showTemplates) return setShowTemplates(false);
      if (showGuide) return setShowGuide(false);
    };
    window.addEventListener('keydown', closeOverlays);
    return () => window.removeEventListener('keydown', closeOverlays);
  }, [backupOpen, calendarOpen, eventModal, layerOpen, deadlineId, showTemplates, showGuide]);
  useEffect(() => {
    const closePopoversOnOutsidePointer = (event) => {
      const target = event.target;
      if (backupOpen && !target.closest?.('.backup-wrap')) setBackupOpen(false);
      if (layerOpen && !target.closest?.('.layer-wrap')) setLayerOpen(false);
    };
    document.addEventListener('pointerdown', closePopoversOnOutsidePointer);
    return () => document.removeEventListener('pointerdown', closePopoversOnOutsidePointer);
  }, [backupOpen, layerOpen]);
  useEffect(() => {
    const updateGridTabStops = () => document.querySelectorAll('.grid-background').forEach((grid) => {
      const cells = [...grid.querySelectorAll('.cell10')];
      cells.forEach((cell, index) => { cell.tabIndex = index === 0 ? 0 : -1; });
    });
    const moveGridFocus = (event) => {
      const cell = event.target.closest?.('.cell10');
      if (!cell || !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
      const grid = cell.closest('.grid-background');
      if (!grid) return;
      const cells = [...grid.querySelectorAll('.cell10')];
      const currentIndex = cells.indexOf(cell);
      const nextIndex = gridNavigationIndex(currentIndex, event.key, cells.length);
      let targetGrid = grid;
      let targetIndex = nextIndex;
      if (nextIndex === currentIndex && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) {
        const grids = [...document.querySelectorAll('.grid-background')];
        const gridIndex = grids.indexOf(grid);
        const adjacentGrid = grids[gridIndex + (event.key === 'ArrowRight' ? 1 : -1)];
        if (adjacentGrid) {
          targetGrid = adjacentGrid;
          const adjacentCells = adjacentGrid.querySelectorAll('.cell10');
          targetIndex = event.key === 'ArrowRight' ? 0 : adjacentCells.length - 1;
        }
      }
      if (targetGrid === grid && targetIndex === currentIndex) return;
      event.preventDefault();
      document.querySelectorAll('.grid-background .cell10').forEach((item) => { item.tabIndex = -1; });
      const target = targetGrid.querySelectorAll('.cell10')[targetIndex];
      if (!target) return;
      target.tabIndex = 0;
      target.focus();
    };
    updateGridTabStops();
    document.addEventListener('keydown', moveGridFocus);
    return () => document.removeEventListener('keydown', moveGridFocus);
  }, [currentWeekKey, planVersion, visibleLayers.length]);
  const overlayOpen = Boolean(deadlineId || eventModal || calendarOpen || layerOpen || backupOpen || showTemplates || showGuide);
  useEffect(() => {
    if (overlayOpen && !overlayFocus.current) {
      overlayFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    }
    if (!overlayOpen && overlayFocus.current) {
      const trigger = overlayFocus.current;
      overlayFocus.current = null;
      if (document.contains(trigger)) trigger.focus();
    }
  }, [overlayOpen]);
  useEffect(() => {
    const trapOverlayFocus = (event) => {
      if (event.key !== 'Tab') return;
      const dialog = document.querySelector('[role="dialog"]:not([hidden]), dialog[open]');
      if (!dialog) return;
      const focusable = [...dialog.querySelectorAll('button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')];
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', trapOverlayFocus);
    return () => document.removeEventListener('keydown', trapOverlayFocus);
  }, []);
  const fixedRows = useMemo(() => availability.filter((row) => row.kind === 'fixed'), [availability]);
  const normalizedEvents = useMemo(() => events.filter((event) => occursInWeek(event, currentWeekKey)).map((event) => ({ ...event, layer: event.layer || 'actual', cat: event.category || event.cat || 'other', source: event.source || 'calendar' })), [events, currentWeekKey]);
  const visibleEvents = useMemo(() => {
    const fixed = fixedRows.map((row, index) => ({ id: `fixed-${index}-${row.day}-${row.start_minute}`, title: row.title || '固定事项', day: row.day, start_minute: row.start_minute, end_minute: row.end_minute, layer: 'fixed', cat: 'class', source: 'fixed', locked: 1 }));
    const planned = Array.isArray(window.__wbPlan?.blocks) ? window.__wbPlan.blocks.map((block, index) => ({ ...block, id: `plan-${block.draft_id || block.id || index}`, layer: 'flex', cat: block.category || block.cat || 'study', source: 'plan', title: block.title || block.task_title || '规划任务' })) : [];
    return [...fixed, ...normalizedEvents, ...planned].filter((event) => visibleLayers.includes(event.layer) && !event.deadline_kind);


  }, [visibleLayers, fixedRows, normalizedEvents, busy, planVersion, currentWeekKey]);
  const currentWeekDeadlines = deadlines.filter((item) => item.weekKey === currentWeekKey);
  const timelineDeadlines = currentWeekDeadlines.filter((item) => visibleLayers.length > 0 && (!item.layer || visibleLayers.includes(item.layer)));
  const timelineRange = deadlineTimeRange([...timelineDeadlines, ...visibleEvents.filter((event) => !event.all_day).flatMap((event) => [{ due_minute: Number(event.start_minute) }, { due_minute: Number(event.end_minute) - 1 }])], DAY_START, DAY_END);
  const currentWeekNights = nightNotes.filter((item) => item.weekKey === currentWeekKey);
  const stats = useMemo(() => { const totals = Object.fromEntries(CATS.map((cat) => [cat.id, 0])); (statsLayer === 'fixed' ? [...fixedRows, ...normalizedEvents.filter((event) => event.layer === 'fixed' && !event.all_day)] : normalizedEvents.filter((event) => event.layer === statsLayer && !event.all_day)).forEach((event) => { const cat = event.cat || event.category || 'other'; totals[cat in totals ? cat : 'other'] += Math.max(0, event.end_minute - event.start_minute); }); fills.filter((fill) => fill.weekKey === currentWeekKey && fill.layer === statsLayer).forEach((fill) => { totals[fill.cat] += CELL_MIN; }); return { totals, total: Object.values(totals).reduce((sum, value) => sum + value, 0) }; }, [currentWeekKey, fills, statsLayer, fixedRows, normalizedEvents]);
  const authenticate = async () => { try { const response = await fetch(`${API}/auth/${authMode === 'login' ? 'login' : 'register'}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) }); const body = await response.json(); if (!response.ok || !body.token) throw new Error(body.error || '认证失败'); localStorage.setItem('wb-token', body.token); setToken(body.token); setEmail(body.user?.email || email); } catch (error) { notify(error.message); } };
  const selectProject = async (row) => { setProject(row); try { setTasks(await call(`/projects/${row.id}/tasks`)); } catch { setTasks([]); } };
  const createProject = async () => { if (!newProject.trim()) return notify('先写项目名称'); try { const row = await call('/projects', { method: 'POST', body: JSON.stringify({ title: newProject.trim(), description: projectDescription.trim(), priority: 3 }) }); setProjects((items) => [row, ...items]); setProject(row); setTasks([]); setNewProject(''); setProjectDescription(''); notify('项目已写入 SQL'); } catch (error) { notify(error.message); } };
  const createTask = async (title = newTask, options = {}) => { if (!project) return notify('先选择项目'); if (!String(title).trim()) return notify('任务不能为空'); try { const row = await call(`/projects/${project.id}/tasks`, { method: 'POST', body: JSON.stringify({ title: String(title).trim(), estimate_minutes: options.estimate_minutes || 30, priority: options.priority || 3 }) }); setTasks((items) => [...items, row]); setNewTask(''); notify('任务已加入任务池'); return row; } catch (error) { notify(error.message); return null; } };
  const applyTemplate = async (template) => { setBusy(true); try { const createdProject = await call('/projects', { method: 'POST', body: JSON.stringify({ title: template.project, description: template.description, priority: 3 }) }); const createdTasks = []; for (const [title, estimate_minutes, priority] of template.tasks) createdTasks.push(await call(`/projects/${createdProject.id}/tasks`, { method: 'POST', body: JSON.stringify({ title, estimate_minutes, priority }) })); setProjects((items) => [createdProject, ...items]); setProject(createdProject); setTasks(createdTasks); setShowTemplates(false); setGuideStep(1); setShowGuide(true); notify(`已载入「${template.title}」示例`); } catch (error) { notify(`模板载入失败：${error.message}`); } finally { setBusy(false); } };
  const toggleTask = async (task) => { if (pomodoro.data?.rows.some((row) => row.task_id === task.id)) return pomodoro.complete(task, DAYS[(new Date().getDay() + 6) % 7]); try { const row = await call(`/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: task.status === 'done' ? 'todo' : 'done' }) }); setTasks((items) => items.map((item) => item.id === row.id ? row : item)); setReview(await loadReview()); } catch (error) { notify(error.message); } };
  const removeTask = async (task) => { try { await call(`/tasks/${task.id}`, { method: 'DELETE' }); setTasks((items) => items.filter((item) => item.id !== task.id)); notify('任务已删除'); } catch (error) { notify(error.message); } };
  const addInboxItem = async () => { if (!newInbox.trim()) return; const item = { id: uid('inbox'), text: newInbox.trim(), weekKey: currentWeekKey }; setInbox((items) => [item, ...items]); setNewInbox(''); const saved = await persistScratch('inbox', item); if (saved) setInbox((items) => items.map((row) => row.id === item.id ? { ...row, __scratchId: saved.id, entity_key: saved.entity_key } : row)); };
  const removeInbox = async (item) => { setInbox((items) => items.filter((row) => row.id !== item.id)); if (item.__scratchId) await persistScratch('scratch-delete', item); };
  const convertInbox = async (item) => { const task = await createTask(item.text); if (task) await removeInbox(item); };
  const persistScratch = useCallback(async (kind, payload) => {
    try {
      if (kind === 'scratch-delete' && (payload?.__scratchId || payload?.id || payload?.entity_key || payload?.key)) {
        const response = payload.__scratchId
          ? await call(`/workspace/scratch/${payload.__scratchId}`, { method: 'DELETE' })
          : await call(`/workspace/scratch?kind=${encodeURIComponent(payload.kind || 'fill')}&week_key=${encodeURIComponent(payload.weekKey || currentWeekKey)}&entity_key=${encodeURIComponent(payload.entity_key || payload.id || payload.key)}`, { method: 'DELETE' });
        return response;
      }
      return await call('/workspace/scratch', { method: 'PUT', body: JSON.stringify({ kind, week_key: currentWeekKey, entity_key: payload?.entity_key || payload?.id || payload?.key, payload }) });
    } catch (error) {
      notify(`草稿保存失败：${error.message}`);
      return null;
    }
  }, [call, currentWeekKey, notify]);
  const saveAvailability = async () => { const start = parseTime(windowStart); const end = parseTime(windowEnd); if (start >= end) return notify('时间窗口不合法'); const rows = DAYS.slice(0, 5).map((day) => ({ day, start_minute: start, end_minute: end, kind: 'window', title: '' })); try { await call('/availability', { method: 'PUT', body: JSON.stringify({ rows: [...rows, ...fixedRows] }) }); setAvailability([...rows, ...fixedRows]); notify('工作日窗口已保存'); } catch (error) { notify(error.message); } };
  const saveFixed = async () => { const start = parseTime(fixedDraft.start); const end = parseTime(fixedDraft.end); if (!fixedDraft.title.trim() || start >= end) return notify('固定事项和时间都要填完整'); const rows = [...availability.filter((row) => row.kind === 'window'), ...fixedRows, { day: fixedDraft.day, start_minute: start, end_minute: end, kind: 'fixed', title: fixedDraft.title.trim() }]; try { await call('/availability', { method: 'PUT', body: JSON.stringify({ rows }) }); setAvailability(rows); setFixedDraft((draft) => ({ ...draft, title: '' })); notify('固定事项已保存'); } catch (error) { notify(error.message); } };
  const makePlan = async (useAI) => { if (!project) return notify('先选择项目'); setBusy(true); try { const previous = window.__wbPlan?.blocks?.length && planFeedback.trim() ? { previous_blocks: window.__wbPlan.blocks.map(({ title, day, start_minute, end_minute }) => ({ title, day, start_minute, end_minute })), feedback: planFeedback.trim() } : {}; const input = useAI ? { project, tasks, week_key: currentWeekKey, start_minute: 540, day: '周一', today: localDateKey(new Date()), ...previous } : { tasks, week_key: currentWeekKey }; const result = await call(useAI ? '/plan/preview' : '/plan/deterministic', { method: 'POST', body: JSON.stringify(input) }); const blocks = (result.blocks || []).filter((block) => block && block.day && Number.isInteger(Number(block.start_minute)) && Number.isInteger(Number(block.end_minute)) && Number(block.start_minute) < Number(block.end_minute)).map((block) => ({ ...block, start_minute: Number(block.start_minute), end_minute: Number(block.end_minute), draft_id: block.draft_id || uid('draft') })); window.__wbPlan = { ...result, source: result.fallback ? 'fallback' : (result.source || (useAI ? 'deepseek' : 'local')), blocks, week_key: currentWeekKey, project_id: project.id, request_key: uid('plan') }; setPlanVersion((value) => value + 1); setActiveLayer('flex'); notify(result.fallback ? 'DeepSeek 暂不可用，已用本地排程生成草案' : (useAI && result.source !== 'local' ? 'DeepSeek 草案已生成，切到预估图层查看' : useAI ? '未配置 DeepSeek，已用本地排程生成草案' : '自动排程草案已生成')); } catch (error) { notify(error.message); } finally { setBusy(false); } };
  const confirmPlan = async () => { const plan = window.__wbPlan; if (!plan) return notify('先生成排程草案'); try { const knownIds = new Set(events.map((item) => item.id)); const result = await call('/plan/confirm', { method: 'POST', body: JSON.stringify(plan) }); const fresh = await call('/calendar'); setEvents(fresh); const added = fresh.filter((item) => !knownIds.has(item.id)); if (added.length) { const lids = added.map((item) => item.id); const snaps = added.map((item) => eventSnapshot(item)); record({ label: `确认 ${added.length} 个计划时间块`, undo: async () => { for (const lid of lids) await removeEventById(lid); }, redo: async () => { for (let index = 0; index < snaps.length; index += 1) await createEventFrom(snaps[index], resolveId(lids[index])); } }); } setReview(await loadReview()); setActiveLayer('flex'); window.__wbPlan = null; setPlanFeedback(''); setPlanVersion((value) => value + 1); setGuideStep(2); setShowGuide(true); notify(`已确认 ${result.created} 个时间块`, undoAction); } catch (error) { notify(error.message); } };
    const copyPlanToActual = async () => {
    const source = events.filter((item) => item.layer === 'flex' && occursInWeek(item, currentWeekKey) && !item.all_day && !item.subscription_id && !item.repeat_rule);
    const key = (item) => [item.title, item.day, item.start_minute, item.end_minute].join('|');
    const existing = new Set(events.filter((item) => item.layer === 'actual' && occursInWeek(item, currentWeekKey)).map(key));
    const pending = source.filter((item) => !existing.has(key(item)));
    if (!source.length) return notify('本周预估图层里没有可复制的日程');
    if (!pending.length) return notify('预估日程已经都在实际图层里了');
    try {
      const created = [];
      for (const item of pending) created.push(await createEventFrom({ ...eventSnapshot(item), layer: 'actual', week_key: currentWeekKey, repeat: false, source: 'calendar' }));
      const lids = created.map((item) => item.id); const snaps = created.map((item) => eventSnapshot(item));
      record({ label: `复制 ${created.length} 项预估到实际`, undo: async () => { for (const lid of lids) await removeEventById(lid); }, redo: async () => { for (let index = 0; index < snaps.length; index += 1) await createEventFrom(snaps[index], resolveId(lids[index])); } });
      setActiveLayer('actual'); setStatsLayer('actual'); notify(`已把 ${created.length} 项预估复制到实际，可在实际图层调整`, undoAction);
    } catch (error) { notify(`复制失败：${error.message}`); }
  };
  const copyWeekForward = async () => {
    const targetKey = weekKey(addDays(weekStart, 7));
    const payloads = weekCopyPayloads(events, currentWeekKey, targetKey);
    if (!payloads.length) return notify('本周没有可复制的一次性日程（重复和订阅日程会自动出现在每周）');
    if (!window.confirm(`把本周 ${payloads.length} 项日程复制到下一周（${targetKey}）？可随时撤销。`)) return;
    try {
      const created = [];
      for (const payload of payloads) created.push(await createEventFrom(payload));
      const lids = created.map((item) => item.id); const snaps = created.map((item) => eventSnapshot(item));
      record({ label: `复制本周到下一周（${created.length} 项）`, undo: async () => { for (const lid of lids) await removeEventById(lid); }, redo: async () => { for (let index = 0; index < snaps.length; index += 1) await createEventFrom(snaps[index], resolveId(lids[index])); } });
      notify(`已复制 ${created.length} 项到下一周`, undoAction);
    } catch (error) { notify(`复制失败：${error.message}`); }
  };
  const importCsv = async (change) => {
    const file = change.target.files?.[0]; if (!file) return;
    try {
      const { events: rows, errors } = parseScheduleCsv(await file.text());
      if (!rows.length) throw new Error(errors.length ? `没有可导入的行（第 ${errors[0].line} 行：${errors[0].reason}）` : 'CSV 为空');
      const created = [];
      for (const row of rows) created.push(await createEventFrom({ ...row, category: 'class', layer: 'fixed', repeat: true, week_key: null, source: 'calendar' }));
      const lids = created.map((item) => item.id); const snaps = created.map((item) => eventSnapshot(item));
      record({ label: `导入课表（${created.length} 项）`, undo: async () => { for (const lid of lids) await removeEventById(lid); }, redo: async () => { for (let index = 0; index < snaps.length; index += 1) await createEventFrom(snaps[index], resolveId(lids[index])); } });
      setActiveLayer('fixed'); setStatsLayer('fixed');
      notify(`已导入 ${created.length} 门课程到「每周固定」${errors.length ? `，${errors.length} 行被跳过（第 ${errors.slice(0, 3).map((item) => item.line).join('、')} 行…）` : ''}`, undoAction);
    } catch (error) { notify(`CSV 导入失败：${error.message}`); } finally { change.target.value = ''; }
  };
  const addEvent = (day, startMinute, extra = {}) => { if (!visibleLayers.length) return notify('请先勾选一个图层'); const start = Math.max(timelineRange.start, Math.min(timelineRange.end - 15, Math.round(startMinute / CELL_MIN) * CELL_MIN)); setEventModal({ id: null, title: extra.title || '', day, start_minute: start, end_minute: Math.min(timelineRange.end, start + (extra.duration || 60)), layer: activeLayer, cat: extra.cat || activeCat, description: '', repeat: false, week_key: currentWeekKey, task_id: extra.task_id ?? null }); };
  const updatePlanDraft = (planId, patch) => {
    const plan = window.__wbPlan;
    const draftId = String(planId).replace(/^plan-/, '');
    if (!plan || !Array.isArray(plan.blocks)) return false;
    const index = plan.blocks.findIndex((block, blockIndex) => String(block.draft_id || block.id || blockIndex) === draftId);
    if (index < 0) return false;
    const blocks = plan.blocks.map((block, blockIndex) => blockIndex === index ? { ...block, ...patch } : block);
    window.__wbPlan = { ...plan, blocks };
    setPlanVersion((value) => value + 1);
    return true;
  };
  const deletePlanDraft = (planId) => {
    const plan = window.__wbPlan;
    const draftId = String(planId).replace(/^plan-/, '');
    if (!plan || !Array.isArray(plan.blocks)) return false;
    const index = plan.blocks.findIndex((block, blockIndex) => String(block.draft_id || block.id || blockIndex) === draftId);
    if (index < 0) return false;
    window.__wbPlan = { ...plan, blocks: plan.blocks.filter((_, blockIndex) => blockIndex !== index) };
    setPlanVersion((value) => value + 1);
    return true;
  };
  const saveEvent = async () => {
    if (!eventModal?.title?.trim()) return notify('日程标题不能为空');
    const localEvent = { ...eventModal, title: eventModal.title.trim(), start_minute: Number(eventModal.start_minute), end_minute: Number(eventModal.end_minute), category: eventModal.cat || activeCat, week_key: currentWeekKey };
    if (localEvent.end_minute <= localEvent.start_minute) return notify('结束时间必须晚于开始时间');
    try {
      if (String(localEvent.id || '').startsWith('plan-')) {
        updatePlanDraft(localEvent.id, { title: localEvent.title, day: localEvent.day, start_minute: localEvent.start_minute, end_minute: localEvent.end_minute, category: localEvent.category, description: localEvent.description || '' });
        setEventModal(null);
        notify('规划草案已更新，确认后才会写入 SQL');
      } else if (localEvent.id && !String(localEvent.id).startsWith('local-')) {
        const original = events.find((item) => item.id === localEvent.id);
        const response = await call(`/calendar/events/${localEvent.id}`, { method: 'PATCH', body: JSON.stringify(localEvent) });
        setEvents((items) => items.map((item) => item.id === localEvent.id ? response : item));
        if (original) { const lid = localEvent.id; const beforeSnap = eventSnapshot(original); const afterSnap = eventSnapshot(response); record({ label: '编辑日程', undo: () => patchEventById(lid, beforeSnap), redo: () => patchEventById(lid, afterSnap) }); }
        notify('日程已更新并写入 SQL', original ? undoAction : null);
      } else {
        const response = await call('/calendar/events', { method: 'POST', body: JSON.stringify(localEvent) });
        setEvents((items) => [...items, response]);
        recordCreated(response, '新建日程');
        notify('日程已写入 SQL', undoAction);
      }
      setEventModal(null);
    } catch (error) {
      notify(`保存失败：${error.message}`);
    }
  };
  const deleteEvent = async (scope = 'all') => {
    if (!eventModal?.id) return setEventModal(null);
    if (String(eventModal.id).startsWith('plan-')) {
      deletePlanDraft(eventModal.id);
      setEventModal(null);
      notify('规划草案已移除，尚未写入 SQL');
      return;
    }
    try {
      const query = scope === 'week' ? `?scope=week&week_key=${encodeURIComponent(currentWeekKey)}` : '?scope=all';
      const lid = eventModal.id;
      const original = events.find((item) => item.id === lid);
      const result = await call(`/calendar/events/${lid}${query}`, { method: 'DELETE' });
      setEvents((items) => result.event ? items.map((item) => item.id === lid ? result.event : item) : items.filter((item) => item.id !== lid));
      setEventModal(null);
      if (original && result.event) {
        const week = currentWeekKey; const previous = parseExcluded(original.excluded_weeks);
        record({ label: '删除本周日程', undo: () => patchEventById(lid, { excluded_weeks: previous }), redo: async () => { const next = await call(`/calendar/events/${resolveId(lid)}?scope=week&week_key=${encodeURIComponent(week)}`, { method: 'DELETE' }); if (next.event) setEvents((items) => items.map((item) => item.id === next.event.id ? next.event : item)); } });
      } else if (original && !original.all_day && !original.external_key && !original.deadline_kind) {
        const snap = eventSnapshot(original); const excluded = parseExcluded(original.excluded_weeks);
        record({ label: '删除日程', undo: () => createEventFrom(snap, resolveId(lid), excluded), redo: () => removeEventById(lid) });
      } else if (original) {
        const row = { ...original };
        record({ label: '删除日程', undo: () => restoreEventRow(row, resolveId(lid)), redo: () => removeEventById(lid) });
      }
      notify(scope === 'week' ? '已删除本周日程' : '日程已删除', original ? undoAction : null);
    } catch (error) { notify(`删除失败：${error.message}`); }
  };
  const recordCreated = (created, label) => {
    const lid = created.id; const snap = eventSnapshot(created);
    record({ label, undo: () => removeEventById(lid), redo: () => createEventFrom(snap, resolveId(lid)) });
  };
  const persistEventMove = async (eventId, patch, before = null) => {
    if (!eventId || String(eventId).startsWith('plan-') || String(eventId).startsWith('fixed-')) return;
    const prior = before || pickFields(events.find((item) => item.id === eventId), patch);
    try {
      const saved = await call(`/calendar/events/${eventId}`, { method: 'PATCH', body: JSON.stringify(patch) });
      setEvents((items) => items.map((item) => item.id === eventId ? saved : item));
      if (Object.values(prior).every((value) => value !== undefined) && Object.keys(prior).some((key) => prior[key] !== patch[key])) record({ label: '移动或调整日程', undo: () => patchEventById(eventId, prior), redo: () => patchEventById(eventId, patch) });
      notify('日程位置已保存', undoAction);
    } catch (error) {
      // Put the block back at once; the reload after it is best-effort (it also fails when offline).
      if (Object.values(prior).every((value) => value !== undefined)) setEvents((items) => items.map((item) => item.id === eventId ? { ...item, ...prior } : item));
      notify(`移动失败，已恢复原位置：${error.message}`);
      await refresh().catch(() => {});
    }
  };
  const moveEvent = (source, target) => {
    if (source.locked) return;
    if (String(source.id).startsWith('plan-')) {
      updatePlanDraft(source.id, target);
      notify('草案位置已调整');
      return;
    }
    setEvents((items) => items.map((item) => item.id === source.id ? { ...item, ...target } : item));
    persistEventMove(source.id, target);
  };
  const onDropToGrid = (event, day, minute) => {
    event.preventDefault();
    if (!visibleLayers.length) return notify('请先勾选一个图层');
    const raw = event.dataTransfer.getData('text/plain');
    if (!raw) return;
    const targetStart = Math.max(timelineRange.start, Math.min(timelineRange.end - 15, Math.round(minute / CELL_MIN) * CELL_MIN));
    if (raw.startsWith('event:')) {
      const eventId = raw.slice(6);
      if (eventId.startsWith('plan-')) {
        updatePlanDraft(eventId, { day, start_minute: targetStart });
        notify('草案位置已调整，确认后才会写入 SQL');
        return;
      }
      const current = events.find((item) => String(item.id) === eventId);
      if (!current || current.locked) return notify(current?.locked ? '锁定日程不可移动' : '找不到要移动的日程');
      const duration = Math.max(CELL_MIN, Number(current.end_minute) - Number(current.start_minute));
      const patch = { day, start_minute: targetStart, end_minute: Math.min(timelineRange.end, targetStart + duration) };
      setEvents((items) => items.map((item) => item.id === current.id ? { ...item, ...patch } : item));
      persistEventMove(current.id, patch);
      return;
    }
    if (raw.startsWith('task:')) { const task = tasks.find((item) => String(item.id) === raw.slice(5)); if (task) addEvent(day, minute, { title: task.title, duration: task.estimate_minutes || 30, task_id: task.id, cat: task.title.includes('作业') ? 'study' : 'class' }); }
    else if (raw.startsWith('inbox:')) { const item = inbox.find((row) => row.id === raw.slice(6)); if (item) addEvent(day, minute, { title: item.text, duration: 30, cat: 'other' }); }
    else if (raw === 'night') { const item = { id: uid('night'), weekKey: currentWeekKey, day, date: isoDate(addDays(weekStart, DAYS.indexOf(day))), text: nightDraft.text.trim() || '熬夜', sleep: nightDraft.sleep }; setNightNotes((items) => [...items, item]); persistScratch('night', item).then((saved) => saved && setNightNotes((items) => items.map((row) => row.id === item.id ? { ...row, __scratchId: saved.id, entity_key: saved.entity_key } : row))); notify('熬夜贴纸已贴到周看板'); }
    else if (raw === 'deadline') { if (!deadlineDraft.text.trim()) return notify('先写截止内容'); const item = { id: uid('deadline'), weekKey: currentWeekKey, day, date: isoDate(addDays(weekStart, DAYS.indexOf(day))), text: deadlineDraft.text.trim(), kind: deadlineDraft.kind, due_minute: targetStart }; setDeadlines((items) => [...items, item]); persistScratch('deadline', item).then((saved) => saved && setDeadlines((items) => items.map((row) => row.id === item.id ? { ...row, __scratchId: saved.id, entity_key: saved.entity_key } : row))); notify('截止警示已贴到周看板'); }
  };
  const previewResize = (eventId, endMinute) => {
    const plan = window.__wbPlan;
    if (String(eventId).startsWith('plan-')) {
      updatePlanDraft(eventId, { end_minute: Math.max(timelineRange.start + CELL_MIN, Math.min(timelineRange.end, Math.round(endMinute / CELL_MIN) * CELL_MIN)) });
      return;
    }
    const current = events.find((item) => String(item.id) === String(eventId));
    if (!current || current.locked) return;
    if (resizeOrigin.current?.id !== current.id) resizeOrigin.current = { id: current.id, end_minute: current.end_minute };
    const next = Math.max(Number(current.start_minute) + CELL_MIN, Math.min(timelineRange.end, Math.round(endMinute / CELL_MIN) * CELL_MIN));
    setEvents((items) => items.map((item) => item.id === current.id ? { ...item, end_minute: next } : item));
  };
  const finishResize = async (eventId, endMinute) => {
    if (String(eventId).startsWith('plan-')) { notify('草案时长已调整，确认后才会写入 SQL'); return; }
    const current = events.find((item) => String(item.id) === String(eventId));
    if (!current || current.locked) return notify('锁定日程不可调整');
    const origin = resizeOrigin.current?.id === current.id ? resizeOrigin.current : null;
    resizeOrigin.current = null;
    await persistEventMove(current.id, { end_minute: Math.max(Number(current.start_minute) + CELL_MIN, Math.min(timelineRange.end, Math.round(endMinute / CELL_MIN) * CELL_MIN)) }, origin ? { end_minute: origin.end_minute } : null);
  };
  const resizeEvent = async (eventId, endMinute) => {
    const current = events.find((item) => String(item.id) === String(eventId));
    if (!current || current.locked) return notify('锁定日程不可调整');
    const patch = { end_minute: Math.max(Number(current.start_minute) + CELL_MIN, Math.min(timelineRange.end, Math.round(endMinute / CELL_MIN) * CELL_MIN)) };
    setEvents((items) => items.map((item) => item.id === current.id ? { ...item, ...patch } : item));
    await persistEventMove(current.id, patch);
  };
  const paint = async (dayIndex, minute) => {
    if (!visibleLayers.length) return notify('请先勾选一个图层');
    const key = `${currentWeekKey}-${activeLayer}-${dayIndex}-${minute}`;
    const existing = fills.find((item) => item.key === key);
    if (existing) {
      setFills((items) => items.filter((item) => item.key !== key));
      await persistScratch('scratch-delete', { ...existing, kind: 'fill' });
      return;
    }
    if (activeCat === 'erase') return;
    const fill = { key, weekKey: currentWeekKey, layer: activeLayer, day: dayIndex, minute, cat: activeCat };
    setFills((items) => [...items, fill]);
    const saved = await persistScratch('fill', fill);
    if (saved) setFills((items) => items.map((row) => row.key === key ? { ...row, __scratchId: saved.id, entity_key: saved.entity_key } : row));
  };
  const removeScratchItem = async (kind, item, setter) => {
    setter((items) => items.filter((row) => row.id !== item.id));
    await persistScratch('scratch-delete', { ...item, kind });
  };
  const removeNight = async (item) => removeScratchItem('night', item, setNightNotes);
  const removeDeadline = async (item) => {
    if (!item.event_id) return removeScratchItem('deadline', item, setDeadlines);
    const lid = item.event_id; const original = events.find((row) => row.id === lid);
    try {
      await call(`/calendar/events/${lid}`, { method: 'DELETE' }); await refresh();
      if (original) {
        const row = { ...original };
        record({ label: '删除截止提醒', undo: () => restoreEventRow(row, resolveId(lid)), redo: async () => { await removeEventById(lid); setDeadlines(await call('/calendar/deadlines')); } });
        notify('截止提醒已删除', undoAction);
      }
    }
    catch (error) { notify(error.message); }
  };
  const updateDeadline = async (item, patch) => {
    try {
      if (item.event_id) {
        const saved = await call(`/calendar/deadlines/${item.event_id}`, { method: 'PATCH', body: JSON.stringify(patch) });
        setDeadlines((items) => items.map((row) => row.id === item.id ? saved : row));
      } else {
        const next = { ...item, ...patch };
        const saved = await persistScratch('deadline', next);
        if (saved) setDeadlines((items) => items.map((row) => row.id === item.id ? { ...next, __scratchId: saved.id } : row));
      }
    } catch (error) { notify(error.message); }
  };
  const toggleDeadline = (item) => updateDeadline(item, { completed: !item.completed });
  const changeDeadlineKind = (item, kind) => updateDeadline(item, { kind });
  const exportBackup = async () => { try { const backup = await call('/backup'); download(JSON.stringify(backup, null, 2), `weeklyboard-${currentWeekKey}.json`, 'application/json'); notify('SQL 备份已导出'); } catch (error) { notify(`备份失败：${error.message}`); } };
  const restoreBackup = async (change) => { const file = change.target.files?.[0]; if (!file) return; try { const backup = JSON.parse(await file.text()); if (!backup?.tables) throw new Error('备份文件缺少 tables'); if (!window.confirm('恢复备份会替换当前账号的项目、任务、日程和贴纸，继续吗？')) return; await call('/backup/restore', { method: 'POST', body: JSON.stringify({ backup }) }); history.current.clear(); setProject(null); setTasks([]); await refresh(); await loadScratch(); notify('SQL 备份已恢复'); } catch (error) { notify(`恢复失败：${error.message}`); } finally { change.target.value = ''; } };
  const copyEvent = async (source, target) => {
    const payload = eventCopyPayload(source, target || { day: source.day, start_minute: source.start_minute, end_minute: source.end_minute }, currentWeekKey);
    if (!target) return setEventModal({ ...payload, id: null, cat: payload.category });
    try {
      const created = await call('/calendar/events', { method: 'POST', body: JSON.stringify(payload) });
      setEvents((items) => [...items, created]);
      recordCreated(created, '复制日程');
      notify('已复制日程', undoAction);
    } catch (error) { notify(`复制失败：${error.message}`); }
  };
  const exportICS = async () => { try { const response = await fetch(`${API}/calendar.ics`, { headers: { Authorization: `Bearer ${token}` } }); if (!response.ok) throw new Error('导出失败'); download(await response.text(), 'weeklyboard.ics', 'text/calendar'); notify('ICS 已导出'); } catch (error) { notify(error.message); } };
  const importICS = async (change) => { const file = change.target.files?.[0]; if (!file) return; try { const response = await call('/calendar/import', { method: 'POST', body: JSON.stringify({ ics: await file.text(), week_key: currentWeekKey, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone }) }); setEvents(await call('/calendar')); setActiveLayer('once'); setStatsLayer('once'); notify(`已导入 ${response.imported} 个事件`); } catch (error) { notify(error.message); } finally { change.target.value = ''; } };
  const logout = () => { navigator.serviceWorker?.controller?.postMessage('clear-data'); history.current.clear(); localStorage.removeItem('wb-token'); setToken(''); setProjects([]); setProject(null); setTasks([]); };
  if (booting) return <Auth loading />;
  if (!token) return <Auth email={email} setEmail={setEmail} password={password} setPassword={setPassword} mode={authMode} setMode={setAuthMode} submit={authenticate} />;
  const displayTasks = tasks.map((task) => { const row = pomodoro.data?.rows.find((row) => row.task_id === task.id); return row ? { ...task, status: row.complete ? 'done' : 'todo', pomodoro: pomodoro.enabled ? row : undefined } : task; });
  const timeReview = pomodoro.enabled && pomodoro.data ? { ...review, tasks: { ...review?.tasks, completion_rate: pomodoro.data.total.percent / 100 } } : review;
  return <div className="app">{inflight > 0 && <div className="net-bar" role="progressbar" aria-label="正在同步" />}{offline && <div className="net-banner" role="alert">当前离线：可以浏览已加载的内容，修改会在联网后才能保存。</div>}<Topbar visibleLayers={visibleLayers} toggleLayer={toggleLayer} subscriptions={<><CalendarSubscriptions layers={LAYERS} call={call} onChanged={subscriptionChanged} notify={notify} /><CalendarPublish layers={LAYERS} call={call} api={API} notify={notify} /></>} pomodoro={pomodoro} weekStart={weekStart} setWeekStart={setWeekStart} setCalendarOpen={setCalendarOpen} layerOpen={layerOpen} setLayerOpen={setLayerOpen} backupOpen={backupOpen} setBackupOpen={setBackupOpen} activeLayer={activeLayer} setActiveLayer={setActiveLayer} debugMode={debugMode} email={email} onImport={importICS} onExportICS={exportICS} onBackup={exportBackup} onRestore={restoreBackup} onImportCsv={importCsv} onCopyWeek={copyWeekForward} reminders={reminders} logout={logout} history={{ canUndo: history.current.canUndo(), canRedo: history.current.canRedo(), onUndo: undo, onRedo: redo }} /><div className="board"><a className="mobile-board-jump" href="#weekTimeline">↓ 查看本周时间轴</a><Sidebar {...{ review, pomodoro, projects, project, selectProject, newProject, setNewProject, projectDescription, setProjectDescription, createProject, tasks: displayTasks, newTask, setNewTask, createTask, toggleTask, removeTask, inbox, newInbox, setNewInbox, addInboxItem, removeInbox, convertInbox, nightDraft, setNightDraft, deadlineDraft, setDeadlineDraft, windowStart, setWindowStart, windowEnd, setWindowEnd, saveAvailability, fixedDraft, setFixedDraft, saveFixed, stats, statsLayer, setStatsLayer, review, makePlan, busy, confirmPlan, plan: window.__wbPlan, planFeedback, setPlanFeedback, copyPlanToActual, currentWeekNights, currentWeekDeadlines, removeNight, removeDeadline, toggleDeadline, openDeadline: setDeadlineId, onOpenTemplates: () => setShowTemplates(true), onOpenGuide: () => { setGuideStep(0); setShowGuide(true); } }} /><main className="timeline-pane"><PomodoroPanel controller={pomodoro} categories={CATS} /><Legend activeCat={activeCat} setActiveCat={setActiveCat} activeLayer={activeLayer} setActiveLayer={setActiveLayer} /><LayerControls layers={LAYERS} visibleLayers={visibleLayers} activeLayer={activeLayer} onToggle={toggleLayer} onSelect={setActiveLayer} /><DayTabs days={DAYS} weekStart={weekStart} focusDay={mobileDay} onFocusDay={setMobileDay} /><TimelineZoom><Timeline focusDay={mobileDay} onFocusDay={setMobileDay} onMove={moveEvent} onCopy={copyEvent} visibleLayers={visibleLayers} timeRange={timelineRange} weekStart={weekStart} events={visibleEvents} fills={fills} currentWeekKey={currentWeekKey} activeLayer={activeLayer} activeCat={activeCat} onPaint={paint} onDrop={onDropToGrid} onOpenEvent={(event) => setEventModal(event)} onCreate={addEvent} onResizePreview={previewResize} onResizeEnd={finishResize} nights={currentWeekNights} deadlines={timelineDeadlines} onOpenDeadline={(item) => setDeadlineId(item.id)} onRemoveNight={removeNight} onRemoveDeadline={removeDeadline} /></TimelineZoom></main></div>{calendarOpen && <CalendarView month={calendarMonth} setMonth={setCalendarMonth} weekStart={weekStart} setWeekStart={setWeekStart} close={() => setCalendarOpen(false)} nights={currentWeekNights} deadlines={deadlines} onOpenDeadline={(item) => setDeadlineId(item.id)} onToggleDeadline={toggleDeadline} review={timeReview} call={call} notify={notify} />}{selectedDeadline && <DeadlineModal item={selectedDeadline} onClose={() => setDeadlineId(null)} onToggle={toggleDeadline} onKind={changeDeadlineKind} />}{eventModal?.subscription_id ? <SubscriptionEvent event={eventModal} close={() => setEventModal(null)} /> : eventModal && <EventModal days={DAYS} categories={CATS} layers={LAYERS} taskOptions={pomodoro.enabled ? pomodoro.data?.rows.filter((row) => row.task_id) || [] : []} value={eventModal} setValue={setEventModal} save={saveEvent} remove={deleteEvent} close={() => setEventModal(null)} />}{showTemplates && <TemplateModal templates={TEMPLATES} busy={busy} onSelect={applyTemplate} onClose={() => setShowTemplates(false)} />}{showGuide && <GuideModal step={guideStep} onStep={setGuideStep} onClose={() => setShowGuide(false)} />}{toast && <div className="toast" role="status" aria-live="polite">{toast}{toastAction && <button type="button" className="toast-action" onClick={() => { setToast(''); setToastAction(null); toastAction.run(); }}>{toastAction.label}</button>}</div>}</div>;
}

function Auth({ loading, email, setEmail, password, setPassword, mode, setMode, submit }) { return <div className="auth-screen"><div className="auth-paper sketchy"><div className="auth-brand"><StarIcon /><div><h1>周看板</h1><span>Weekly Planner</span></div></div>{loading ? <><p className="auth-lead">正在启动调试工作区…</p><span className="debug-badge">DEBUG MODE · SQL DATABASE</span></> : <><p className="auth-lead">把目标，变成这一周能执行的计划。</p><label className="field-label">邮箱<input value={email} onChange={(event) => setEmail(event.target.value)} placeholder="name@example.com" /></label><label className="field-label">密码<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位" /></label><button className="paper-btn primary wide" onClick={submit}>{mode === 'login' ? '进入工作台' : '创建账号'}</button><button className="text-btn" onClick={() => setMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? '还没有账号？创建一个' : '已有账号，直接登录'}</button></>}</div></div>; }
function Topbar({ visibleLayers, toggleLayer, subscriptions, pomodoro, weekStart, setWeekStart, setCalendarOpen, layerOpen, setLayerOpen, backupOpen, setBackupOpen, activeLayer, setActiveLayer, debugMode, email, onImport, onExportICS, onBackup, onRestore, onImportCsv, onCopyWeek, reminders, logout, history }) { return <header className="topbar"><div className="brand"><button className="star-btn" onClick={() => setCalendarOpen(true)} title="打开日历视图" aria-label="打开日历视图"><StarIcon /></button><h1>周看板</h1><span className="brand-en">Weekly Planner</span></div><div className="weeknav"><button className="icon-btn" onClick={() => setWeekStart((date) => addDays(date, -7))} aria-label="上一周">‹</button><button className="today-btn" onClick={() => setWeekStart(startOfWeek(new Date()))}>本周</button><button className="icon-btn" onClick={() => setWeekStart((date) => addDays(date, 7))} aria-label="下一周">›</button><span className="week-label">{weekStart.getFullYear()}年第{weekNumber(weekStart)}周 · {fmtDate(weekStart)} – {fmtDate(addDays(weekStart, 6))}</span></div><div className="top-actions"><PomodoroSwitch controller={pomodoro} /><div className="undo-group" role="group" aria-label="撤销与重做"><button className="icon-btn" disabled={!history.canUndo} onClick={history.onUndo} title="撤销 (Ctrl+Z)" aria-label="撤销">↶</button><button className="icon-btn" disabled={!history.canRedo} onClick={history.onRedo} title="重做 (Ctrl+Shift+Z)" aria-label="重做">↷</button></div><span className="save-dot on" title="已自动保存" />{subscriptions}<MoreMenu onImport={onImport} onExportICS={onExportICS} onImportCsv={onImportCsv} onCopyWeek={onCopyWeek} reminders={reminders} /><div className="backup-wrap"><button className="paper-btn" aria-expanded={backupOpen} aria-controls="backup-popover" onClick={() => setBackupOpen(!backupOpen)}>💾 备份</button>{backupOpen && <div id="backup-popover" className="layer-popover backup-popover" role="dialog" aria-label="数据备份"><h4>数据备份 <em>Backup</em></h4><p className="popover-note">备份包含项目、任务、日程、收件箱、涂色与贴纸。</p><div className="data-btns"><button className="paper-btn primary" onClick={onBackup}>⬇ 导出备份 (JSON)</button><label className="paper-btn">⬆ 恢复备份<input type="file" accept=".json,application/json" hidden onChange={onRestore} /></label></div></div>}</div><div className="layer-wrap"><button className="paper-btn" aria-expanded={layerOpen} aria-controls="layer-popover" onClick={() => setLayerOpen(!layerOpen)}>图层</button>{layerOpen && <div id="layer-popover" className="layer-popover" role="dialog" aria-label="图层"><h4>图层 <em>Layers</em></h4><LayerControls compact layers={LAYERS} visibleLayers={visibleLayers} activeLayer={activeLayer} onToggle={toggleLayer} onSelect={setActiveLayer} /></div>}</div><span className={debugMode ? 'debug-badge compact' : 'user-chip'}>{debugMode ? 'DEBUG MODE' : email}</span><button className="text-btn" onClick={logout}>退出</button></div></header>; }
function DayTabs({ days, weekStart, focusDay, onFocusDay }) { return <div className="mobile-day-tabs" role="tablist" aria-label="选择要查看的一天">{days.map((day, index) => <button key={day} type="button" role="tab" aria-selected={index === focusDay} className={index === focusDay ? 'active' : ''} onClick={() => onFocusDay(index)}><span>{day}</span><small>{fmtDate(addDays(weekStart, index))}</small></button>)}</div>; }
function MoreMenu({ onImport, onExportICS, onImportCsv, onCopyWeek, reminders }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const outside = (event) => { if (!ref.current?.contains(event.target)) setOpen(false); };
    const escape = (event) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', outside); document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [open]);
  const run = (action) => () => { setOpen(false); action(); };
  return <div className="more-wrap" ref={ref}><button className="paper-btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>更多 ▾</button>{open && <div className="layer-popover more-popover" role="menu" aria-label="更多操作"><button role="menuitem" className="more-item" onClick={run(onCopyWeek)}>复制本周到下一周</button><label role="menuitem" className="more-item">导入课表 CSV<input type="file" accept=".csv,text/csv,text/plain" hidden onChange={(event) => { onImportCsv(event); setOpen(false); }} /></label><label role="menuitem" className="more-item">导入日历 ICS<input type="file" accept=".ics,.txt,text/calendar" hidden onChange={(event) => { onImport(event); setOpen(false); }} /></label><button role="menuitem" className="more-item" onClick={run(onExportICS)}>导出日历 ICS</button><button role="menuitemcheckbox" aria-checked={reminders.enabled} className="more-item" onClick={run(reminders.toggle)}>日程提醒：{reminders.enabled ? '已开启' : '已关闭'}</button><button role="menuitem" className="more-item" onClick={run(() => window.print())}>打印 / 另存为 PDF</button></div>}</div>;
}
function Panel({ title, english, tape = 'tape-yellow', children, className = '' }) { return <section className={`panel sketchy ${className}`}><h2 className={`panel-title ${tape}`}>{title} <em>{english}</em></h2>{children}</section>; }
function Sidebar(props) { return <aside className="sidebar"><div className="quick-actions"><button className="paper-btn" onClick={props.onOpenTemplates}>选择示例模板</button><button className="paper-btn" onClick={props.onOpenGuide}>新手教程</button></div><Panel title="待分配任务" english="Task Pool"><div className="add-row"><input value={props.newTask} onChange={(event) => props.setNewTask(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && props.createTask()} placeholder="添加一个任务…" /><button className="mini-btn" onClick={() => props.createTask()} aria-label="添加任务">＋</button></div><ul className="task-list">{props.tasks.map((task) => <li className="task" draggable key={task.id} onDragStart={(event) => event.dataTransfer.setData('text/plain', `task:${task.id}`)}><span className={`task-dot ${task.status === 'done' ? 'done' : ''}`} /><div className="task-body"><strong className={`task-title ${task.status === 'done' ? 'completed' : ''}`}>{task.title}</strong><small>{task.pomodoro ? `${task.pomodoro.actual_units} / ${task.pomodoro.plan_units} 番茄钟` : `${task.estimate_minutes || 30} 分钟 · 优先级 ${task.priority || 3}`}</small>{task.pomodoro?.pending_units > 0 && <span className="pomo-task-meta">还需安排 {task.pomodoro.pending_units} 个番茄钟</span>}<input className="task-note" placeholder="本周具体任务…" /></div><div className="task-actions"><button aria-label={`${task.status === 'done' ? '标记未完成' : '完成'}任务：${task.title}`} disabled={props.pomodoro.pending || !props.pomodoro.data} onClick={() => props.toggleTask(task)}>{task.status === 'done' ? '↺' : '✓'}</button><button aria-label={`删除任务：${task.title}`} onClick={() => props.removeTask(task)}>×</button></div></li>)}</ul><p className="panel-hint"><span className="mini-arrow">→</span>拖到时间轴安排（默认仅本周）；任务保留在池中，可多次安排不同内容</p></Panel><Panel title="收件箱" english="Inbox" tape="tape-cream"><div className="add-row"><input value={props.newInbox} onChange={(event) => props.setNewInbox(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && props.addInboxItem()} placeholder="记点什么…" /><button className="mini-btn" onClick={props.addInboxItem} aria-label="添加便签">＋</button></div><ul className="inbox-list">{props.inbox.map((item) => <li className="inbox-item" draggable key={item.id} onDragStart={(event) => event.dataTransfer.setData('text/plain', `inbox:${item.id}`)}><span className="inbox-text">{item.text}</span><div className="inbox-actions"><button onClick={() => props.convertInbox(item)}>转任务</button><button onClick={() => props.removeInbox(item)} aria-label={`删除 ${item.text}`}>×</button></div></li>)}</ul><p className="panel-hint"><span className="mini-arrow">→</span>便签可单独拖到时间轴安排 · 每周自动清空</p></Panel><Panel title="熬夜贴纸" english="Night Owl" tape="tape-teal"><div className="night-sticker" draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', 'night')}><span className="night-moon">🌙</span><div className="night-fields"><input value={props.nightDraft.text} onChange={(event) => props.setNightDraft({ ...props.nightDraft, text: event.target.value })} placeholder="熬夜干了什么…" /><input type="time" value={props.nightDraft.sleep} onChange={(event) => props.setNightDraft({ ...props.nightDraft, sleep: event.target.value })} /></div></div><p className="panel-hint"><span className="mini-arrow">→</span>填好后把贴纸拖到某一天的日程上</p>{props.currentWeekNights?.length > 0 && <ul className="scratch-list">{props.currentWeekNights.map((item) => <li key={item.id}><span>🌙 {item.text}</span><button aria-label={`删除熬夜记录 ${item.text}`} onClick={() => props.removeNight(item)}>×</button></li>)}</ul>}</Panel><Panel title="截止警示" english="Deadline" tape="tape-red"><div className="night-sticker dl-sticker" draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', 'deadline')}><span className="night-moon">⚠️</span><div className="night-fields"><input value={props.deadlineDraft.text} onChange={(event) => props.setDeadlineDraft({ ...props.deadlineDraft, text: event.target.value })} placeholder="什么要交 / 要考？" /><select value={props.deadlineDraft.kind} onChange={(event) => props.setDeadlineDraft({ ...props.deadlineDraft, kind: event.target.value })}><option value="hw">作业截止</option><option value="exam">考试</option></select></div></div><p className="panel-hint"><span className="mini-arrow">→</span>拖到课程或某一天；日历页截止雷达同步显示</p><DeadlineList items={props.currentWeekDeadlines} onOpen={(item) => props.openDeadline(item.id)} onToggle={props.toggleDeadline} onRemove={props.removeDeadline} /></Panel><Panel title="分类统计" english="Weekly Stats" tape="tape-teal"><div className="stats-layer-row"><span className="stats-mini-label">统计图层</span><select className="paper-select" value={props.statsLayer} onChange={(event) => props.setStatsLayer(event.target.value)}>{LAYERS.map((layer) => <option key={layer.id} value={layer.id}>{layer.label}</option>)}</select></div><ul className="stats-list">{CATS.map((cat) => <li className={`stat-row ${props.stats.totals[cat.id] ? '' : 'zero'}`} key={cat.id}><i className="stat-dot" style={{ background: cat.color }} /><span className="stat-label">{cat.label}</span><span className="stat-time">{Math.round(props.stats.totals[cat.id] / 60 * 10) / 10}h</span></li>)}</ul><p className="stats-total">本周合计 {Math.round(props.stats.total / 60 * 10) / 10} 小时</p><p className="stats-note">统计当前周内，当前图层中日程与涂色的总时长</p>{props.pomodoro.enabled && <PomodoroBreakdown data={props.pomodoro.data} categories={CATS} />}</Panel><Panel title="我的项目" english="Projects" tape="tape-cream"><div className="add-row"><input value={props.newProject} onChange={(event) => props.setNewProject(event.target.value)} placeholder="新项目名称…" /><button className="mini-btn" onClick={props.createProject} aria-label="新建项目">＋</button></div><textarea value={props.projectDescription} onChange={(event) => props.setProjectDescription(event.target.value)} rows="2" placeholder="目标与背景（可选）" />{props.projects.length === 0 && <p className="panel-hint empty-hint">还没有项目。输入名称后点 ＋ 创建，或点上方「选择示例模板」。</p>}{props.projects.map((item) => <button className={`project-chip ${props.project?.id === item.id ? 'chosen' : ''}`} key={item.id} onClick={() => props.selectProject(item)}><span className="project-dot" />{item.title}<small>{props.project?.id === item.id ? '正在查看' : '打开项目'}</small></button>)}</Panel><Panel title="本周复盘" english="Review" tape="tape-cream"><ReviewCard review={props.review} /></Panel><Panel title="智能规划" english="DeepSeek" className="planner-panel"><p className="panel-hint">{props.project ? `为「${props.project.title}」生成可确认草案。` : '选择项目后开启规划。'}</p><div className="planner-actions"><button className="paper-btn primary" disabled={!props.project || props.busy} onClick={() => props.makePlan(true)}>{props.busy ? '规划中…' : '✦ DeepSeek 规划'}</button><button className="paper-btn" disabled={!props.project || props.busy} onClick={() => props.makePlan(false)}>⚙ 自动排程</button></div>{props.plan && <div className="plan-summary"><p className="plan-source">来源：{props.plan.source === 'deepseek' ? 'DeepSeek' : props.plan.source === 'fallback' ? '本地排程（DeepSeek 暂不可用）' : '本地排程'} · {props.plan.blocks.length} 个时间块</p>{props.plan.summary && <p>{props.plan.summary}</p>}{props.plan.warnings?.length > 0 && <ul className="plan-warnings">{props.plan.warnings.map((text) => <li key={text}>⚠ {text}</li>)}</ul>}{props.plan.assumptions?.length > 0 && <ul className="plan-assumptions">{props.plan.assumptions.map((text) => <li key={text}>· {text}</li>)}</ul>}{props.plan.review_notes?.length > 0 && <ul className="plan-review-notes" aria-label="参考的复盘内容"><li className="plan-review-title">已参考复盘：</li>{props.plan.review_notes.map((text) => <li key={text}>· {text}</li>)}</ul>}<textarea rows="2" value={props.planFeedback} onChange={(event) => props.setPlanFeedback(event.target.value)} placeholder="不满意？写下调整意见，再点 DeepSeek 规划重新生成" aria-label="规划调整意见" /><p className="panel-hint">拖动或双击草案里的时间块可逐块调整；在时间块弹窗里点「删除」即可拒绝这一块。</p></div>}<button className="paper-btn primary small" onClick={props.confirmPlan}>确认写入周看板</button><button className="paper-btn small" onClick={props.copyPlanToActual}>把本周预估复制到实际</button></Panel></aside>; }
function Legend({ activeCat, setActiveCat, activeLayer, setActiveLayer }) { return <div className="legend"><span className="legend-label">颜色分类</span><div className="swatches" role="toolbar" aria-label="日程颜色分类"><button type="button" aria-pressed={activeCat === 'erase'} className={`swatch swatch-erase ${activeCat === 'erase' ? 'active' : ''}`} onClick={() => setActiveCat('erase')}><span className="swatch-dot swatch-dot-erase" /><span className="swatch-text">擦除/选择</span></button>{CATS.map((cat) => <button type="button" aria-pressed={activeCat === cat.id} className={`swatch ${activeCat === cat.id ? 'active' : ''}`} key={cat.id} onClick={() => setActiveCat(cat.id)}><span className="swatch-dot" style={{ background: cat.color }} /><span className="swatch-text">{cat.label}</span></button>)}</div><span className="legend-hint">先选颜色，再点击时间格涂色；双击空白新建日程</span></div>; }
function Timeline({ onMove, onCopy, visibleLayers, timeRange, weekStart, events, fills, currentWeekKey, activeLayer, activeCat, onPaint, onDrop, onOpenEvent, onCreate, onResizePreview, onResizeEnd, nights, deadlines, onOpenDeadline, focusDay, onFocusDay }) { const [copyPreview, setCopyPreview] = useState(null); const [creating, setCreating] = useState(null); const swipe = useRef(null);
  const beginCreate = (down, day) => {
    if (down.button !== 0 || down.pointerType === 'touch' || activeCat !== 'erase' || !visibleLayers.length || down.target.closest('.event, .deadline-time-layer, .deadline-badge')) return;
    const grid = down.currentTarget; const startY = down.clientY; const first = pointerMinute(startY, grid.getBoundingClientRect(), timeRange, CELL_MIN); let current = first; let moved = false;
    const span = () => ({ start: Math.min(first, current), end: Math.max(first, current) + CELL_MIN });
    const move = (event) => { current = pointerMinute(event.clientY, grid.getBoundingClientRect(), timeRange, CELL_MIN); if (Math.abs(event.clientY - startY) > 6) { moved = true; setCreating({ day, ...span() }); } };
    const finish = (commit) => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('keydown', key, true); setCreating(null); if (moved) { const swallow = (event) => { event.stopPropagation(); event.preventDefault(); }; window.addEventListener('click', swallow, { capture: true, once: true }); window.setTimeout(() => window.removeEventListener('click', swallow, true), 300); if (commit) { const range = span(); onCreate(day, range.start, { duration: range.end - range.start }); } } };
    const up = () => finish(true);
    const key = (event) => { if (event.key === 'Escape') { event.stopPropagation(); finish(false); } };
    window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('keydown', key, true);
  }; const dayStart = timeRange.start; const dayEnd = timeRange.end; const rows = (dayEnd - dayStart) / 30; const deadlineHeight = deadlines.length ? Math.min(3, Math.max(...DAYS.map((day) => deadlines.filter((item) => item.day === day).length))) * 28 + 8 : 0; const allDayHeight = events.some((event) => event.all_day) ? Math.min(3, Math.max(...DAYS.map((day) => events.filter((event) => event.day === day && event.all_day).length))) * 26 + 8 : 0; const now = new Date(); const todayIndex = (now.getDay() + 6) % 7; return <div className="timeline-scroll" id="weekTimeline" onTouchStart={(event) => { swipe.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; }} onTouchEnd={(event) => { const start = swipe.current; swipe.current = null; if (!start || !onFocusDay || touchDragRecently() || !window.matchMedia('(max-width: 760px)').matches) return; const dx = event.changedTouches[0].clientX - start.x; const dy = event.changedTouches[0].clientY - start.y; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.8) onFocusDay(Math.max(0, Math.min(6, focusDay + (dx < 0 ? 1 : -1)))); }}>{events.length === 0 && !fills.some((fill) => fill.weekKey === currentWeekKey) && <p className="timeline-empty" role="note">本周还没有日程。在空白处双击或拖拽即可新建，也可以把左侧的任务拖到某一天。</p>}<div className="timeline" data-focus-day={focusDay} style={{ '--rows': rows, '--grid-h': `${rows * 30 / CELL_MIN * CELL_H}px` }}><div className="tl-gutter" style={allDayHeight || deadlineHeight ? { gridTemplateRows: `var(--head-h) ${deadlineHeight ? `${deadlineHeight}px` : ''} ${allDayHeight ? `${allDayHeight}px` : ''} repeat(var(--rows), var(--row-h))` } : undefined}><div className="gutter-head" />{deadlineHeight > 0 && <div className="all-day-label" style={{ height: deadlineHeight }}>截止</div>}{allDayHeight > 0 && <div className="all-day-label" style={{ height: allDayHeight }}>全天</div>}{Array.from({ length: rows }, (_, row) => <div className={`gutter-cell ${row % 2 === 0 ? 'hour' : 'half'}`} key={row}>{row % 2 === 0 ? <span className="hour-label">{fmtTime(dayStart + row * 30)}</span> : <span className="half-label">{fmtTime(dayStart + row * 30)}</span>}<i className="half-tick" /></div>)}</div>{DAYS.map((day, dayIndex) => { const date = addDays(weekStart, dayIndex); const dayEvents = events.filter((event) => event.day === day && !event.all_day); const dayFills = fills.filter((fill) => fill.weekKey === currentWeekKey && visibleLayers.includes(fill.layer) && fill.day === dayIndex); return <div className={`day-col ${dayIndex === focusDay ? 'focus-day' : ''} ${dayIndex === todayIndex && startOfWeek(now).getTime() === weekStart.getTime() ? 'today' : ''}`} key={day}><div className="day-head"><span className="dow">{day}</span><span className="date-num">{fmtDate(date)}</span><span className="night-badges">{nights.filter((item) => item.day === day).map((item) => <button className="night-badge" key={item.id} title={item.text}>🌙 <em>{item.text}</em></button>)}</span></div>{deadlineHeight > 0 && <div className="day-deadlines" style={{ height: deadlineHeight }}>{deadlines.filter((item) => item.day === day).map((item) => <DeadlineBadge key={item.id} item={item} onOpen={onOpenDeadline} />)}</div>}{allDayHeight > 0 && <div className="all-day-events" style={{ height: allDayHeight }}>{events.filter((event) => event.day === day && event.all_day).map((event) => <button className="all-day-event" key={event.id} title={event.title} onClick={() => onOpenEvent(event)}>{event.title}</button>)}</div>}<div className="day-grid" data-day={day} onPointerDown={(down) => beginCreate(down, day)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { const rect = event.currentTarget.getBoundingClientRect(); const minute = pointerMinute(event.clientY, rect, timeRange, CELL_MIN); onDrop(event, day, minute); }} onDoubleClick={(event) => { if (event.target.closest('.event, .deadline-time-layer')) return; const rect = event.currentTarget.getBoundingClientRect(); const minute = pointerMinute(event.clientY, rect, timeRange, CELL_MIN); onCreate(day, minute); }}><div className="grid-background" role="grid" aria-label={`${day} 时间轴`}>{Array.from({ length: rows }, (_, row) => <div className="hrow" role="row" key={row}>{[0, 1, 2].map((slot) => { const minute = dayStart + row * 30 + slot * 10; const minuteFills = dayFills.filter((item) => item.minute === minute); const fill = minuteFills.length > 0; return <button type="button" role="gridcell" tabIndex={-1} className={`cell10 ${fill ? 'paint-active' : ''}`} key={minute} onClick={() => onPaint(dayIndex, minute)} style={fill ? { background: fillBackground(minuteFills, (cat) => catById(cat).color) } : undefined} aria-label={`${day} ${fmtTime(minute)}`} />; })}</div>)}</div>{creating?.day === day && <div className="create-preview" aria-hidden="true" style={{ top: ((creating.start - dayStart) / CELL_MIN) * CELL_H, height: Math.max(CELL_H, ((creating.end - creating.start) / CELL_MIN) * CELL_H) }}><span>{fmtTime(creating.start)}–{fmtTime(creating.end)}</span></div>}<div className="events-layer">{layoutDayEvents(dayEvents).map(({ event, column, columns, span }) => { const top = ((event.start_minute - dayStart) / CELL_MIN) * CELL_H; const height = Math.max(2, ((event.end_minute - event.start_minute) / CELL_MIN) * CELL_H - 1); const cat = catById(event.cat); return <CalendarEvent key={event.id} event={event} height={height} columns={columns} range={timeRange} interval={CELL_MIN} pixelsPerMinute={CELL_H / CELL_MIN} layerLabel={LAYERS.find((layer) => layer.id === event.layer)?.label || event.layer} style={{ top, height, left: `calc(${column / columns * 100}% + 3px)`, right: 'auto', width: `calc(${span / columns * 100}% - 6px)`, boxSizing: 'border-box', borderLeftColor: cat.color, background: cat.fill }} onOpen={(item) => onOpenEvent({ ...item, cat: item.cat || 'other' })} onMove={onMove} onCopy={onCopy} onPreview={setCopyPreview} onResizePreview={onResizePreview} onResizeEnd={onResizeEnd} />; })}</div><EventCopyPreview preview={copyPreview} day={day} range={timeRange} pixelsPerMinute={CELL_H / CELL_MIN} /><DeadlineTimeMarkers key={`${currentWeekKey}-${activeLayer}-${day}`} items={deadlines.filter((item) => item.day === day)} start={dayStart} end={dayEnd} pixelsPerMinute={CELL_H / CELL_MIN} onOpen={onOpenDeadline} />{todayIndex === dayIndex && startOfWeek(now).getTime() === weekStart.getTime() && now.getHours() * 60 + now.getMinutes() >= dayStart && now.getHours() * 60 + now.getMinutes() <= dayEnd && <div className="now-line" style={{ top: ((now.getHours() * 60 + now.getMinutes() - dayStart) / CELL_MIN) * CELL_H }} />}</div></div>; })}</div></div>; }

function TemplateModal({ templates, busy, onSelect, onClose }) { return <div className="modal-mask" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal-card template-modal" role="dialog" aria-modal="true" aria-labelledby="template-modal-title"><div className="modal-tape" /><h3 id="template-modal-title">从示例开始 <em>Templates</em></h3><p className="modal-lead">自动创建项目和任务，之后仍可自由修改。</p><div className="template-grid">{templates.map((template, index) => <button className="template-card" key={template.id} disabled={busy} autoFocus={index === 0} onClick={() => onSelect(template)}><strong>{template.title}</strong><span>{template.description}</span><small>{template.tasks.length} 个任务</small></button>)}</div><div className="modal-actions"><span className="spacer" /><button className="paper-btn" onClick={onClose}>先自己创建</button></div></div></div>; }
const GUIDE_STEPS = [{ title: '先放入目标', body: '创建项目，再把任务放进任务池；没想好内容可以从示例模板开始。', action: '项目 → 任务' }, { title: '生成本周草案', body: 'DeepSeek 理解目标并生成草案；本地快速排程不调用 AI，立即出结果。', action: '草案 → 预估图层' }, { title: '确认后才写入', body: '先调整草案，满意后确认写入「预估」图层；开始执行时点「把本周预估复制到实际」，再按真实情况调整。', action: '调整 → 确认 → 复制到实际' }];
function GuideModal({ step, onStep, onClose }) { const current = GUIDE_STEPS[step]; return <div className="modal-mask" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="modal-card guide-modal" role="dialog" aria-modal="true" aria-labelledby="guide-modal-title"><div className="modal-tape" /><div className="guide-kicker">新手教程 · {step + 1}/{GUIDE_STEPS.length}</div><h3 id="guide-modal-title">{current.title}</h3><p className="guide-body">{current.body}</p><div className="guide-action">{current.action}</div><div className="guide-progress" role="group" aria-label="教程步骤">{GUIDE_STEPS.map((item, index) => <button type="button" aria-label={`第 ${index + 1} 步：${item.title}`} aria-pressed={index === step} key={item.title} className={index === step ? 'active' : index < step ? 'done' : ''} onClick={() => onStep(index)} />)}</div><div className="modal-actions"><button className="text-btn" onClick={onClose}>跳过教程</button><span className="spacer" />{step > 0 && <button className="paper-btn" onClick={() => onStep(step - 1)}>上一步</button>}{step < 2 ? <button autoFocus className="paper-btn primary" onClick={() => onStep(step + 1)}>下一步</button> : <button autoFocus className="paper-btn primary" onClick={onClose}>开始使用</button>}</div></div></div>; }
export { Timeline };

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && import.meta.env?.PROD) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
const rootContainer = typeof document === 'undefined' ? null : document.getElementById('root');
const rootKey = '__weeklyboardReactRoot';
if (rootContainer) {
  const reactRoot = window[rootKey] || (window[rootKey] = createRoot(rootContainer));
  reactRoot.render(<App />);
}
