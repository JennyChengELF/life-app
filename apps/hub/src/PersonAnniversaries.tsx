import { useEffect, useState } from 'react';
import { PERSON_ANNIVERSARY_FIELDS, type PersonAnniversaryProfile, type PersonAnniversarySettings } from '@life/db';
import type { EditState } from './HubMore';

export function PersonAnniversaries({ load, save, onEditState }: {
  load: () => Promise<PersonAnniversaryProfile[]>;
  save: (id: string, settings: PersonAnniversarySettings) => Promise<void>;
  onEditState: (state: EditState) => void;
}) {
  const [profiles, setProfiles] = useState<PersonAnniversaryProfile[] | null>(null);
  const [personId, setPersonId] = useState('');
  const profile = profiles?.find((person) => person.id === personId);
  const [draft, setDraft] = useState<PersonAnniversarySettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    load().then((result) => { if (active) setProfiles(result); })
      .catch((e: unknown) => { if (active) setError(e instanceof Error ? e.message : '讀取共用人物失敗'); });
    return () => { active = false; };
  }, [load]);

  const canLeave = () => !draft || confirm('紀念日尚未儲存，確定離開？');
  const settings = draft ?? profile?.settings;
  const changeDraft = (next: PersonAnniversarySettings | null) => {
    setDraft(next);
    onEditState(next ? 'dirty' : 'clean');
  };
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft || !profile || busy) return;
    setBusy(true);
    onEditState('saving');
    setError(null);
    try {
      await save(profile.id, draft);
      setProfiles(await load());
      changeDraft(null);
      setSaved(true);
    } catch (e) {
      onEditState('dirty');
      setError(e instanceof Error ? e.message : '儲存失敗');
    } finally {
      setBusy(false);
    }
  };

  return <div className="person-anniversary-settings">
    {error && <p className="msg warn" role="alert">{error}</p>}
    {saved && !draft && <p className="msg info" role="status">已儲存，可在行事曆查看。</p>}
    {!profiles && !error && <p className="muted">讀取人物中⋯⋯</p>}
    {profiles?.length === 0 && <p className="muted">共用人物清單目前是空的。可在行事曆或記帳先新增人物。</p>}
    {!!profiles?.length && <label className="field">人物
      <select value={personId} disabled={busy} onChange={(e) => {
        if (!canLeave()) return;
        setPersonId(e.target.value); changeDraft(null); setError(null); setSaved(false);
      }}>
        <option value="">請選擇人物</option>
        {profiles.map((person) => <option value={person.id} key={person.id}>{person.nickname}{person.fullName ? `（${person.fullName}）` : ''}</option>)}
      </select>
    </label>}
    {settings && <form onSubmit={submit}>
      <p className="muted small">日期可填月/日或西元年/月/日，例如 10/12 或 1983/10/12。農曆日期請填農曆月日，年份填該農曆年的西元對應年份。留空可清除。</p>
      <div className="anniversary-fields">
        {PERSON_ANNIVERSARY_FIELDS.map(([field, label]) => {
          const leapField = field === 'lunarBirthday' ? 'lunarBirthdayLeap' : field === 'lunarMemorial' ? 'lunarMemorialLeap' : null;
          return <div key={field}>
            <label className="field">{label}
              <input value={settings.dates[field]} disabled={busy} placeholder="月/日 或 西元年/月/日" onChange={(e) => {
                changeDraft({ ...settings, dates: { ...settings.dates, [field]: e.target.value } });
              }} />
            </label>
            {leapField && !!settings.dates[field].trim() && <label className="field">農曆月份
              <select value={settings[leapField]} disabled={busy} onChange={(e) => changeDraft({ ...settings, [leapField]: e.target.value as PersonAnniversarySettings[typeof leapField] })}>
                <option value="regular">普通月</option>
                <option value="fallback">閏月，沒有同名閏月時用普通月</option>
                <option value="only">只在同名閏月顯示</option>
              </select>
            </label>}
          </div>;
        })}
      </div>
      <label className="anniversary-contact">
        <input type="checkbox" checked={settings.noLongerInContact} disabled={busy} onChange={(e) => changeDraft({ ...settings, noLongerInContact: e.target.checked })} /> 不再聯繫，隱藏此人的生日和祭日
      </label>
      <button className="primary" disabled={!draft || busy}>儲存紀念日</button>
    </form>}
  </div>;
}
