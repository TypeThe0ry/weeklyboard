import { useCallback, useEffect, useRef, useState } from 'react';
import { dueReminders, reminderText } from './reminders.mjs';

const KEY = 'wb-reminders';
const readEnabled = () => { try { return localStorage.getItem(KEY) === 'on'; } catch { return false; } };
// Announced reminders are remembered for the browser session so a reload does not repeat them.
const SENT_KEY = 'wb-reminders-sent';
const readSent = () => { try { const list = JSON.parse(sessionStorage.getItem(SENT_KEY) || '[]'); return new Set(Array.isArray(list) ? list : []); } catch { return new Set(); } };
const saveSent = (sent) => { try { sessionStorage.setItem(SENT_KEY, JSON.stringify([...sent].slice(-200))); } catch { /* Worst case a reminder repeats after a reload. */ } };
const systemAllowed = () => typeof Notification !== 'undefined' && Notification.permission === 'granted';

// Reminders only fire while the board is open in a tab: there is no push server behind them.
export default function useReminders({ events, weekKeyOf, days, notify }) {
  const [enabled, setEnabled] = useState(readEnabled);
  const sent = useRef(null);
  if (!sent.current) sent.current = readSent();
  const latest = useRef({ events, notify });
  latest.current = { events, notify };

  const check = useCallback(() => {
    const now = new Date();
    const due = dueReminders(latest.current.events, { weekKey: weekKeyOf(now), day: days[(now.getDay() + 6) % 7], minute: now.getHours() * 60 + now.getMinutes(), sent: sent.current });
    for (const item of due) {
      sent.current.add(item.key);
      const { title, body } = reminderText(item);
      let shown = false;
      if (systemAllowed()) { try { new Notification(title, { body, tag: item.key, icon: '/assets/icon.png' }); shown = true; } catch { /* Some mobile browsers only allow notifications from a service worker. */ } }
      if (!shown || document.visibilityState === 'visible') latest.current.notify(`⏰ ${title}（${body}）`);
    }
    if (due.length) saveSent(sent.current);
  }, [weekKeyOf, days]);

  useEffect(() => {
    if (!enabled) return undefined;
    check();
    const timer = setInterval(check, 30000);
    return () => clearInterval(timer);
  }, [enabled, check, events]);

  const toggle = async () => {
    const next = !enabled;
    try { localStorage.setItem(KEY, next ? 'on' : 'off'); } catch { /* The switch still works for this visit. */ }
    setEnabled(next);
    if (!next) return notify('日程提醒已关闭');
    let permission = typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
    if (permission === 'default') { try { permission = await Notification.requestPermission(); } catch { permission = 'denied'; } }
    notify(permission === 'granted' ? '日程提醒已开启：开始前 10 分钟发系统通知（需保持本页打开）' : '日程提醒已开启：浏览器未允许系统通知，将只在页面内提示（需保持本页打开）');
  };
  return { enabled, toggle };
}
