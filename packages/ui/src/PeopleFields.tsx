import { useState } from 'react';
import type { CalendarPerson } from '@life/db';

export function personLabel(person: CalendarPerson | undefined) {
  if (!person) return '找不到的人物';
  return `${person.nickname}${person.fullName ? `（${person.fullName}）` : ''}${person.archived ? '（已停用）' : ''}`;
}

export function PeopleFields({ people, selected, onChange, onAdd, busy }: {
  people: CalendarPerson[];
  selected: string[];
  onChange: (ids: string[]) => void;
  onAdd?: (nickname: string, fullName: string) => Promise<string | undefined>;
  busy: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [query, setQuery] = useState('');
  const [nickname, setNickname] = useState('');
  const [fullName, setFullName] = useState('');
  const search = query.trim().toLocaleLowerCase();
  const choices = people.filter((person) => !person.archived && !selected.includes(person.id) &&
    (!search || person.nickname.toLocaleLowerCase().includes(search) || person.fullName?.toLocaleLowerCase().includes(search)));
  const exact = people.find((person) => person.nickname === nickname.trim());
  const closeAdd = () => {
    setAdding(false);
    setNickname('');
    setFullName('');
  };
  const savePerson = async () => {
    if (!onAdd || busy || !nickname.trim() || exact) return;
    const id = await onAdd(nickname, fullName);
    if (!id) return;
    onChange([...selected, id]);
    setQuery('');
    closeAdd();
  };

  return <section className="people-fields">
    <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>相關人物{selected.length > 0 && `（${selected.length}）`}</button>
    {selected.length > 0 && <ul className="selected-people">
      {selected.map((id) => {
        const label = personLabel(people.find((person) => person.id === id));
        return <li key={id}>
          {label}
          <button type="button" className="link" disabled={busy} aria-label={`移除${label}`} onClick={() => onChange(selected.filter((item) => item !== id))}>×</button>
        </li>;
      })}
    </ul>}
    {open && <div className="people-picker">
      <label className="field">搜尋暱稱或姓名<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault();
      }} /></label>
      {choices.length > 0 ? <div className="people-choices" aria-label="可選人物">
        {choices.map((person) => <button type="button" key={person.id} disabled={busy} onClick={() => onChange([...selected, person.id])}>
          {personLabel(person)} <span aria-hidden="true">＋</span>
        </button>)}
      </div> : <p className="muted small">沒有符合的可選人物</p>}
      {onAdd && (!adding ? <button type="button" className="link" disabled={busy} onClick={() => { setNickname(query.trim()); setAdding(true); }}>＋ 新增共用人物</button> : (
        <div className="person-add" onKeyDown={(e) => {
          if (e.key !== 'Enter' || e.nativeEvent.isComposing || !(e.target instanceof HTMLInputElement)) return;
          e.preventDefault();
          void savePerson();
        }}>
          <label className="field">暱稱<input value={nickname} disabled={busy} onChange={(e) => setNickname(e.target.value)} /></label>
          <label className="field">姓名（選填）<input value={fullName} disabled={busy} onChange={(e) => setFullName(e.target.value)} /></label>
          {exact && <p className="muted small">這個暱稱已存在{exact.archived ? '，人物已停用' : ''}。</p>}
          <p className="muted small">新增後會立即存入共用人物，並選入這筆行程。</p>
          <div className="row">
            <button type="button" disabled={busy} onClick={closeAdd}>取消</button>
            <button type="button" className="primary" disabled={busy || !nickname.trim() || !!exact} onClick={savePerson}>新增並選取</button>
          </div>
        </div>
      ))}
    </div>}
  </section>;
}
