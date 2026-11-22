import { Icon, type IconName } from './Icon';

export interface AppTabItem<T extends string> {
  key: T;
  label: string;
  icon: IconName;
}

/**
 * 個別 APP 共用的頂部／底部分頁。
 * （2026-11-22 使用者決定：原則上使用新增、日曆、統計、更多。）
 */
export function AppTabs<T extends string>({
  items,
  current,
  onChange,
  placement,
}: {
  items: AppTabItem<T>[];
  current: T;
  onChange: (tab: T) => void;
  placement: 'top' | 'bottom';
}) {
  return (
    <nav className={placement === 'top' ? 'tabs-top' : 'tabs-bottom'} aria-label="功能分頁">
      {items.map((item) => (
        <button
          type="button"
          key={item.key}
          className={current === item.key ? 'active' : ''}
          aria-current={current === item.key ? 'page' : undefined}
          onClick={() => onChange(item.key)}
        >
          {placement === 'bottom' ? (
            <span className="tab-icon"><Icon name={item.icon} /></span>
          ) : (
            <Icon name={item.icon} size={20} />
          )}
          {item.label}
        </button>
      ))}
    </nav>
  );
}
