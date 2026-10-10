import { STADIUM_NAMES } from '../../../constants/index.js';
import { calendarDay, calendarState, calendarRowDay, calendarVenue, calendarMonth, monthDays, UNKNOWN_CALENDAR_VALUE } from '../../../utils/snsMonthCalendar.js';
import './MonthCalendar.css';

const stateLabels = { planned: '予定', posted: '投稿済み', expired: '失効', other: 'その他' };
const channelLabels = { x: 'X', youtube: 'YouTube' };
const venueLabel = code => STADIUM_NAMES[Number(code)] || UNKNOWN_CALENDAR_VALUE;
const values = (rows, read) => [...new Set(rows.map(read))].sort();

export default function MonthCalendar({ rows, now, selection, onSelection }) {
  const month = selection.month || calendarDay(new Date(now).toISOString()).slice(0, 7);
  const monthly = calendarMonth(rows, month);
  const filtered = calendarMonth(rows, month, selection);
  const update = changes => onSelection({ ...selection, month, day: '', ...changes });
  const dimensions = [
    ['チャネル', row => channelLabels[row.channel] || row.channel],
    ['型', row => row.format || UNKNOWN_CALENDAR_VALUE],
    ['会場', row => venueLabel(calendarVenue(row))],
    ['グレード（保存値）', row => typeof row.grade === 'string' && row.grade ? row.grade : UNKNOWN_CALENDAR_VALUE],
  ];
  return <section className="sns-month-calendar" aria-label="全月カレンダー">
    <h2>全月カレンダー（JST）</h2>
    <p>投稿済みは実公開日、未公開は予定日（未設定なら公式締切・送信期限）で表示します。失効も元の予定日に計上します。予定は待ち行列に登録済みの件数です。その他には承認待ち・保留・送信中・要照合・失敗を含みます。</p>
    <div className="sns-month-calendar-filters">
      <label>表示月 <input type="month" value={month} onChange={e => e.target.value && update({ month: e.target.value, format: '', venue: '' })} /></label>
      <label>型 <select value={selection.format || ''} onChange={e => update({ format: e.target.value })}>
        <option value="">すべて</option>{values(monthly, row => row.format || UNKNOWN_CALENDAR_VALUE).map(value => <option key={value}>{value}</option>)}
      </select></label>
      <label>会場 <select value={selection.venue || ''} onChange={e => update({ venue: e.target.value })}>
        <option value="">すべて</option>{values(monthly, calendarVenue).map(value => <option key={value} value={value}>{venueLabel(value)}</option>)}
      </select></label>
      <button type="button" onClick={() => update({ format: '', venue: '' })}>絞り込みを解除</button>
    </div>
    <p>{filtered.length}件 / 日付未確認: {rows.filter(row => !calendarRowDay(row)).length}件（全期間・月集計対象外）</p>
    <div className="sns-month-calendar-summary">
      {dimensions.map(([label, read]) => <p key={label}>{label}: {values(filtered, read).map(value => `${value} ${filtered.filter(row => read(row) === value).length}件`).join(' / ') || '0件'}</p>)}
    </div>
    <p><span className="sns-month-calendar-x">X</span> / <span className="sns-month-calendar-youtube">YouTube</span>（色と名称で区別）</p>
    <div className="sns-month-calendar-grid">
      {['日', '月', '火', '水', '木', '金', '土'].map(day => <span key={day} className="sns-month-calendar-weekday">{day}</span>)}
      {Array.from({ length: new Date(`${month}-01T00:00:00Z`).getUTCDay() }, (_, i) => <span key={`blank-${i}`} aria-hidden="true" />)}
      {monthDays(month).map(day => {
        const daily = filtered.filter(row => calendarRowDay(row) === day);
        return <button type="button" key={day} aria-label={`${day}の投稿 ${daily.length}件`} aria-pressed={selection.day === day} onClick={() => update({ day })}>
          <strong>{Number(day.slice(-2))}</strong>
          {Object.entries(stateLabels).map(([state, label]) => <span key={state}>{label} {daily.filter(row => calendarState(row, now) === state).length}</span>)}
          {Object.entries(channelLabels).map(([channel, label]) => <span key={channel} className={`sns-month-calendar-${channel}`}>{label} {daily.filter(row => row.channel === channel).length}</span>)}
        </button>;
      })}
    </div>
    {selection.day && <p>{selection.day}の期限順一覧 <button type="button" onClick={() => update({})}>全期間の一覧に戻る</button></p>}
  </section>;
}
