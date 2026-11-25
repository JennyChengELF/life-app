import { useState } from 'react';
import type { SharedTag } from '@life/db';

export function tagLabel(tags: SharedTag[], id: string) {
  const tag = tags.find((item) => item.id === id);
  return tag ? `#${tag.name}${tag.archived ? '（已停用）' : ''}` : '找不到的標籤';
}

export function TagPicker({ tags, selected, busy, onChange, onAdd }: {
  tags: SharedTag[];
  selected: string[];
  busy: boolean;
  onChange: (ids: string[]) => void;
  onAdd: (name: string) => Promise<string | undefined>;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const name = query.trim().replace(/^[#＃]+\s*/, '');
  const search = name.toLowerCase();
  const choices = tags.filter((tag) => !tag.archived && !selected.includes(tag.id) && tag.name.toLowerCase().includes(search));
  const exact = tags.find((tag) => tag.name.toLowerCase() === search);

  const add = async () => {
    if (busy || !name || exact) return;
    const id = await onAdd(name);
    if (!id) return;
    onChange([...selected, id]);
    setQuery('');
  };

  return <section className="shared-tag-picker">
    <button type="button" className="link" aria-expanded={open} onClick={() => setOpen(!open)}>
      共用標籤{selected.length > 0 && `（${selected.length}）`}
    </button>
    {selected.length > 0 && <ul className="shared-tag-chips">
      {selected.map((id) => <li key={id}>
        {tagLabel(tags, id)}
        <button type="button" className="link" disabled={busy} aria-label={`移除${tagLabel(tags, id)}`} onClick={() => onChange(selected.filter((value) => value !== id))}>×</button>
      </li>)}
    </ul>}
    {open && <>
      <label className="field">標籤名稱<input type="search" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.nativeEvent.isComposing) e.preventDefault();
      }} /></label>
      {choices.length ? <div className="shared-tag-choices">
        {choices.map((tag) => <button type="button" key={tag.id} disabled={busy} onClick={() => onChange([...selected, tag.id])}>{tagLabel(tags, tag.id)} <span aria-hidden="true">＋</span></button>)}
      </div> : <p className="muted small">{exact?.archived ? '這個標籤已停用' : '沒有符合的可選標籤'}</p>}
      {name && !exact && <button type="button" className="link" disabled={busy} onClick={add}>＋ 建立並選取「{name}」</button>}
    </>}
  </section>;
}
