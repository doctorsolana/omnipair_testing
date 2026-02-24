import type { AppTab } from '@/features/market/types'
import { APP_TABS } from '@/features/market/types'

type TabsNavProps = {
  activeTab: AppTab
  onChange: (tab: AppTab) => void
}

function TabsNav({ activeTab, onChange }: TabsNavProps) {
  const activeTabIndex = Math.max(0, APP_TABS.indexOf(activeTab))

  return (
    <div className="market-tabs-rail">
      <span className="tabs-rule" />
      <div className="market-tabs">
        <span
          className="tab-indicator"
          style={{
            width: `${100 / APP_TABS.length}%`,
            transform: `translateX(${activeTabIndex * 100}%)`,
            borderTopLeftRadius: activeTabIndex === 0 ? '999px' : '0',
            borderBottomLeftRadius: activeTabIndex === 0 ? '999px' : '0',
            borderTopRightRadius: activeTabIndex === APP_TABS.length - 1 ? '999px' : '0',
            borderBottomRightRadius: activeTabIndex === APP_TABS.length - 1 ? '999px' : '0',
          }}
          aria-hidden="true"
        />
        {APP_TABS.map((tab) => (
          <button
            key={tab}
            className={`tab-button ${activeTab === tab ? 'active' : ''}`}
            onClick={() => onChange(tab)}
          >
            {tab}
          </button>
        ))}
      </div>
      <span className="tabs-rule" />
    </div>
  )
}

export default TabsNav
