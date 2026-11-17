import React from 'react';

const hours = (minutes) => Math.round((Number(minutes) || 0) / 6) / 10;
const percent = (rate) => `${Math.round((Number(rate) || 0) * 100)}%`;

// Weekly review: this week so far, how last week went, and the notes the planner is given.
export default function ReviewCard({ review }) {
  if (!review?.week_key) return <p className="panel-hint">还没有复盘数据</p>;
  const { previous, mood_trend: moods, notes = [] } = review;
  return <div className="review-card">
    <dl className="review-rows">
      <div><dt>本周</dt><dd><strong>{percent(review.completion_rate)}</strong><span>计划 {hours(review.planned_minutes)} 小时 · 实际 {hours(review.actual_minutes)} 小时</span></dd></div>
      <div><dt>上周</dt><dd>{previous?.planned_minutes > 0
        ? <><strong>{percent(previous.completion_rate)}</strong><span>计划 {hours(previous.planned_minutes)} 小时 · 实际 {hours(previous.actual_minutes)} 小时</span></>
        : <span>没有计划记录</span>}</dd></div>
      {moods?.recorded > 0 && <div><dt>心情</dt><dd><span>近 28 天记录 {moods.recorded} 天：{moods.top.map((mood) => `${mood.label} ${mood.count}`).join('、')}</span></dd></div>}
    </dl>
    {notes.length > 0 && <ul className="review-notes">{notes.map((note) => <li key={note}>{note}</li>)}</ul>}
    <p className="panel-hint">完成率与番茄钟统计一致；生成规划时会参考这些内容。</p>
  </div>;
}
