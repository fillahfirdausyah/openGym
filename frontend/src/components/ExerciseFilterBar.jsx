import { useUI } from '../store/useUI.js'
import Icon from './Icon.jsx'
import { tappable } from '../lib/use-sheet-keyboard.js'

// The exercise filters collapsed to three buttons (Hevy-style) where three horizontally-scrolling
// chip strips used to sit. Each button names its dimension and shows the current value; tapping
// opens a pick-list — the same menu rows the rest of the app uses — with a tick on the active
// value. A dimension's `options` always leads with the empty value ('' = "all"), so the button's
// rest label and the sheet's "clear" row are the same entry.
function FilterSheet({ name, options, value, onChange, close }) {
  return <>
    <h3>{name}</h3>
    <div className="list menu-list">
      {options.map(o => <div key={o.value} className="item menu-item"
        {...tappable(() => { onChange(o.value); close() })}>
        {o.icon && <span className="lrow-i"><Icon name={o.icon} /></span>}
        <div className="grow"><div className="tt">{o.label}</div></div>
        {o.value === value && <span className="menu-on is-on"><Icon name="check" /></span>}
      </div>)}
    </div>
  </>
}

export default function ExerciseFilterBar({ muscle, type, equipment }) {
  const dims = [muscle, type, equipment].filter(Boolean)
  if (!dims.length) return null
  return <div className="filter-bar">
    {dims.map(dim => {
      const current = dim.options.find(o => o.value === dim.value)
      const active = !!dim.value
      return <button key={dim.name} type="button" className={'filter-btn' + (active ? ' on' : '')}
        aria-pressed={active}
        onClick={() => useUI.getState().openSheet(close => <FilterSheet {...dim} close={close} />)}>
        <span className="fb-text">
          <span className="fb-name">{dim.name}</span>
          <span className="fb-value">{current ? current.label : ''}</span>
        </span>
        <Icon name="chevronDown" className="fb-caret" />
      </button>
    })}
  </div>
}
