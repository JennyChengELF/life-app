import { useEffect, useState } from 'react';
import { HUB_TIMELINE_OPTIONS, type HubTimelineKind } from '@life/db';
import { Icon, type IconName } from '@life/ui/icon';
import { PersonAnniversaries } from './PersonAnniversaries';
import type { useHub } from './useHub';

type Hub = ReturnType<typeof useHub>;
export type EditState = 'clean' | 'dirty' | 'saving';
type Page = 'data' | 'settings' | 'people' | 'anniversaries';

const PAGES: Record<Page, { label: string; icon: IconName }> = {
  data: { label: '資料與試算表', icon: 'clipboard' },
  settings: { label: '首頁設定', icon: 'settings' },
  people: { label: '人物資料表', icon: 'user' },
  anniversaries: { label: '人物紀念日設定', icon: 'calendar' },
};

export function HubMore({ hub, timelineKinds, canLeave, onEditState }: {
  hub: Hub;
  timelineKinds: HubTimelineKind[];
  canLeave: () => boolean;
  onEditState: (state: EditState) => void;
}) {
  const [page, setPage] = useState<Page | null>(null);
  if (!page) return (
    <section className="hub-more-menu">
      <h2>更多</h2>
      {(Object.keys(PAGES) as Page[]).map((key) => (
        <button type="button" className="hub-more-row" key={key} onClick={() => setPage(key)}>
          <Icon name={PAGES[key].icon} /><b>{PAGES[key].label}</b><Icon name="right" />
        </button>
      ))}
    </section>
  );

  const url = page === 'data' ? hub.fileUrl() : null;
  return (
    <section className="card hub-more-page">
      <button type="button" className="link hub-more-back" onClick={() => {
        if (!canLeave()) return;
        onEditState('clean');
        setPage(null);
      }}><Icon name="left" size={18} /> 返回更多</button>
      <h2>{PAGES[page].label}</h2>
      {page === 'data' && (hub.mode === 'local'
        ? <p className="muted">本機測試模式：資料只存在這個瀏覽器。</p>
        : url
          ? <a className="btn" href={url} target="_blank" rel="noreferrer">開啟「生活APP－綜合」試算表 ↗</a>
          : <p className="muted">目前沒有可開啟的試算表。</p>)}
      {page === 'settings' && <TimelineSettings kinds={timelineKinds} save={hub.saveTimelineKinds} onEditState={onEditState} />}
      {page === 'people' && <PeopleTable load={hub.loadPeople} />}
      {page === 'anniversaries' && <PersonAnniversaries load={hub.loadPersonAnniversaries} save={hub.savePersonAnniversaries} onEditState={onEditState} />}
    </section>
  );
}

function TimelineSettings({ kinds, save, onEditState }: {
  kinds: HubTimelineKind[];
  save: Hub['saveTimelineKinds'];
  onEditState: (state: EditState) => void;
}) {
  const [draft, setDraft] = useState<HubTimelineKind[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const selected = draft ?? kinds;
  return (
    <form onSubmit={async (event) => {
      event.preventDefault();
      if (!draft || busy) return;
      setBusy(true);
      onEditState('saving');
      setMessage(null);
      try {
        await save(draft);
        setDraft(null);
        onEditState('clean');
        setMessage({ text: '已儲存首頁設定。', error: false });
      } catch (error) {
        onEditState('dirty');
        setMessage({ text: error instanceof Error ? error.message : '儲存失敗', error: true });
      } finally {
        setBusy(false);
      }
    }}>
      <fieldset className="hub-timeline-options" disabled={busy}>
        <legend>時間軸顯示的紀錄</legend>
        {HUB_TIMELINE_OPTIONS.map(([key, label]) => (
          <label key={key}>
            <input type="checkbox" checked={selected.includes(key)} onChange={(event) => {
              const next = event.target.checked ? [...selected, key] : selected.filter((kind) => kind !== key);
              const changed = next.length !== kinds.length || next.some((kind) => !kinds.includes(kind));
              setDraft(changed ? next : null);
              setMessage(null);
              onEditState(changed ? 'dirty' : 'clean');
            }} />
            {label}
          </label>
        ))}
      </fieldset>
      {message && <p className={message.error ? 'msg warn' : 'msg info'} role={message.error ? 'alert' : 'status'}>{message.text}</p>}
      <button className="primary" disabled={!draft || busy}>{busy ? '儲存中⋯⋯' : '儲存首頁設定'}</button>
    </form>
  );
}

function PeopleTable({ load }: { load: Hub['loadPeople'] }) {
  const [people, setPeople] = useState<Awaited<ReturnType<Hub['loadPeople']>> | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    load().then((rows) => { if (active) setPeople(rows); }).catch((error: unknown) => {
      if (active) setError(error instanceof Error ? error.message : '讀取共用人物失敗');
    });
    return () => { active = false; };
  }, [load]);

  if (error) return <p className="msg warn" role="alert">{error}</p>;
  if (!people) return <p className="muted" role="status">讀取人物中⋯⋯</p>;
  if (!people.length) return <p className="muted">共用人物清單目前是空的。可在行事曆或記帳新增人物。</p>;
  return (
    <table className="hub-people-table" aria-label="共用人物">
      <thead><tr><th scope="col">暱稱</th><th scope="col">姓名</th><th scope="col">狀態</th></tr></thead>
      <tbody>{people.map((person) => (
        <tr key={person.rowNumber}><td>{person.nickname}</td><td>{person.fullName || '—'}</td><td>{person.archived ? '停用' : '使用中'}</td></tr>
      ))}</tbody>
    </table>
  );
}
